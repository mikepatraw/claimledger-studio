# Architecture

ClaimLedger Studio uses a local API, browser UI, and local data store.

- `apps/api`: Node HTTP server for local endpoints and static UI assets.
- `apps/studio`: local browser UI for upload, Claims Ledger review, Bullet Studio, tailoring, exports, and audit trail.
- `packages/core`: claim schema validation, evidence span extraction, provider validation, approval gates, export manifest generation, and local ledger operations.
- `.local`: ignored runtime data directory for uploads, exports, audit files, and database files.

The MVP stores records in local SQLite at `.local/db/claimledger.sqlite3` and maintains a JSON mirror for readable local debugging. The schema is intentionally aligned with the SQLite tables in `docs/data-model.md`; future adapters can replace the mirror without changing the product model.
