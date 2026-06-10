# Deploy justificatif-monday-email to Dokploy

Dockerfile-only deployment — no compose file. Everything is configured in the Dokploy UI.

## Prerequisites

- A domain pointed at your VPS (e.g. `mail-api.example.com`)
- Dokploy installed and connected to your Git provider
- Azure/Entra ID app registration (for Outlook OAuth)
- A monday.com board with columns for sender, email, subject, and date
- The monday.com column IDs (discover via API or monday.com UI)

## Step-by-step

### 1. Prepare the repository

This repo needs the hypermail-mcp source as a submodule:

```bash
git submodule add https://github.com/mateotiedra/hypermail-mcp.git hypermail-mcp
git submodule update --init --recursive
pnpm build  # compiles src/on-email.ts → dist/on-email.mjs
git add hypermail-mcp dist/ Dockerfile hypermail-config.json
git commit -m "Add hypermail-mcp submodule and Dockerfile"
git push
```

### 2. Create the Application in Dokploy

1. **Create Service** → **Application**
2. Select your Git provider, repository, and branch
3. **Build Path**: `/` (root of repo — where the Dockerfile lives)
4. **Save**

### 3. Set environment variables

Go to the **Environment** tab and add:

| Variable | Description |
|----------|-------------|
| `HYPERMAIL_MCP_KEY` | Run `openssl rand -hex 32` and paste the output |
| `MS_CLIENT_ID` | Azure/Entra ID public client ID |
| `MS_TENANT_ID` | Azure/Entra ID tenant ID (or `common`) |
| `MONDAY_API_TOKEN` | monday.com API v2 token |
| `MONDAY_BOARD_ID` | Numeric board ID |
| `MONDAY_GROUP_ID` | Group ID for new items (defaults to `topics`) |
| `MONDAY_COL_SENDER` | Column ID for sender name (text column) |
| `MONDAY_COL_EMAIL` | Column ID for sender email (text column) |
| `MONDAY_COL_SUBJECT` | Column ID for subject (text column) |
| `MONDAY_COL_DATE` | Column ID for received date (date column) |

**Optional:**

| Variable | Default | Description |
|----------|---------|-------------|
| `HYPERMAIL_WATCH_SCRIPT_TIMEOUT_MS` | `30000` | Max ms before killing the script |
| `HYPERMAIL_WATCH_SCRIPT_RETRY_MAX_ATTEMPTS` | `5` | Retries before giving up |
| `MONDAY_SKIP_VALIDATION` | (off) | Set to `true` to skip column ID validation |

### 4. Configure persistent storage

Go to **Advanced** → **Mounts** → add a bind mount:

| Host path | Container path |
|-----------|---------------|
| `../files/data` | `/data` |

This persists your encrypted OAuth tokens and lastSeenIds across redeploys. Dokploy creates the host path automatically on first deploy.

### 5. Add a domain

Go to the **Domains** tab → **Add Domain** → enter your domain (e.g. `mail-api.example.com`).

Dokploy auto-generates Traefik routing and provisions a Let's Encrypt TLS certificate on deploy. No manual config needed.

### 6. Deploy

Click **Deploy**. Check **Logs** — you should see:

```
[hypermail-mcp] listening on http://0.0.0.0:3000/mcp
```

### 7. Add an email account

Use the MCP tools to add your Outlook account:

```json
{
  "mcpServers": {
    "hypermail": {
      "type": "streamableHttp",
      "url": "https://mail-api.example.com/mcp"
    }
  }
}
```

Then call `add_account` with `provider: "outlook"`. Follow the device-code URL to authenticate.

### 8. Verify end-to-end

Send a test email to the monitored inbox. Within 60 seconds, you should see log lines like:

```
[hypermail-watch] script test-msg-id attempt 1/5: <exit or error>
```

And a new row on your monday.com board with the sender, subject, and date.

## Troubleshooting

**"MONDAY_API_TOKEN is not set"** → Check the Environment tab in Dokploy and redeploy.

**"column not found on board"** → The column IDs are wrong or the board was modified. Update the `MONDAY_COL_*` env vars in Dokploy. Check the board schema via:

```bash
curl -H "Authorization: <token>" -H "Content-Type: application/json" \
  -d '{"query":"{boards(ids:[<board_id>]){columns{id title type}}}"}' \
  https://api.monday.com/v2
```

**Script timed out** → monday.com API might be slow. Increase `HYPERMAIL_WATCH_SCRIPT_TIMEOUT_MS` to `60000` in the Environment tab.
