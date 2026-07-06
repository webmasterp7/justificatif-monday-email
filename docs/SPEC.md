# Receipt-to-Monday MVP Specification

## Architecture

A Dokploy-hosted Node.js service polls one dedicated Microsoft 365 mailbox, processes receipt emails, creates monday.com items, uploads receipt files, adds a summary update, and moves emails out of the inbox.

Power Automate is intentionally not used. The service talks directly to:

- Microsoft Graph for mailbox polling, attachment download, and message moves.
- Mistral OCR/LLM for PDF/image OCR, grouping, item naming, and field extraction.
- monday.com GraphQL API for item creation, updates, and file upload.

## Runtime configuration

All runtime settings are environment variables so Dokploy can own deployment configuration.

### Microsoft Graph

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MS_TENANT_ID` | yes | | Microsoft Entra tenant ID. |
| `MS_CLIENT_ID` | yes | | Azure app registration client ID. |
| `MS_CLIENT_SECRET` | yes | | Azure app client secret. |
| `MS_MAILBOX_USER_ID` | yes | | Dedicated mailbox user ID or user principal name. |
| `MS_INBOX_FOLDER` | no | `Inbox` | Source folder display name or well-known folder name. |
| `MS_PROCESSED_FOLDER` | no | `Processed` | Folder to move successfully processed emails into. |
| `MS_REVIEW_FOLDER` | no | `Review` | Folder to move unsupported, uncertain, or failed emails into. |

Required Graph application permission: `Mail.ReadWrite`, with admin consent. The app should be restricted to the dedicated mailbox using Exchange Online RBAC for Applications or an application access policy when possible.

### Polling and workflow

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `POLL_INTERVAL_MINUTES` | no | `15` | Mailbox polling interval. |
| `MAX_MESSAGES_PER_POLL` | no | `10` | Maximum inbox messages to inspect per poll. |
| `AUTO_CREATE_CONFIDENCE_THRESHOLD` | no | `0.7` | Minimum classifier confidence for normal item creation. |
| `UPLOAD_RETRY_ATTEMPTS` | no | `3` | File upload retry attempts before review/error routing. |
| `UPLOAD_RETRY_DELAY_MS` | no | `1000` | Initial retry delay. |

### Mistral

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MISTRAL_API_KEY` | yes | | Mistral API key. |
| `MISTRAL_OCR_MODEL` | no | `mistral-ocr-latest` | OCR model. |
| `MISTRAL_CHAT_MODEL` | no | `mistral-small-latest` | Chat model for grouping/extraction. |

### monday.com

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MONDAY_API_TOKEN` | yes | | monday.com API token. |
| `MONDAY_BOARD_ID` | yes | | Fixed target board ID. |
| `MONDAY_GROUP_ID` | no | | Optional target group ID. |
| `MONDAY_API_VERSION` | no | `2024-10` | monday.com API version header. |

Fixed MVP column IDs:

| Column | ID | Type | Source |
| --- | --- | --- | --- |
| `Facture` | `file_mm1ca2x1` | file | Uploaded receipt file(s). |
| `Date de Réception` | `date_mm1c40cq` | date | Email received date. |
| `Date de Paiement` | `date_mm1ca3zv` | date | Extracted from receipt when present. |
| `Reference Facture` | `text_mm1g3ajw` | text | Extracted invoice/reference number when present. |
| `Montant Facture` | `numeric_mm1chk67` | numbers | Extracted invoice amount when present. |
| `Notes Particulières` | `long_text_mm38snee` | long_text | Summary of email content and processing notes. |
| `Soumis par` | `text_mm3seznv` | text | Sender display name/email. |
| `Type de facture` | `dropdown_mm3sz6mp` | dropdown | `Factures` or `Carte`. |

## Accepted attachments

Automatically accepted attachments are non-inline files with these MIME types or matching extensions:

- PDF: `application/pdf`, `.pdf`
- JPEG: `image/jpeg`, `.jpg`, `.jpeg`
- PNG: `image/png`, `.png`
- WebP: `image/webp`, `.webp`
- HEIC/HEIF: `image/heic`, `image/heif`, `.heic`, `.heif`

Unsupported attachments route the email to the review/error path. Body-only receipts are also review/error cases for the MVP.

## Classification/extraction contract

The classifier receives:

- Source email metadata: sender name/email, subject, received date, and a compact email body summary/text.
- Accepted attachment metadata: stable attachment ID, filename, MIME type, size.
- OCR markdown per accepted attachment.

It must return JSON matching this shape:

```json
{
  "decision": "create_items" | "review",
  "confidence": 0.0,
  "reviewReason": "string or null",
  "emailSummary": "short summary of the email body/content",
  "receiptGroups": [
    {
      "itemName": "merchant/date/reference style monday item name",
      "confidence": 0.0,
      "groupingExplanation": "why these files belong together",
      "attachmentIds": ["attachment-id-1"],
      "referenceFacture": "invoice/reference number or null",
      "montantFacture": 123.45,
      "datePaiement": "YYYY-MM-DD or null",
      "typeDeFacture": "Factures" | "Carte",
      "notesParticulieres": "email summary plus receipt-specific notes"
    }
  ]
}
```

Validation rules:

- `decision=review` always routes to Error/Review.
- Any group below `AUTO_CREATE_CONFIDENCE_THRESHOLD` routes the email to Error/Review.
- Every `attachmentIds[]` entry must refer to an accepted attachment from the email.
- Every accepted attachment should be assigned to exactly one group for normal creation.
- `typeDeFacture` must be exactly `Factures` or `Carte`; unknown values become `Factures` only when the model gives a clear rationale, otherwise Review.
- Dates must be ISO `YYYY-MM-DD`; invalid dates are omitted and mentioned in the update/log.
- Amounts must be numeric decimal values; invalid amounts are omitted and mentioned in the update/log.

## monday item payload mapping

For each normal receipt group:

- Item name: classifier `itemName`.
- `Date de Réception`: source email received date.
- `Date de Paiement`: `datePaiement` when present.
- `Reference Facture`: `referenceFacture` when present.
- `Montant Facture`: `montantFacture` when present.
- `Notes Particulières`: email-automation provenance marker, source email link (`Lien email: ...`), and `notesParticulieres` or the email summary.
- `Soumis par`: sender display name, falling back to sender email.
- `Type de facture`: dropdown label from `typeDeFacture`.
- `Facture`: uploaded after item creation via `add_file_to_column`.

Then add an item update summarizing:

- What was added.
- For which receipt/invoice/reference/amount.
- Who submitted it.
- Source email subject, received date, and source email web link.
- Attached filenames.
- Grouping explanation and confidence.
- Any omitted fields or warnings.

## Error/Review representation

The provided column list has no dedicated status column. For the MVP, Error/Review cases are represented in the same board by:

- Item name prefixed with `[INCOMPLET]`.
- `Date de Réception` from the source email when available.
- `Notes Particulières` containing the email-automation provenance marker, source email link (`Lien email: ...`), error/review reason, and email summary.
- `Soumis par` populated from the sender.
- `Type de facture` set to `Factures` by default only to satisfy dropdown requirements if monday requires a value.
- A monday update containing the detailed reason, source context, attachment list, and next action.

If a status column is later added to the board, the implementation should support configuring it without changing the core workflow.

## Email routing

- Normal successful processing: move source email to `Processed`.
- Review/error processing: create an Error/Review item, then move source email to `Review`.
- If monday item creation succeeds but file upload fails: retry uploads first. If retries are exhausted, add an update to the created item if possible, create/log the Error/Review path, and move the email to `Review`.
- Duplicate detection is intentionally not implemented. Re-sent emails create new monday.com items.
