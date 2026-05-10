# Acceptance criteria

The implementation targets the v1 criteria in `docs/product-spec.md`, especially:

- install script and numbered provider wizard,
- local UI and health check,
- sanitized sample data only,
- source ingestion with SHA-256,
- evidence span creation,
- claim schema validation,
- invalid provider output rejection,
- claim approve/edit/decline/bulk behavior,
- bullet generation from approved claims,
- export blocking for unsupported material,
- Markdown export with audit manifest,
- audit trail events,
- README and privacy documentation.

Run `npm test` and `npm run build` for the current automated acceptance coverage.
