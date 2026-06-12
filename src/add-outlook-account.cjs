/**
 * add-outlook-account.cjs — Run INSIDE the hypermail-mcp container to
 * add an Outlook account via the device-code OAuth flow.
 *
 * Usage: docker exec -it <container> node /scripts/add-outlook-account.cjs
 *
 * Required env vars in container:
 *   HYPERMAIL_MCP_KEY — Encryption key (already set)
 *
 * Optional env vars (hypermail-mcp falls back to built-in defaults):
 *   MS_CLIENT_ID      — Azure/Entra ID public client ID (optional)
 *   MS_TENANT_ID      — Tenant (default: "common")
 */

const { spawn } = require("node:child_process");

const MS_CLIENT_ID = process.env.MS_CLIENT_ID ?? "";
const MS_TENANT_ID = process.env.MS_TENANT_ID ?? "common";
const DATA_DIR = "/data";
const MCP_KEY = process.env.HYPERMAIL_MCP_KEY;

if (!MCP_KEY) {
  console.error("HYPERMAIL_MCP_KEY is not set in the container");
  process.exit(1);
}
// ── MCP stdio client ──

let msgId = 0;
let resolveNext = null;
let buffer = "";

function mcpCall(method, params) {
  const id = ++msgId;
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: method, arguments: params },
  });

  return new Promise((resolve, reject) => {
    resolveNext = resolve;
    proc.stdin.write(body + "\n");
    setTimeout(() => {
      if (resolveNext === resolve) {
        resolveNext = null;
        reject(new Error(`timeout: ${method}`));
      }
    }, 120000);
  });
}

function handleLine(line) {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    if (msg.id && resolveNext) {
      const cb = resolveNext;
      resolveNext = null;
      if (msg.error) {
        // ignore — tool errors are returned in result.content
      }
      cb(msg.result ?? msg);
    }
  } catch {}
}

// ── Start MCP server ──

const proc = spawn("node", ["dist/cli.js", "--data-dir", DATA_DIR], {
  env: { ...process.env, MS_CLIENT_ID, MS_TENANT_ID, HYPERMAIL_MCP_KEY: MCP_KEY },
  stdio: ["pipe", "pipe", "pipe"],
  cwd: "/app",
});

proc.stdout.on("data", (d) => {
  buffer += d.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) handleLine(line);
});

proc.stderr.on("data", (d) => process.stderr.write(d));

// ── MCP handshake ──

proc.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: ++msgId,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "add-outlook-script" } },
  }) + "\n",
);

new Promise((resolve, reject) => {
  setTimeout(() => reject(new Error("initialize timeout")), 10000);
  resolveNext = resolve;
}).then(() => {
  proc.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
  );
}).then(() => main());

async function main() {
  // ── Step 1: Call add_account ──

  console.log("Step 1: Starting device-code flow...\n");
  const addResult = await mcpCall("add_account", {
    provider: "outlook",
  });

  const addContent = addResult?.content?.[0]?.text;
  if (!addContent) {
    console.error("Unexpected response from add_account");
    proc.kill();
    process.exit(1);
  }

  const parsed = JSON.parse(addContent);
  if (parsed.status === "ready") {
    console.log("Account already authenticated and added.");
    proc.kill();
    process.exit(0);
  }

  if (parsed.status !== "pending") {
    console.error("Unexpected status:", parsed.status);
    proc.kill();
    process.exit(1);
  }

  // ── Step 2: Show verification URL ──

  const { userCode, verificationUri, message } = parsed.verification ?? {};
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Open this URL in your browser:");
  console.log(`  ${verificationUri}`);
  console.log();
  console.log("  Enter this code:");
  console.log(`  ${userCode}`);
  console.log();
  console.log(`  ${message}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log();

  // ── Step 3: Poll for completion ──

  console.log("Step 3: Waiting for you to complete authentication...");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const completeResult = await mcpCall("complete_add_account", {
        handle: parsed.handle,
      });

      const cText = completeResult?.content?.[0]?.text;
      if (!cText) continue;

      const cParsed = JSON.parse(cText);
      if (cParsed.status === "ready") {
        console.log(`\n✅ Account added: ${cParsed.account?.email ?? "unknown"}`);
        proc.kill();
        process.exit(0);
      }
      if (cParsed.status === "expired") {
        console.error("\n❌ Device code expired. Please run again.");
        proc.kill();
        process.exit(1);
      }
      if (cParsed.status === "error") {
        console.error(`\n❌ ${cParsed.error}`);
        proc.kill();
        process.exit(1);
      }
    } catch {
      // retry
    }
  }

  console.error("\n❌ Timed out waiting for authentication (2.5 minutes).");
  proc.kill();
  process.exit(1);
}
