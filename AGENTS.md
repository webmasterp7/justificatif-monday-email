# Project Instructions

- Never use monday.com MCP tools to modify monday.com data unless the user explicitly asks for a specific write action. Treat monday.com MCP usage as read-only by default.

# Project Memory

## Purpose

This project is a Dokploy-hosted Node.js/TypeScript automation that processes receipt emails from a dedicated Microsoft 365 mailbox and creates monday.com items with receipt files attached.

## Current architecture

- Runtime: Node.js with TypeScript, ESM modules.
- Package manager: pnpm (`packageManager` is pinned in `package.json`). Do not use npm for dependency installation or lockfile updates.
- Hosting target: Dokploy using the root `Dockerfile`.
- Email provider: Microsoft 365 via Microsoft Graph application permissions.
- OCR/classification: Mistral OCR plus Mistral chat completion.
- Destination: one fixed monday.com board.
- Persistence: no database in the MVP. Detailed traceability is emitted as JSON console logs for Dokploy log inspection.

## Main workflow

1. Poll Microsoft Graph every 15 minutes by default; override with `POLL_INTERVAL_MINUTES`.
2. Read messages from the configured mailbox inbox/folder.
3. Accept only non-inline PDF/image attachments.
4. Route missing, body-only, unsupported, ambiguous, or failed emails to Review.
5. OCR accepted attachments with Mistral.
6. Classify/group receipts and extract the configured monday.com fields.
7. Create one monday.com item per receipt group.
8. Upload grouped files to the `Facture` file column.
9. Add a monday.com update summarizing what was added, for what, by who, source email context, files, and confidence/warnings.
10. Move successful emails to `Processed`; move review/error emails to `Review`.

## monday.com columns

The MVP uses these fixed column IDs:

| Column | ID | Type | Usage |
| --- | --- | --- | --- |
| Facture | `file_mm1ca2x1` | file | Uploaded receipt files |
| Date de Réception | `date_mm1c40cq` | date | Email received date |
| Date de Paiement | `date_mm1ca3zv` | date | Extracted payment date when present |
| Reference Facture | `text_mm1g3ajw` | text | Extracted invoice/reference |
| Montant Facture | `numeric_mm1chk67` | numbers | Extracted amount |
| Notes Particulières | `long_text_mm38snee` | long_text | Email summary / review reason |
| Soumis par | `text_mm3seznv` | text | Sender name/email |
| Type de facture | `dropdown_mm3sz6mp` | dropdown | `Factures` or `Carte` |

There is no dedicated status column in the current schema. Review/error items are represented in the same board by `[INCOMPLET]` item-name prefixes, `Notes Particulières`, and a detailed item update.

## Important files

- `docs/SPEC.md` — implementation contract and classification schema.
- `docs/DEPLOYMENT.md` — Dokploy, Azure/Microsoft Graph, monday.com, and operational checklist.
- `.env.example` — all required/optional environment variables.
- `src/config.ts` — environment validation and fixed monday column IDs.
- `src/workflow.ts` — orchestration and routing logic.
- `src/clients/graph.ts` — Microsoft Graph mail client.
- `src/clients/mistral.ts` — Mistral OCR/classification client.
- `src/clients/monday.ts` — monday.com GraphQL/file/update client.
- `src/mondayPayload.ts` — monday column payload and update body builders.
- `tests/` — unit and mocked workflow tests.

## Infrastructure and operations

- Required Dokploy env vars: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_MAILBOX_USER_ID`, `MISTRAL_API_KEY`, `MONDAY_API_TOKEN`, `MONDAY_BOARD_ID`.
- Microsoft Graph app permission required: application `Mail.ReadWrite` with admin consent.
- Prefer restricting Microsoft Graph access to only the dedicated mailbox via Exchange Online RBAC for Applications or an application access policy.
- Expected mailbox folders: `Inbox`, `Processed`, `Review` unless overridden by env vars.
- monday file uploads use `/v2/file` and `add_file_to_column` for column `file_mm1ca2x1`.
- Duplicate suppression is intentionally not implemented; repeated/forwarded receipts create new monday.com items.

## Development commands

Use pnpm:

```bash
pnpm install
pnpm test
pnpm build
pnpm lint
```
