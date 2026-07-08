# Factures Dry-Run Simulation

This document describes the local dry-run simulation harness for the receipt workflow.

## Purpose
- Run the end-to-end workflow logic without connecting to Microsoft 365 or monday.com.
- Validate routing, grouping, confidence handling, and update/attachment behavior in a deterministic way.
- Protect production services by executing only mocked clients during simulation.

## Fixture layout
- `.fixtures/factures/` is the fixture root.
  - `manifest.local.json` (or custom manifest path) lists deterministic email seeds and scenario tags.
  - Optional per-run fixtures can be stored under a private fixture tree inside `.fixtures/factures/`.
- `.simulation-output/` is the optional output directory for generated simulation artifacts (e.g. sanitized requests/route traces).
- Both paths are ignored in `.gitignore`; keep raw email bodies, private attachment files, OCR output, and generated reports private.

## Safety guarantees
- No real mailbox movement is performed. `moveMessage` is mocked and only records calls in test doubles.
- No real monday.com writes are performed. `createItem`, `uploadFile`, `createUpdate`, and `updateItemStatus` are mocked.
- No external network calls are required for simulation (`vitest` + fixture clients).
- Sensitive exports stay local; committed tests use synthetic references only.

## Deterministic simulation command
Use this command (added as `test:factures-simulation`):

```bash
pnpm run test:factures-simulation
```

The run is deterministic because it is driven from fixture JSON seeds and in-code synthetic attachments.

## Optional private/live fixture opt-in
For teams that want to run against non-committed fixtures, keep them outside tracked data and opt in explicitly:

- `FACTURES_SIMULATION_ENABLE_PRIVATE_FIXTURES=1` — load private fixtures.
- `FACTURES_SIMULATION_PRIVATE_FIXTURE_DIR=.fixtures/factures/private` — private fixture source directory.
- `FACTURES_SIMULATION_FIXTURE_MANIFEST=.fixtures/factures/manifest.local.json` — base/public manifest to merge with private seeds.
- `FACTURES_SIMULATION_ENABLE_OUTPUT=1` — write simulation artifacts.
- `FACTURES_SIMULATION_OUTPUT_DIR=.simulation-output` — location for saved artifacts.

All opt-ins are local-only by design; production behavior is unchanged.

## Covered scenarios
The suite documents these deterministic scenarios:

- Forwarding/body-only receipts processed as `Attention` without OCR or file upload.
- One email with multiple invoice attachments (one item per group).
- Payment receipt with multiple invoices grouped into one monday item.
- Unsupported and inline attachment handling.
- Low-confidence grouping/Attention states.
- Review and failure paths:
  - classifier review decision
  - OCR failure
  - upload failure
  - final update failure

See `tests/facturesSimulation.test.ts` for the exact assertions per scenario.