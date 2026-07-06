# Code Context: Automation Marker on monday.com Items

## Files Retrieved

| File | Lines | Relevance |
|---|---|---|
| `src/workflow.ts` | 1–138 | Orchestration: item creation, naming, and review routing |
| `src/mondayPayload.ts` | 1–99 | Column-value builders and update-body builders |
| `src/config.ts` | 1–148 | Fixed column IDs and env‑driven config |
| `src/types.ts` | 1–82 | MondayColumnValues, ReceiptGroup, EmailMessage types |
| `src/clients/monday.ts` | 1–137 | Monday.com GraphQL client (createItem, createUpdate, uploadFile) |
| `src/invoiceTypeEvidence.ts` | 1–79 | Invoice-type overrides (Carte vs Factures) |
| `tests/unit.test.ts` | 1–107 | Unit tests for payloads, config, classification, client |
| `tests/workflow.test.ts` | 1–195 | Workflow integration tests |
| `docs/SPEC.md` | 1–150 | Implementation contract and classification schema |
| `docs/DEPLOYMENT.md` | 1–100 | Deployment and board configuration doc |

## Key Code

### 1. Normal item creation — no automation marker on the item itself

In `src/workflow.ts` (lines 100–123), the `createReceiptItems` method builds an item with the classifier's `itemName` verbatim:

```typescript
const item = await this.monday.createItem({
  itemName: group.itemName,                         // <-- raw classifier output, e.g. "Merchant receipt"
  columnValues: buildColumnValuesForReceipt(message, group),
});
```

The `buildColumnValuesForReceipt` function (`src/mondayPayload.ts`, lines 30–40) populates columns with receipt data only — no automation marker:

```typescript
export function buildColumnValuesForReceipt(email: EmailMessage, group: ReceiptGroup): MondayColumnValues {
  return {
    dateReception: toDateOnly(email.receivedDateTime),
    datePaiement: group.datePaiement,
    referenceFacture: group.referenceFacture,
    montantFacture: group.montantFacture,
    notesParticulieres: group.notesParticulieres,
    soumisPar: email.sender.name || email.sender.email,
    typeDeFacture: group.typeDeFacture,
  };
}
```

The automation is only mentioned in the **item update** (not the item itself), in `buildUpdateBody` (`src/mondayPayload.ts`, lines 42–62):

```typescript
return [
  '<p>Justificatif ajouté automatiquement depuis l\'email dédié.</p>',
  ...
```

### 2. Review item creation — `[REVUE]` prefix signals review, not automation

In `src/workflow.ts` (lines 159–166), review items get a prefix but no automation marker:

```typescript
const item = await this.monday.createItem({
  itemName: `[REVUE] ${message.subject || message.id}`,
  columnValues: { ... },
});
```

The `[REVUE]` prefix indicates "needs human review" — it does not distinguish email-automation from manual creation.

### 3. Monday client — no naming logic beyond dev prefix

`src/clients/monday.ts` (lines 60–69) applies a `Test - ` prefix in `NODE_ENV=development` but no automation marker:

```typescript
function withDevelopmentPrefix(itemName: string): string {
  if (process.env.NODE_ENV !== 'development' || itemName.startsWith('Test -')) {
    return itemName;
  }
  return `Test - ${itemName}`;
}
```

### 4. The `MondayColumnValues` type has no automation-related field

`src/types.ts` (lines 44–53) — no boolean/string field for automation provenance:

```typescript
export interface MondayColumnValues {
  dateReception?: string;
  datePaiement?: string | null;
  referenceFacture?: string | null;
  montantFacture?: number | null;
  notesParticulieres: string;
  soumisPar: string;
  typeDeFacture: InvoiceType;
}
```

### 5. Config has no automation-marker column

`src/config.ts` (lines 5–15) — the fixed column-IDs map has no column for "added by automation":

```typescript
export const MONDAY_COLUMNS = {
  facture: 'file_mm1ca2x1',
  dateReception: 'date_mm1c40cq',
  datePaiement: 'date_mm1ca3zv',
  referenceFacture: 'text_mm1g3ajw',
  montantFacture: 'numeric_mm1chk67',
  notesParticulieres: 'long_text_mm38snee',
  soumisPar: 'text_mm3seznv',
  typeDeFacture: 'dropdown_mm3sz6mp',
} as const;
```

## Architecture

```
Email arrives in Inbox
       │
       v
ReceiptWorkflow.processMessage()
       │
       ├── filterReceiptAttachments()      → unsupported → routeToReview (creates [REVUE] item)
       │
       ├── OCR + classifyReceipts()        → low-confidence → routeToReview
       │
       ├── applyInvoiceTypeEvidence()      → conflicting evidence → routeToReview
       │
       └── createReceiptItems()            → normal items with NO automation marker
              │
              ├── monday.createItem({ itemName: group.itemName, columnValues: ... })
              ├── monday.uploadFile()
              └── monday.createUpdate({ body: "Justificatif ajouté automatiquement..." })
```

**Normal items** have automation provenance only in the **update** (a separate entity, not visible on the board's column view). The item name, all column values, and file attachments contain receipt data only.

**Review items** get a `[REVUE]` item-name prefix, but this flags "needs review," not "created by the email automation."

## Start Here

Open `src/workflow.ts` lines 100–123 (`createReceiptItems` method). This is where the normal item's name and column values are assembled — it is the single point where an automation marker would be injected into the item itself.

## Key Finding

**monday.com items created by the email automation are NOT visibly marked on the item itself.** The automation provenance is only present in the item's update section (a separate entity that is not visible in the board's column/card view). Review items get a `[REVUE]` prefix, but this signals "needs human review," not "created by automation," and only applies to the error/review path.

## Smallest Code/Doc/Test Changes to Add an Item-Level Automation Marker

### Approach A: Item-name prefix (least invasive, no schema change)

**Rationale**: Touch only the item-name string — no board-column changes, no new column IDs, no env‑var additions. Follows the existing pattern that review items use `[REVUE]` prefixes.

**Changes needed**:

| File | Change |
|---|---|
| `src/workflow.ts` ~line 118 | Change `itemName: group.itemName` → `itemName: \`[AUTO] ${group.itemName}\`` in `createReceiptItems` |
| `tests/workflow.test.ts` ~line 53 | Update `createItem` expectation to match `[AUTO] Merchant receipt` |
| `tests/unit.test.ts` ~line 84 | If the `buildUpdateBody` test checks item name indirectly, no change needed — item name is not tested in unit tests |
| `docs/SPEC.md` §"monday item payload mapping" | Document that normal items get the `[AUTO]` prefix |
| `docs/DEPLOYMENT.md` §"Successful emails" | Add note about the `[AUTO]` prefix |

**Risks**:
- The development prefix (`Test - `) in `withDevelopmentPrefix` interacts: in dev mode, items become `Test - [AUTO] Merchant receipt`. This looks slightly awkward but is benign.
- If users rename items manually, the prefix stays — but this is identical to how `[REVUE]` works today.

### Approach B: Stamp automation note into `Notes Particulières` (no schema change)

Append `\n[Ajouté automatiquement par l'email justificatif]` to the `notesParticulieres` (or `notesParticulieres`) value.

**Changes needed**:

| File | Change |
|---|---|
| `src/workflow.ts` ~line 118 or `src/mondayPayload.ts` `buildColumnValuesForReceipt` | Append automation note to `notesParticulieres` |
| `tests/workflow.test.ts` | Update column-value assertion to include appended note |
| `docs/SPEC.md` | Note that `Notes Particulières` includes an automation provenance line |
| `docs/DEPLOYMENT.md` | Same |

**Risks**:
- The `notesParticulieres` value from the classifier is already placed here. Appending may push it over 2000 chars in extreme cases (review items truncate at 2000 in `workflow.ts` line 163). Not an issue for normal items because no truncation is applied there.
- This is less visible than a name prefix because the column may not be shown in the board's default view.

### Approach C: New dedicated column (most invasive, schema change required)

Add a new board column (e.g., a status or text column), wire its ID into `MONDAY_COLUMNS`, update `MondayColumnValues`, update both builders, update all tests, and update both docs.

**Not recommended unless a column-level filter is required** — it introduces board-schema coupling that Approach A and B avoid.

### Recommendation

**Approach A (item-name prefix)** is the smallest change — it mirrors the existing `[REVUE]` convention, requires no board-schema changes, and is visible in every board view. Estimated: 2 source lines changed, 1 test assertion updated, 2 doc sections updated.

---

## Acceptance Report

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Examined src/workflow.ts (createReceiptItems method), src/mondayPayload.ts (buildColumnValuesForReceipt, buildUpdateBody), src/types.ts (MondayColumnValues), src/config.ts (MONDAY_COLUMNS), src/clients/monday.ts (createItem), tests/workflow.test.ts, tests/unit.test.ts, docs/SPEC.md, docs/DEPLOYMENT.md. Confirmed that normal items have no automation marker: item name is raw classifier output, column values contain only receipt data, and the only automation reference is in the item update body. Review items get [REVUE] prefix but that signals 'needs review' not 'automation created.' Three approaches identified (item-name prefix, Notes Particulières stamp, new column) with Approach A recommended as smallest."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "hypa_read src/workflow.ts src/mondayPayload.ts src/types.ts src/config.ts src/clients/monday.ts src/invoiceTypeEvidence.ts tests/unit.test.ts tests/workflow.test.ts docs/SPEC.md docs/DEPLOYMENT.md",
      "result": "passed",
      "summary": "Read all relevant source, test, and documentation files to understand automation marker presence"
    },
    {
      "command": "hypa_ls src/",
      "result": "passed",
      "summary": "Enumerated all source files in src/ directory"
    }
  ],
  "validationOutput": [],
  "residualRisks": [
    "Interaction with withDevelopmentPrefix dev prefix: Test - [AUTO] Merchant receipt — benign but visually awkward",
    "If user later adds a status column via board edit, Approach A's name prefix could conflict with status-based filtering; consider Approach C if column-level filtering is a future requirement",
    "No existing tests for the item-name pattern of review items — tests only cover [REVUE] existence, not automation-origin distinction"
  ],
  "noStagedFiles": true,
  "notes": "Scouting complete. No files modified. The parent can proceed with implementing Approach A (item-name prefix) as the minimal change."
}
```
