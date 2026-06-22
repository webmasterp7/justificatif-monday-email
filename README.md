# Receipt-to-Monday Automation

Node.js service for processing receipt emails from a dedicated Microsoft 365 mailbox and creating monday.com items with receipt files attached.

## MVP flow

1. Poll Microsoft 365 every 15 minutes by default.
2. Download PDF/image receipt attachments.
3. Use Mistral OCR/LLM for grouping, item naming, and selected field extraction.
4. Create one monday.com item per receipt group.
5. Upload receipt files to the `Facture` file column.
6. Add a monday.com update summarizing what was processed.
7. Move successful emails to `Processed`; move review/error emails to `Review`.

See [`docs/SPEC.md`](docs/SPEC.md) for the implementation contract.

## Development

```bash
pnpm install
pnpm dev
pnpm test
pnpm build
```

## Deployment

Designed for Dokploy using the provided `Dockerfile`. Configure secrets and runtime settings through environment variables; start from `.env.example`.

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the Dokploy checklist, Microsoft Graph permissions, monday.com board/column requirements, environment variables, and operational failure semantics.
