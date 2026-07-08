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
| `MISTRAL_CHAT_MODEL` | no | `mistral-large-latest` | Chat model for grouping/extraction. |

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
| `Notes Particulières` | `long_text_mm38snee` | long_text | Automation provenance and notes. |
| `Soumis par` | `text_mm3seznv` | text | Sender display name/email. |
| `Type de facture` | `dropdown_mm3sz6mp` | dropdown | `Carte` for card-paid/card-debited invoices or receipts; `Factures` for bank-transfer invoices only when QR/QR-facture evidence and IBAN/QR-IBAN/bank-transfer evidence are present. |
| `Provenance suggérée` | `dropdown_mm50vh09` | dropdown | Cloned label for suggested provenance/issuer. |
| `État de la Facture` | *(board-configured)* | dropdown | Deterministic workflow value: `Facture Reçue`. |

The legacy `Site` column is intentionally not filled by this automation.

## Accepted attachments

Automatically accepted attachments are non-inline files with these MIME types or matching extensions:

- PDF: `application/pdf`, `.pdf`
- JPEG: `image/jpeg`, `.jpg`, `.jpeg`
- PNG: `image/png`, `.png`
- WebP: `image/webp`, `.webp`
- HEIC/HEIF: `image/heic`, `image/heif`, `.heic`, `.heif`

Unsupported attachments route the email to the review/error path. Body-only receipts are also review/error cases for the MVP.

## Classification/extraction contract

The LLM receives:

- Full stripped email/thread text (HTML removed), including reply/forward context.
- Sender metadata: display name, sender email, and sender context.
- Accepted attachment metadata: stable attachment ID, filename, MIME type, size.
- OCR markdown per accepted attachment.

It must return JSON matching this shape:

```json
{
  "decision": "create_items" | "review",
  "confidence": 0.0,
  "reviewReason": "string or null",
  "emailSummary": "short summary of the stripped email/thread",
  "receiptGroups": [
    {
      "itemName": "concise French payment/service title without full date or invoice/reference number, e.g. Abonnement serveur Hetzner juillet",
      "groupStatus": "Nouveau" | "Attention",
      "groupConfidence": 0.0,
      "groupingExplanation": "why these files belong together",
      "groupingStatus": "CONFIDENT|UNCERTAIN",
      "attachmentIds": ["attachment-id-1"],
      "provenanceSuggeree": {
        "value": "label or null",
        "status": "CONFIDENT|APPROXIMATE|UNKNOWN",
        "reason": "optional"
      },
      "referenceFacture": {
        "value": "invoice/reference number or null",
        "status": "CONFIDENT|UNCERTAIN|MISSING|INVALID",
        "reason": "optional"
      },
      "montantFacture": {
        "value": 123.45,
        "status": "CONFIDENT|UNCERTAIN|MISSING|INVALID",
        "reason": "optional"
      },
      "datePaiement": {
        "value": "YYYY-MM-DD or null",
        "status": "CONFIDENT|UNCERTAIN|MISSING|INVALID",
        "reason": "optional"
      },
      "notesParticulieres": "optional receipt-specific notes"
    }
  ]
}
```

Validation rules:

- `decision=review` always routes to Error/Review.
- Every group must include `groupStatus` (`Nouveau` or `Attention`) and at least one `attachmentIds[]` entry.
- `Nouveau` is valid only when required fields are `CONFIDENT` and provenance is `CONFIDENT`.
- `Attention` is required when any required field is `UNCERTAIN`, `MISSING`, or `INVALID`; provenance is not confident; grouping is uncertain; or unsupported content patterns are present (body-only, unsupported attachments).
- Every `attachmentIds[]` entry must refer to an accepted attachment from the email.
- Every accepted attachment should be assigned to exactly one group for normal creation.
- `itemName` must describe the payment/service purpose in French using available email/OCR evidence; it must not include full dates, invoice numbers, or reference numbers.
- For `CONFIDENT` status, `referenceFacture`/`montantFacture`/`datePaiement` must be valid (`YYYY-MM-DD` for dates; decimal for amounts). Otherwise set value to `null` and status accordingly.
- `typeDeFacture` must be `Carte` for invoices/receipts paid by card or to be debited from a card, including online-service invoices without QR/IBAN evidence.
- `typeDeFacture` must be `Factures` only for bank-transfer invoices with QR/QR-facture/Swiss QR evidence plus IBAN/QR-IBAN/bank-transfer evidence; invoice wording, invoice numbers, payment references, or amount-due wording alone are not sufficient.

## monday item payload mapping

For each normal receipt group:

- Item name: classifier `itemName`.
- `Date de Réception`: source email received date.
- `Date de Paiement`: `datePaiement.value` when status is `CONFIDENT`.
- `Reference Facture`: `referenceFacture.value` when status is `CONFIDENT`.
- `Montant Facture`: `montantFacture.value` when status is `CONFIDENT`.
- `Provenance suggérée`: `provenanceSuggeree.value` when present.
- `État de la Facture`: always `Facture Reçue`.
- `Type de facture`: classifier/evidence-adjusted value (`Carte` for card-paid/card-debited receipts or invoices; `Factures` for bank-transfer invoices with QR plus IBAN/bank-transfer evidence).
- `Notes Particulières`: `Ajouté automatiquement par email`.
  - If `groupStatus` is `Attention`, append `Attention: ...` for missing/uncertain required fields, approximate provenance, unsupported content, or grouping uncertainty.
- `Soumis par`: sender display name, falling back to sender email.
- `Facture`: uploaded after item creation via `add_file_to_column`.
- `Statut`: normal receipt items are created as `Attention` first, then promoted to `Nouveau` only after file upload, email move, final update creation, and all validation checks succeed.

Then add an item update summarizing:

- What was added.
- For which receipt/invoice/reference/amount.
- Who submitted it.
- Source email subject, received date, and source-email link. The workflow uses Microsoft Graph immutable IDs for API operations, translates the moved message back to a REST ID, and renders a mailbox-scoped Outlook Web link for the configured mailbox.
- Full stripped email/thread content.
- Attached filenames.
- Grouping explanation and confidence.
- Per-field statuses and warnings.

If `Attention` reasons exist, add a second dedicated attention update after the summary update. Date-payment attention reasons for `Carte` items are deduplicated to a single French reason.

If the stripped thread exceeds monday limits, truncate it and note truncation in the update.

## Error/Review representation

Error/Review cases are represented in the same board as standard `Attention` items by:

- Item name from the source email subject/id, without a special prefix.
- `Statut`: `Attention`.
- `Date de Réception` from the source email when available.
- `Notes Particulières`: `Ajouté automatiquement par email` plus `Attention: ...` reasons.
- `Provenance suggérée` set from model suggestion when available.
- `Type de facture` set from the same classifier/evidence-adjusted rules when available; fallback review items use `Factures` by default.
- A monday update containing the detailed attention reason, source context, attachment list, field statuses, and next action.

`Nouveau` and `Attention` are the document-level status values for this plan.

If a status column is later added to the board, the implementation should support configuring it without changing the core workflow.

## Email routing

- Normal successful processing: create item initially as `Attention`, upload `Facture` files, move source email to `Processed`, post the final monday summary update with the source-email link, post a dedicated attention update when reasons exist, then promote to `Nouveau` only when no attention reasons remain.
- Review/error processing: create an `Attention` item, then move source email to `Review`, then post the final monday update with the source-email link and `Attention` reasons.
- If monday item creation succeeds but file upload fails: retry uploads first. If retries are exhausted, add an update to the created item if possible, create/log the Error/Review path, and move the email to `Review`.
- If final update posting fails after move, retry with backoff, keep the item in `Attention`, and emit structured logs for manual follow-up.
- Microsoft Graph requests use `Prefer: IdType="ImmutableId"` for stable API operations after moves. For human Outlook links, the moved message ID is translated back to `restId` and rendered as a mailbox-scoped Outlook Web deeplink.
- Duplicate detection is intentionally not implemented. Re-sent emails create new monday.com items.
