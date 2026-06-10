// src/on-email.ts
import { request as httpsRequest } from "https";
import { env, exit, stderr } from "process";
async function main() {
  const stdinJson = await readStdin();
  const email = parseEmail(stdinJson);
  const columns = getColumnMappings();
  await validateColumns(columns);
  const itemName = `${email.from?.name ?? email.from?.address ?? "(unknown)"} \u2014 ${email.subject}`.slice(0, 255);
  const columnValues = {};
  columnValues[columns.sender.columnId] = email.from?.name ?? email.from?.address ?? "";
  columnValues[columns.email.columnId] = email.from?.address ?? "";
  columnValues[columns.subjectCoL.columnId] = email.subject;
  columnValues[columns.date.columnId] = email.receivedAt ? { date: email.receivedAt } : null;
  await createItem(itemName, columnValues);
  exit(0);
}
function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const { stdin } = process;
    if (stdin.isTTY) {
      reject(new Error("stdin is a TTY \u2014 expected piped JSON input"));
      return;
    }
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stdin.on("error", reject);
  });
}
function parseEmail(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stdin is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("stdin JSON is not an object");
  }
  const email = parsed;
  if (!email.subject || !email.id) {
    throw new Error("missing required fields: subject, id");
  }
  return email;
}
function getColumnMappings() {
  const token = env.MONDAY_API_TOKEN;
  if (!token) throw new Error("MONDAY_API_TOKEN is not set");
  const boardId = env.MONDAY_BOARD_ID;
  if (!boardId) throw new Error("MONDAY_BOARD_ID is not set");
  const sender = env.MONDAY_COL_SENDER;
  if (!sender) throw new Error("MONDAY_COL_SENDER is not set");
  const emailCol = env.MONDAY_COL_EMAIL;
  if (!emailCol) throw new Error("MONDAY_COL_EMAIL is not set");
  const subjectCol = env.MONDAY_COL_SUBJECT;
  if (!subjectCol) throw new Error("MONDAY_COL_SUBJECT is not set");
  const dateCol = env.MONDAY_COL_DATE;
  if (!dateCol) throw new Error("MONDAY_COL_DATE is not set");
  return {
    sender: { envName: "MONDAY_COL_SENDER", columnId: sender, expectedType: "text" },
    email: { envName: "MONDAY_COL_EMAIL", columnId: emailCol, expectedType: "text" },
    subjectCoL: { envName: "MONDAY_COL_SUBJECT", columnId: subjectCol, expectedType: "text" },
    date: { envName: "MONDAY_COL_DATE", columnId: dateCol, expectedType: "date" }
  };
}
var validatedBoardId;
async function validateColumns(mappings) {
  const boardId = env.MONDAY_BOARD_ID;
  const skipValidation = env.MONDAY_SKIP_VALIDATION === "true";
  if (validatedBoardId === boardId) return;
  if (skipValidation) {
    validatedBoardId = boardId;
    return;
  }
  const columns = await fetchBoardColumns(boardId);
  const columnMap = new Map(columns.map((c) => [c.id, c]));
  const all = [
    mappings.sender,
    mappings.email,
    mappings.subjectCoL,
    mappings.date
  ];
  const errors = [];
  for (const m of all) {
    const col = columnMap.get(m.columnId);
    if (!col) {
      errors.push(
        `${m.envName}="${m.columnId}" not found on board ${boardId}`
      );
    } else if (col.type !== m.expectedType) {
      errors.push(
        `${m.envName}="${m.columnId}" is type "${col.type}" (expected "${m.expectedType}")`
      );
    }
  }
  if (errors.length > 0) {
    stderr.write(`[on-email] column validation failed:
${errors.map((e) => `  - ${e}`).join("\n")}
`);
    exit(1);
  }
  validatedBoardId = boardId;
}
async function fetchBoardColumns(boardId) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        columns {
          id
          title
          type
        }
      }
    }
  `;
  const data = await graphqlRequest(query);
  const boards = data.boards;
  if (!boards || boards.length === 0) {
    throw new Error(`Board ${boardId} not found or no access`);
  }
  return boards[0].columns;
}
async function createItem(itemName, columnValues) {
  const boardId = env.MONDAY_BOARD_ID;
  const groupId = env.MONDAY_GROUP_ID ?? "topics";
  const serialized = JSON.stringify(JSON.stringify(columnValues));
  const query = `
    mutation {
      create_item (
        board_id: ${boardId},
        group_id: "${groupId}",
        item_name: ${JSON.stringify(itemName)},
        column_values: ${serialized}
      ) {
        id
      }
    }
  `;
  const data = await graphqlRequest(query);
  if (!data.create_item?.id) {
    throw new Error("create_item returned no id");
  }
}
function graphqlRequest(query) {
  return new Promise((resolve, reject) => {
    const token = env.MONDAY_API_TOKEN;
    const body = JSON.stringify({ query });
    const req = httpsRequest(
      {
        hostname: "api.monday.com",
        path: "/v2",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "Content-Length": Buffer.byteLength(body).toString()
        }
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            reject(new Error(`monday.com returned non-JSON (HTTP ${res.statusCode})`));
            return;
          }
          if (parsed.errors?.length) {
            reject(
              new Error(
                `monday.com API error(s): ${parsed.errors.map((e) => e.message).join("; ")}`
              )
            );
            return;
          }
          if (!parsed.data) {
            reject(new Error("monday.com API returned no data"));
            return;
          }
          resolve(parsed.data);
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  stderr.write(`[on-email] unexpected error: ${message}
`);
  exit(2);
});
