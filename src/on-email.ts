/**
 * on-email — receives hypermail-mcp EmailFull JSON on stdin and creates a
 * monday.com board row with sender / subject / date metadata.
 *
 * Env vars:
 *   MONDAY_API_TOKEN         — monday.com API v2 token
 *   MONDAY_BOARD_ID          — target board ID (numeric)
 *   MONDAY_GROUP_ID          — target group ID (optional, defaults to "topics")
 *   MONDAY_COL_SENDER        — column ID for sender name (text column)
 *   MONDAY_COL_EMAIL         — column ID for sender email (text column)
 *   MONDAY_COL_SUBJECT       — column ID for subject (text column)
 *   MONDAY_COL_DATE          — column ID for received date (date column)
 *   MONDAY_SKIP_VALIDATION   — set to "true" to skip column ID validation
 *
 * Exit codes:
 *   0 — row created successfully
 *   1 — configuration or validation error
 *   2 — API error (caller may retry)
 */

import { request as httpsRequest } from "node:https";
import { env, exit, stderr } from "node:process";

// ── Types ──

interface EmailAddress {
  name?: string;
  address: string;
}

interface EmailFull {
  id: string;
  subject: string;
  from?: EmailAddress;
  to?: EmailAddress[];
  receivedAt?: string;
  preview?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
}

interface MondayColumn {
  id: string;
  title: string;
  type: string;
}

interface MondayBoard {
  columns: MondayColumn[];
}

// ── Column config ──

interface ColumnMapping {
  envName: string;
  columnId: string;
  expectedType: string;
}

// ── Main ──

async function main(): Promise<void> {
  const stdinJson = await readStdin();
  const email = parseEmail(stdinJson);

  const columns = getColumnMappings();
  await validateColumns(columns);

  const itemName = `${email.from?.name ?? email.from?.address ?? "(unknown)"} — ${email.subject}`.slice(0, 255);

  const columnValues: Record<string, unknown> = {};
  columnValues[columns.sender.columnId] =
    email.from?.name ?? email.from?.address ?? "";
  columnValues[columns.email.columnId] =
    email.from?.address ?? "";
  columnValues[columns.subjectCoL.columnId] =
    email.subject;
  columnValues[columns.date.columnId] = email.receivedAt
    ? { date: email.receivedAt }
    : null;

  await createItem(itemName, columnValues);
  exit(0);
}

// ── Stdin ──

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const { stdin } = process;

    if (stdin.isTTY) {
      reject(new Error("stdin is a TTY — expected piped JSON input"));
      return;
    }

    stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stdin.on("error", reject);
  });
}

function parseEmail(raw: string): EmailFull {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stdin is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("stdin JSON is not an object");
  }

  const email = parsed as EmailFull;
  if (!email.subject || !email.id) {
    throw new Error("missing required fields: subject, id");
  }

  return email;
}

// ── Column config ──

function getColumnMappings(): {
  sender: ColumnMapping;
  email: ColumnMapping;
  subjectCoL: ColumnMapping;
  date: ColumnMapping;
} {
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
    date: { envName: "MONDAY_COL_DATE", columnId: dateCol, expectedType: "date" },
  };
}

// ── Validation (cached per-process) ──

let validatedBoardId: string | undefined;

async function validateColumns(
  mappings: ReturnType<typeof getColumnMappings>,
): Promise<void> {
  const boardId = env.MONDAY_BOARD_ID!;
  const skipValidation = env.MONDAY_SKIP_VALIDATION === "true";

  // Cache: only validate once per process lifetime.
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
    mappings.date,
  ];

  const errors: string[] = [];
  for (const m of all) {
    const col = columnMap.get(m.columnId);
    if (!col) {
      errors.push(
        `${m.envName}="${m.columnId}" not found on board ${boardId}`,
      );
    } else if (col.type !== m.expectedType) {
      errors.push(
        `${m.envName}="${m.columnId}" is type "${col.type}" (expected "${m.expectedType}")`,
      );
    }
  }

  if (errors.length > 0) {
    stderr.write(`[on-email] column validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
    exit(1);
  }

  validatedBoardId = boardId;
}

async function fetchBoardColumns(boardId: string): Promise<MondayColumn[]> {
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

  const data = await graphqlRequest<{ boards: MondayBoard[] }>(query);
  const boards = data.boards;
  if (!boards || boards.length === 0) {
    throw new Error(`Board ${boardId} not found or no access`);
  }

  return boards[0]!.columns;
}

// ── Create item ──

async function createItem(
  itemName: string,
  columnValues: Record<string, unknown>,
): Promise<void> {
  const boardId = env.MONDAY_BOARD_ID!;
  const groupId = env.MONDAY_GROUP_ID ?? "topics";

  // Monday.com expects column_values as a JSON-encoded string.
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

  const data = await graphqlRequest<{
    create_item: { id: string } | null;
  }>(query);

  if (!data.create_item?.id) {
    throw new Error("create_item returned no id");
  }
}

// ── GraphQL client (zero-dependency, node:https) ──

function graphqlRequest<T>(query: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const token = env.MONDAY_API_TOKEN!;
    const body = JSON.stringify({ query });

    const req = httpsRequest(
      {
        hostname: "api.monday.com",
        path: "/v2",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed: { data?: T; errors?: Array<{ message: string }> };

          try {
            parsed = JSON.parse(raw);
          } catch {
            reject(new Error(`monday.com returned non-JSON (HTTP ${res.statusCode})`));
            return;
          }

          if (parsed.errors?.length) {
            reject(
              new Error(
                `monday.com API error(s): ${parsed.errors.map((e) => e.message).join("; ")}`,
              ),
            );
            return;
          }

          if (!parsed.data) {
            reject(new Error("monday.com API returned no data"));
            return;
          }

          resolve(parsed.data);
        });
      },
    );

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  stderr.write(`[on-email] unexpected error: ${message}\n`);
  exit(2);
});
