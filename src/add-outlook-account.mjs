/**
 * add-outlook-account.mjs — Run INSIDE the hypermail-mcp container to
 * add an Outlook account via the device-code OAuth flow.
 *
 * Usage: docker exec -it <container> node /scripts/add-outlook-account.mjs
 */

import { spawn } from "node:child_process";

const MS_CLIENT_ID = process.env.MS_CLIENT_ID ?? "";
const MS_TENANT_ID = process.env.MS_TENANT_ID ?? "common";
const DATA_DIR = "/data";
const MCP_KEY = process.env.HYPERMAIL_MCP_KEY;

if (!MCP_KEY) {
  console.error("HYPERMAIL_MCP_KEY is not set in the container");
  process.exit(1);
}

// ── Step 1: Call add_account ──

function callMCP(method: string, params: Record<string, unknown>) {
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: method,
      arguments: params,
    },
  });

  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn("node", ["dist/cli.js", "--data-dir", DATA_DIR], {
      env: {
        ...process.env,
        MS_CLIENT_ID,
        MS_TENANT_ID,
        HYPERMAIL_MCP_KEY: MCP_KEY,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.on("data", (d) => chunks.push(d));
    proc.stderr.on("data", (d) => process.stderr.write(d));

    let buffer = "";
    proc.stdout.on("data", (d) => {
      buffer += d.toString();
      // MCP stdio transport sends JSON-RPC messages on stdout
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1 && msg.result) {
            proc.kill();
            resolve(msg.result);
          }
          if (msg.error) {
            proc.kill();
            reject(new Error(msg.error.message));
          }
        } catch {}
      }
    });

    proc.stdin.write(body + "\n");
    setTimeout(() => {
      proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    }, 100);

    setTimeout(() => {
      proc.kill();
      reject(new Error("timeout"));
    }, 120000);
  });
}

console.log("Step 1: Starting device-code flow...\n");
const result = await callMCP("add_account", {
  provider: "outlook",
}).catch((err) => {
  console.error("add_account failed:", err.message);
  process.exit(1);
});

const content = result?.content?.[0]?.text;
if (!content) {
  console.error("Unexpected response from add_account");
  process.exit(1);
}

const parsed = JSON.parse(content);
if (parsed.status === "ready") {
  console.log("Account already authenticated and added.");
  process.exit(0);
}

if (parsed.status !== "pending") {
  console.error("Unexpected status:", parsed.status);
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
  const completeResult = await callMCP("complete_add_account", {
    handle: parsed.handle,
  }).catch(() => null);

  if (!completeResult) continue;

  const cText = completeResult?.content?.[0]?.text;
  if (!cText) continue;

  const cParsed = JSON.parse(cText);
  if (cParsed.status === "ready") {
    console.log(`\n✅ Account added: ${cParsed.account?.email ?? "unknown"}`);
    process.exit(0);
  }
  if (cParsed.status === "expired") {
    console.error("\n❌ Device code expired. Please run again.");
    process.exit(1);
  }
  if (cParsed.status === "error") {
    console.error(`\n❌ ${cParsed.error}`);
    process.exit(1);
  }
}

console.error("\n❌ Timed out waiting for authentication.");
process.exit(1);
