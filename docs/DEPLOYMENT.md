# Dokploy Deployment Checklist

## 1. Microsoft 365 / Azure app

Create or use an Azure app registration for unattended Microsoft Graph access.

Required Microsoft Graph application permission:

- `Mail.ReadWrite` with admin consent.

Recommended restriction:

- Scope the app to only the dedicated receipt mailbox using Exchange Online RBAC for Applications or an application access policy.

Mailbox folders expected by the service:

- Source inbox: `Inbox` by default.
- Success folder: `Processed` by default.
- Error/review folder: `Review` by default.

The configured mailbox must have these folders before deployment, or the corresponding env vars must point to valid folder names/IDs.

## 2. monday.com board configuration

The MVP writes to one fixed board and optional group.

Required board columns:

| Column | ID | Type | Populated with |
| --- | --- | --- | --- |
| Facture | `file_mm1ca2x1` | file | Receipt attachment uploads. |
| Date de Réception | `date_mm1c40cq` | date | Email received date. |
| Date de Paiement | `date_mm1ca3zv` | date | Extracted payment date when present. |
| Reference Facture | `text_mm1g3ajw` | text | Extracted invoice/reference number. |
| Montant Facture | `numeric_mm1chk67` | numbers | Extracted invoice amount. |
| Notes Particulières | `long_text_mm38snee` | long_text | Automation provenance and notes (`Ajouté automatiquement par email` + `Attention` reasons). |
| Soumis par | `text_mm3seznv` | text | Sender name/email. |
| Type de facture | `dropdown_mm3sz6mp` | dropdown | Left blank by default (legacy category no longer used); use `Factures` only if a value is required. |
| Provenance suggérée | `dropdown_mm50vh09` | dropdown | Suggested provenance/issuer (cloned from Site labels). |
| État de la Facture | *(board-configured)* | dropdown | Deterministic workflow value: `Facture Reçue`. |

The legacy `Site` column is intentionally not filled by this automation.

Every created item also receives a monday.com update summarizing:

- What was added.
- Receipt/invoice reference and amount when available.
- Who submitted it.
- Source email subject, received date, and source email link. The service uses Microsoft Graph immutable IDs for API operations, then translates moved messages back to REST IDs to render mailbox-scoped Outlook Web links.
- Full stripped email/thread content.
- Attached file names.
- OCR/classification confidence, grouping explanation, and field-level status notes.

If review or attention reasons exist, the service adds a second dedicated attention update after the summary update. Duplicate same-field attention reasons are collapsed to one French reason where possible.

If the stripped thread exceeds monday limits, the update text is truncated with an explicit truncation marker.

Created items are identifiable as email-automation-created through `Notes Particulières` (including default `Ajouté automatiquement par email` and `Attention` reasons), provenance fields, and detailed item updates with source email links.

Review/error items use the same board and are represented as standard `Attention` items: no special item-name prefix, with reasons in `Notes Particulières` and item updates.

## 3. Dokploy environment variables

Set these variables in Dokploy.

### Required

```dotenv
MS_TENANT_ID=
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_MAILBOX_USER_ID=
MISTRAL_API_KEY=
MONDAY_API_TOKEN=
MONDAY_BOARD_ID=
```

### Optional

```dotenv
MS_INBOX_FOLDER=Inbox
MS_PROCESSED_FOLDER=Processed
MS_REVIEW_FOLDER=Review
POLL_INTERVAL_MINUTES=15
MAX_MESSAGES_PER_POLL=10
AUTO_CREATE_CONFIDENCE_THRESHOLD=0.7
UPLOAD_RETRY_ATTEMPTS=3
UPLOAD_RETRY_DELAY_MS=1000
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_CHAT_MODEL=mistral-large-latest
MONDAY_GROUP_ID=
MONDAY_API_VERSION=2024-10
```

## 4. Build/deploy

The repository includes a Dockerfile designed for Dokploy.

Local checks before deploy:

```bash
pnpm install
pnpm test
pnpm build
pnpm lint
```

For deterministic workflow regression checks, run the dry-run fixture simulation:

```bash
pnpm run test:factures-simulation
```

(see [`docs/FACTURES_SIMULATION.md`](FACTURES_SIMULATION.md) for scenarios and fixture conventions).

Dokploy should build the Docker image and run:

```bash
node dist/index.js
```

## 5. Operations

### Successful emails

- Creates one monday.com item per detected receipt group.
- Uploads receipt files to `Facture`.
- Moves the source email to `Processed`.
- Adds a final summary update, plus a dedicated attention update when attention reasons exist.

### Review/error emails

The service creates a same-board `Attention` item and moves the source email to `Review` when:

- The email has no attachments/body-only receipt.
- Attachments are unsupported types.
- OCR fails.
- Classifier output is invalid or `Attention`.
- Grouping is ambiguous.
- monday.com item/file/update creation fails.
- File upload retries are exhausted after item creation.

The review item includes a detailed update with `Attention` reasons and the source email link. Graph requests use `Prefer: IdType="ImmutableId"` for stable API operations after moves; human Outlook links are generated as mailbox-scoped deeplinks from translated REST IDs.

### Intentional duplicate behavior

No duplicate suppression exists in the MVP. If the same receipt is forwarded twice, the service creates another monday.com item.

### Logs

The MVP has no database. Use Dokploy container logs for traceability. Logs are JSON lines containing message IDs, subjects, sender, route decisions, monday item/update IDs, retry attempts, and error reasons (including final-update success/failure and truncation events).
