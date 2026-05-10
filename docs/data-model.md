# Data model

Core entities:

- Project
- SourceDocument
- EvidenceSpan
- Claim
- ClaimEvidence
- Bullet
- BulletClaim
- JobDescription
- TailoringRun
- TailoredOutput
- AuditEvent

Claim statuses: `needs_review`, `approved`, `edited`, `declined`, `draft_unverified`.

Claim types: `achievement`, `skill`, `scope`, `credential`, `tool`, `domain`, `responsibility`, `metric`, `other`.

Export gate: every exported bullet must be approved and linked to approved claims. Every linked claim must have evidence spans or a manual evidence note.

See `docs/product-spec.md` for the full SQLite table contract.
