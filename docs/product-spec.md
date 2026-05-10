# ClaimLedger Studio Product Spec

Status: v1 product architecture and acceptance criteria
Date: 2026-05-10
Audience: implementers building a new public, turnkey GitHub repository

## 1. Product identity

Repo name: `claimledger-studio`

Short description: Local-first, evidence-backed resume tailoring studio that turns a master resume and approved bullet library into auditable, recruiter-ready resume claims without hallucinated experience.

Public repo tagline: `A local-first resume tailoring app with claim-level evidence, approvals, and audit trails.`

Positioning:
- ClaimLedger Studio is not a generic resume generator.
- The core product is a claim approval workspace: users import trusted source material, review candidate claims, approve/edit/decline them, and use only approved/evidence-backed claims in tailored outputs.
- AI is assistive only. It can extract, classify, rewrite, and suggest mappings, but every claim must trace back to uploaded source evidence and user approval before export.

Primary users:
- Career transitioners with large bodies of experience who need role-specific resumes without inventing facts.
- Veterans translating military experience into civilian language.
- Technical professionals maintaining a reusable evidence library across applications.

Non-goals for public v1:
- No SaaS backend.
- No hosted user accounts.
- No cloud database.
- No scraping private job boards.
- No storage or publication of private resume data in the repo.
- No autonomous submission of job applications.

## 2. Hard product requirements

The public repository must support this first-run path:

1. User clones repo.
2. User runs `./install.sh`.
3. Installer checks prerequisites and installs app dependencies.
4. CLI setup asks the user to select a model provider by number.
5. CLI setup asks for required OAuth/API authentication for that provider.
6. App launches a local UI.
7. User uploads:
   - a master resume, and
   - an approved bullets/source-material document.
8. App extracts candidate claims and bullets using AI plus deterministic heuristics.
9. UI lets user approve, edit, decline, and bulk-modify extracted claims.
10. App keeps a local audit trail of source evidence, transformations, approvals, exports, and model usage.
11. Public repo ships only sanitized sample resumes, sample bullets, sample jobs, and sample outputs.

Security/privacy requirements:
- Local-first by default. User content stays on the user's machine unless the selected model provider requires API calls.
- Be explicit during setup about what leaves the machine for each provider.
- Never commit user uploads, local database files, generated resumes, provider tokens, or audit logs.
- Store secrets only in local `.env` or OS keychain if implemented; `.env` must be gitignored.
- Include `.env.example` with placeholder values only.
- Include a clear `PRIVACY.md` explaining provider data flow.

Anti-hallucination requirements:
- Every generated or approved claim must link to one or more evidence spans from an uploaded source document.
- A claim with no evidence is allowed only as a `draft_unverified` object and cannot be exported unless manually approved with an explicit `manual_evidence_note`.
- Exported resumes must include an internal audit manifest mapping output bullets to source claim IDs.
- UI must visibly distinguish `verified`, `needs_review`, `draft_unverified`, `declined`, and `approved` states.

## 3. Recommended tech stack

Architecture: local web app with a small local API, browser UI, local SQLite database, and pluggable model providers.

Recommended public v1 stack:
- Runtime/package manager: Node.js 22+ with pnpm, or Python 3.12 + uv. Pick one for the repo and keep install one-command.
- UI: React + Vite + TypeScript.
- Local API: FastAPI if Python backend; or Hono/Express if all-TypeScript.
- Database: SQLite.
- ORM/query layer: SQLAlchemy/SQLModel for Python, or Drizzle/Prisma for TypeScript.
- Document parsing: PDF text extraction, DOCX text extraction, Markdown/plain text ingestion.
- AI provider abstraction: provider interface with adapters for at least:
  - Local/Ollama,
  - OpenAI-compatible API endpoint,
  - Anthropic API, if desired.
- Exports: Markdown and DOCX in v1; PDF optional if reliable.

Best-call architecture for fastest implementation:
- TypeScript monorepo:
  - `apps/studio` for React/Vite UI.
  - `apps/api` for local API.
  - `packages/core` for claim extraction, schema, provider interface, scoring, and audit logic.
  - SQLite via Drizzle.

Alternative acceptable architecture:
- Python FastAPI backend + React frontend. This may be easier for document parsing and model orchestration.

## 4. Repository structure

Recommended structure:

```text
claimledger-studio/
  README.md
  LICENSE
  install.sh
  .gitignore
  .env.example
  PRIVACY.md
  SECURITY.md
  docs/
    product-spec.md
    architecture.md
    data-model.md
    acceptance-criteria.md
    sample-data-policy.md
  samples/
    resumes/sanitized-master-resume.md
    bullets/sanitized-approved-bullets.md
    jobs/sanitized-job-description.md
    exports/sanitized-tailored-resume.md
  apps/
    studio/
      src/
    api/
      src/
  packages/
    core/
      src/
  tests/
    unit/
    integration/
    fixtures/
```

Required gitignore entries:

```text
.env
.env.*
!.env.example
.local/
data/
uploads/
exports/
audit-logs/
*.sqlite
*.sqlite3
*.db
*.docx
*.pdf
```

Exception: sanitized sample PDFs/DOCX may be committed only under `samples/` if they are generated from fake data and clearly named sanitized/sample.

## 5. Setup and first-run UX

Command:

```bash
git clone https://github.com/<owner>/claimledger-studio.git
cd claimledger-studio
./install.sh
```

Installer responsibilities:
- Detect OS and shell.
- Verify required runtime versions.
- Install dependencies.
- Create local directories:
  - `.local/`
  - `.local/uploads/`
  - `.local/exports/`
  - `.local/audit/`
  - `.local/db/`
- Copy `.env.example` to `.env` if missing.
- Run first-time setup wizard.
- Start local API and UI.
- Print the local URL, e.g. `http://localhost:5173`.

Setup wizard provider prompt:

```text
Choose a model provider:
1) Ollama/local model (recommended for maximum privacy)
2) OpenAI-compatible API endpoint
3) Anthropic API
4) Skip AI setup and use heuristic extraction only

Enter choice [1-4]:
```

Auth prompts:
- Ollama:
  - Check whether Ollama is reachable.
  - Ask for model name, default `llama3.1` or current recommended local model.
  - Do not ask for API key.
- OpenAI-compatible:
  - Ask for base URL.
  - Ask for API key.
  - Ask for model name.
- Anthropic:
  - Ask for API key.
  - Ask for model name.
- Heuristic-only:
  - No auth.
  - UI must show that AI extraction is disabled.

Setup must write only local config. It must never phone home to the repo owner.

## 6. Core concepts

Source Document:
A user-uploaded document containing trusted source material. Examples: master resume, approved bullet library, performance review excerpts, sanitized training records, project notes.

Evidence Span:
A specific text range from a source document. Evidence spans are immutable after ingestion except for re-ingestion.

Claim:
A structured factual assertion about the candidate. Example: `Led risk-managed training for 240 personnel with zero serious safety incidents.`

Bullet:
A resume-ready expression of one or more claims. A bullet can be tailored to a job, but it must retain evidence links.

Transformation:
A rewrite operation that changes tone, wording, seniority framing, keyword alignment, or bullet structure.

Approval:
A user decision that permits a claim or bullet to be used in exports.

Audit Event:
An immutable record of ingestion, extraction, edit, approval, decline, rewrite, export, and provider call metadata.

## 7. Data model

Use IDs that are stable across exports. Recommended format: CUID/ULID or UUIDv7.

### 7.1 Entity overview

```text
Project
  has many SourceDocuments
  has many EvidenceSpans
  has many Claims
  has many Bullets
  has many JobDescriptions
  has many TailoringRuns
  has many AuditEvents
```

### 7.2 Tables

#### projects

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| name | text | yes | user-visible project name |
| created_at | datetime | yes | local time stored as ISO UTC |
| updated_at | datetime | yes | local time stored as ISO UTC |

#### source_documents

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| kind | enum | yes | `master_resume`, `approved_bullets`, `job_description`, `other` |
| filename | text | yes | original filename |
| mime_type | text | yes | detected or provided |
| sha256 | text | yes | content hash for integrity |
| text_content | text | yes | extracted plain text |
| created_at | datetime | yes | ingestion time |

#### evidence_spans

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| source_document_id | text | yes | FK source_documents.id |
| start_char | integer | yes | start offset in text_content |
| end_char | integer | yes | end offset in text_content |
| quote | text | yes | exact extracted quote |
| label | text | no | optional human label |
| created_by | enum | yes | `heuristic`, `ai`, `user` |
| created_at | datetime | yes | timestamp |

#### claims

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| claim_text | text | yes | factual assertion |
| claim_type | enum | yes | `achievement`, `skill`, `scope`, `credential`, `tool`, `domain`, `responsibility`, `metric`, `other` |
| status | enum | yes | `needs_review`, `approved`, `edited`, `declined`, `draft_unverified` |
| confidence | real | no | 0-1 extractor confidence |
| evidence_score | real | yes | 0-1 quality/strength of evidence mapping |
| source | enum | yes | `heuristic`, `ai`, `user` |
| manual_evidence_note | text | no | required for manually approved unverified claims |
| created_at | datetime | yes | timestamp |
| updated_at | datetime | yes | timestamp |

#### claim_evidence

| Field | Type | Required | Notes |
|---|---:|---:|---|
| claim_id | text | yes | FK claims.id |
| evidence_span_id | text | yes | FK evidence_spans.id |
| relation | enum | yes | `supports`, `partially_supports`, `contradicts`, `context` |
| rationale | text | no | short explanation |

#### bullets

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| bullet_text | text | yes | resume-ready wording |
| status | enum | yes | `needs_review`, `approved`, `edited`, `declined`, `draft_unverified` |
| tone | text | no | e.g. `civilian`, `technical`, `executive`, `federal` |
| created_from | enum | yes | `claim`, `source_document`, `user`, `tailoring_run` |
| created_at | datetime | yes | timestamp |
| updated_at | datetime | yes | timestamp |

#### bullet_claims

| Field | Type | Required | Notes |
|---|---:|---:|---|
| bullet_id | text | yes | FK bullets.id |
| claim_id | text | yes | FK claims.id |
| relation | enum | yes | `expresses`, `summarizes`, `extends` |

#### job_descriptions

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| title | text | yes | user label |
| company | text | no | optional |
| raw_text | text | yes | pasted/uploaded JD |
| extracted_requirements_json | json | no | normalized requirements |
| created_at | datetime | yes | timestamp |

#### tailoring_runs

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| job_description_id | text | yes | FK job_descriptions.id |
| provider | text | no | provider used, if any |
| model | text | no | model used, if any |
| status | enum | yes | `draft`, `ready_for_review`, `exported`, `failed` |
| created_at | datetime | yes | timestamp |
| completed_at | datetime | no | timestamp |

#### tailored_outputs

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| tailoring_run_id | text | yes | FK tailoring_runs.id |
| format | enum | yes | `markdown`, `docx`, `pdf` |
| output_path | text | yes | local path under `.local/exports` |
| audit_manifest_json | json | yes | maps resume sections/bullets to claim IDs and evidence IDs |
| created_at | datetime | yes | timestamp |

#### audit_events

| Field | Type | Required | Notes |
|---|---:|---:|---|
| id | text | yes | stable ID |
| project_id | text | yes | FK projects.id |
| actor | enum | yes | `system`, `user`, `ai_provider` |
| event_type | enum | yes | see event list below |
| entity_type | text | yes | e.g. `claim`, `bullet`, `source_document` |
| entity_id | text | yes | target entity ID |
| before_json | json | no | prior state for edits |
| after_json | json | no | new state for edits |
| metadata_json | json | no | provider/model/tokens/source info |
| created_at | datetime | yes | timestamp |

Audit event types:
- `document_ingested`
- `evidence_span_created`
- `claim_extracted`
- `claim_edited`
- `claim_approved`
- `claim_declined`
- `claim_bulk_modified`
- `bullet_generated`
- `bullet_edited`
- `bullet_approved`
- `bullet_declined`
- `job_description_ingested`
- `tailoring_run_started`
- `tailoring_run_completed`
- `export_created`
- `provider_call_started`
- `provider_call_completed`
- `provider_call_failed`

## 8. Extraction pipeline

### 8.1 Ingestion

For each uploaded source document:
1. Save raw file locally under `.local/uploads/`.
2. Compute SHA-256.
3. Extract plain text.
4. Create `source_documents` record.
5. Segment into candidate evidence spans:
   - headings,
   - bullets,
   - sentences,
   - metric-containing fragments,
   - skill/tool lists.
6. Create audit events for document and evidence span creation.

### 8.2 Heuristic extraction

Heuristics should identify:
- Numeric scope: `24 years`, `5 deployments`, `240 personnel`, `$X`, `%`, `N users`, `N systems`.
- Action-result patterns: led, built, managed, implemented, reduced, increased, trained, secured, automated.
- Tools/technologies: named technical systems, programming languages, platforms, security tools.
- Credentials/education: degrees, certifications, schools, training.
- Role/scope: leadership level, team size, operational context.

Heuristic outputs must include source evidence spans.

### 8.3 AI extraction

AI extraction prompt contract:
- Input: source document text chunks with span IDs.
- Output: strict JSON only.
- Required fields: claim text, claim type, supporting span IDs, confidence, rationale.
- Constraint: do not create claims that lack source span support.
- If source support is ambiguous, return `needs_review` with confidence below threshold.

Required validation:
- Reject AI output if referenced span IDs do not exist.
- Reject AI output if claim text includes facts not present in cited spans unless marked `draft_unverified`.
- Log provider, model, timestamp, and token metadata if available.

### 8.4 Deduplication and clustering

After extraction:
- Normalize claim text.
- Cluster near-duplicates.
- Merge only when evidence and meaning are materially equivalent.
- Preserve all evidence links from merged claims.
- Present merged candidates in UI as review groups.

## 9. UI architecture and UX flows

The UI is the product. It must make claim review faster, safer, and more satisfying than editing a resume manually.

### 9.1 Global layout

Recommended main navigation:
- Dashboard
- Sources
- Claims Ledger
- Bullet Studio
- Tailor to Job
- Exports
- Audit Trail
- Settings

Global UI principles:
- Evidence is always one click away.
- Approval state is always visible.
- Bulk operations are fast but reversible through audit history.
- Diff views are used for AI rewrites and user edits.
- Export readiness is based on evidence/approval gates, not just document completeness.

### 9.2 First-run onboarding flow

Screen 1: Welcome
- Explain local-first model.
- Explain evidence-backed workflow.
- Show provider privacy status: local, API, or heuristic-only.

Screen 2: Upload trusted sources
- Upload master resume.
- Upload approved bullets/source-material document.
- Optional: upload extra support docs.
- Show accepted formats.

Screen 3: Extraction progress
- Parse documents.
- Extract evidence spans.
- Extract candidate claims.
- Deduplicate.
- Show counts:
  - documents processed,
  - evidence spans found,
  - candidate claims found,
  - claims needing review.

Screen 4: Review queue
- Route user directly to Claims Ledger filtered to `needs_review`.

### 9.3 Sources screen

Purpose: show uploaded source material and evidence spans.

Required features:
- Document list with filename, kind, upload date, hash.
- Document text viewer.
- Highlight evidence spans.
- Click span to see linked claims.
- Create manual evidence span from selected text.
- Re-ingest document if needed.

### 9.4 Claims Ledger screen

Purpose: primary approval/edit/decline workspace.

Required table columns:
- Status
- Claim text
- Claim type
- Evidence score
- Source document
- Evidence preview
- Extractor source
- Last updated

Required filters:
- Status
- Claim type
- Evidence score range
- Source document
- Extractor source
- Has metrics
- Needs manual evidence note

Required row actions:
- Approve
- Edit
- Decline
- Split
- Merge
- Link/unlink evidence
- Convert to bullet

Required bulk actions:
- Approve selected
- Decline selected
- Change claim type
- Add tag/label
- Rewrite selected as civilian language
- Rewrite selected as technical language
- Mark selected as needing review

Claim detail panel:
- Claim text editor.
- Evidence spans with exact quotes.
- Evidence relationship labels.
- AI rationale, if available.
- Edit history/diff.
- Approval controls.
- Warning if claim has weak/no evidence.

Evidence gate behavior:
- `approved` allowed when claim has at least one `supports` evidence span.
- `draft_unverified` can be manually approved only after user adds `manual_evidence_note`.
- `declined` claims remain in audit trail and can be restored.

### 9.5 Bullet Studio screen

Purpose: turn approved claims into reusable resume bullets.

Required features:
- Generate bullets from selected claims.
- Edit bullets in place.
- Show linked claims and evidence.
- Tone controls:
  - civilian,
  - technical,
  - leadership,
  - concise ATS,
  - federal/plain.
- Strength meter based on specificity, metrics, action/result structure, and evidence.
- Approval status independent of source claim status, but export requires approved bullet plus approved linked claims.

Bulk features:
- Rewrite selected bullets for tone.
- Shorten selected bullets.
- Add/remove metrics only if supported by evidence.
- Decline selected bullets.
- Approve selected bullets.

### 9.6 Tailor to Job flow

Step 1: Add job description
- Paste text or upload file.
- Extract role title, company, required skills, responsibilities, keywords.

Step 2: Match claims
- Show JD requirements mapped to approved claims/bullets.
- Score each match with rationale.
- Show gaps separately.
- Do not fabricate gap-filling claims.

Step 3: Build draft resume
- User selects target format/profile.
- App proposes sections and bullets.
- Every bullet shows evidence/claim links.
- Unverified content is blocked or visibly marked.

Step 4: Review and export
- Show readiness checklist:
  - all exported bullets approved,
  - all exported bullets have evidence,
  - no draft_unverified claims unless manually approved with note,
  - audit manifest generated.
- Export Markdown and DOCX.
- Save audit manifest.

### 9.7 Audit Trail screen

Purpose: trust and traceability.

Required features:
- Chronological event list.
- Filter by entity, event type, actor, date.
- View before/after diffs for edits and rewrites.
- View provider call metadata without exposing secrets.
- Export audit manifest for a tailored resume.

### 9.8 Settings screen

Required settings:
- Model provider.
- Model name.
- Base URL/API endpoint where applicable.
- Privacy mode indicator.
- Export directory.
- Data directory.
- Reset/re-run setup wizard.

Must not display raw API keys after save. Show only presence/last four characters if necessary.

## 10. Public sample data policy

The repo must include sample data that demonstrates the full workflow without exposing Mike's private resume data or any real person's private details.

Sample profile recommendation:
- Fictional candidate: `Jordan Rivera`.
- Background: generic IT operations, cybersecurity lab projects, training leadership, process automation.
- Avoid unique combinations that map back to Mike.
- Use fake employers or generic organizations.
- Use synthetic metrics that are plausible but explicitly fake in sample docs.

Required sample files:
- `samples/resumes/sanitized-master-resume.md`
- `samples/bullets/sanitized-approved-bullets.md`
- `samples/jobs/sanitized-job-description.md`
- `samples/exports/sanitized-tailored-resume.md`

Each sample file header must say:

```text
Sample data only. This file is synthetic and does not describe a real person.
```

## 11. API surface

Minimum local API endpoints:

```text
GET  /health
GET  /api/projects
POST /api/projects
POST /api/source-documents
GET  /api/source-documents
GET  /api/source-documents/:id
GET  /api/evidence-spans?source_document_id=:id
GET  /api/claims
POST /api/claims
PATCH /api/claims/:id
POST /api/claims/:id/approve
POST /api/claims/:id/decline
POST /api/claims/bulk
GET  /api/bullets
POST /api/bullets
PATCH /api/bullets/:id
POST /api/bullets/bulk
POST /api/job-descriptions
GET  /api/job-descriptions
POST /api/tailoring-runs
GET  /api/tailoring-runs/:id
POST /api/tailoring-runs/:id/export
GET  /api/audit-events
GET  /api/settings
PATCH /api/settings
```

Provider abstraction:

```ts
interface ModelProvider {
  id: string;
  displayName: string;
  privacyMode: 'local' | 'remote_api' | 'heuristic_only';
  validateConfig(config: ProviderConfig): Promise<ValidationResult>;
  extractClaims(input: ClaimExtractionInput): Promise<ClaimExtractionResult>;
  rewriteBullets(input: BulletRewriteInput): Promise<BulletRewriteResult>;
  summarizeJobDescription(input: JobDescriptionInput): Promise<JobDescriptionResult>;
}
```

All provider outputs must pass schema validation before persistence.

## 12. Acceptance criteria

### 12.1 Installation and setup

AC-001: A clean clone on a supported OS can run `./install.sh` successfully.

AC-002: Installer presents numbered provider choices and accepts choices 1-4.

AC-003: Provider setup collects only the required fields for the chosen provider.

AC-004: Secrets are written only to ignored local config or secure storage, never to committed files.

AC-005: After setup, the local UI launches and prints a reachable localhost URL.

AC-006: If AI setup is skipped, the app still runs in heuristic-only mode.

### 12.2 Ingestion

AC-010: User can upload a master resume and approved bullets/source-material document.

AC-011: App extracts text from supported formats and stores source document records locally.

AC-012: App computes and displays SHA-256 hash for each source document.

AC-013: App creates evidence spans from uploaded documents.

AC-014: Ingestion creates audit events.

### 12.3 Claim extraction and evidence

AC-020: App extracts candidate claims from uploaded source documents.

AC-021: Every non-manual extracted claim has at least one linked evidence span.

AC-022: AI outputs with missing/invalid span IDs are rejected and logged.

AC-023: Claims are assigned status, type, confidence, and evidence score.

AC-024: Near-duplicate claims are grouped or merged without losing evidence links.

AC-025: Claims unsupported by evidence are marked `draft_unverified` and blocked from normal export.

### 12.4 Claim review UI

AC-030: User can approve a single claim.

AC-031: User can edit a claim and see before/after diff in audit trail.

AC-032: User can decline a claim without deleting it from history.

AC-033: User can approve, decline, or modify selected claims in bulk.

AC-034: User can filter claims by status, type, evidence score, source document, and extractor source.

AC-035: Claim detail panel shows exact evidence quotes.

AC-036: UI blocks approval of unsupported claims unless user provides a manual evidence note.

### 12.5 Bullet Studio

AC-040: User can generate bullets from approved claims.

AC-041: User can edit generated bullets.

AC-042: User can approve/decline bullets independently from claims.

AC-043: User can bulk rewrite bullets by selected tone.

AC-044: Bullet details show linked claims and evidence.

AC-045: Export readiness requires approved bullets linked to approved/evidence-backed claims.

### 12.6 Job tailoring

AC-050: User can paste or upload a job description.

AC-051: App extracts requirements and keywords from the job description.

AC-052: App matches job requirements to approved claims/bullets.

AC-053: App shows gaps without fabricating unsupported experience.

AC-054: App generates a draft tailored resume from approved/evidence-backed material.

AC-055: User can review and modify the draft before export.

### 12.7 Export and audit

AC-060: User can export tailored resume as Markdown.

AC-061: User can export tailored resume as DOCX.

AC-062: Export creates an audit manifest mapping every exported bullet to claim IDs and evidence span IDs.

AC-063: Audit trail records export event and output path.

AC-064: User can view audit events and before/after diffs.

### 12.8 Public repo hygiene

AC-070: Repo contains no Mike private resume data.

AC-071: Repo contains no real private candidate data.

AC-072: Repo contains sanitized sample files only.

AC-073: `.gitignore` prevents local uploads, DB files, audit logs, exports, and secrets from being committed.

AC-074: README explains local-first design and provider privacy tradeoffs.

AC-075: PRIVACY.md documents exactly what data each provider mode sends outside the local machine.

### 12.9 Testing

AC-080: Unit tests cover claim schema validation.

AC-081: Unit tests cover AI output rejection for invalid evidence span IDs.

AC-082: Unit tests cover export blocking for unapproved or unsupported claims.

AC-083: Integration test covers upload → extraction → approve → bullet generation → export.

AC-084: Smoke test verifies `./install.sh` completes and UI health check passes.

## 13. MVP scope

MVP must include:
- Install script and setup wizard.
- Local UI.
- SQLite persistence.
- Source upload for Markdown/plain text at minimum; PDF/DOCX preferred.
- Heuristic extraction.
- At least one AI provider adapter or explicit heuristic-only MVP mode.
- Claims Ledger with approve/edit/decline/bulk actions.
- Evidence linking.
- Bullet Studio basic generation/edit/approval.
- Job description paste/upload.
- Markdown export.
- Audit trail.
- Sanitized sample data.

Can defer after MVP:
- PDF export.
- OS keychain support.
- Advanced clustering UI.
- Multiple projects.
- Advanced resume templates.
- Browser extension.
- Hosted sync.

## 14. Implementation milestones

Milestone 1: Repo scaffold and local install
- Public repo structure.
- `install.sh`.
- Setup wizard.
- Local UI/API health check.
- Sample data policy and git hygiene.

Milestone 2: Local data model and ingestion
- SQLite schema.
- Source document upload.
- Text extraction.
- Evidence span creation.
- Audit event persistence.

Milestone 3: Claim extraction and review
- Heuristic extraction.
- Provider interface and one provider adapter.
- JSON schema validation.
- Claims Ledger UI with row/detail/bulk actions.

Milestone 4: Bullet Studio
- Bullet generation from approved claims.
- Tone rewrites.
- Bullet approval and evidence display.

Milestone 5: Job tailoring and export
- Job description parser.
- Requirement-to-claim matching.
- Draft tailored resume builder.
- Markdown/DOCX export.
- Audit manifest.

Milestone 6: Polish and public launch readiness
- README.
- PRIVACY.md.
- SECURITY.md.
- Sample walkthrough.
- Tests and CI.
- Screenshots/GIFs.

## 15. Definition of done for public v1

Public v1 is done when:
- A new user can clone the repo, run `./install.sh`, choose provider/auth mode, and open the local UI without manual code edits.
- User can upload source docs, extract claims, approve/edit/decline/bulk-modify claims, create bullets, tailor to a pasted job description, and export at least Markdown.
- Every exported bullet has a traceable claim/evidence path or an explicit manual evidence note.
- Audit trail shows ingestion, extraction, edits, approvals, rewrites, provider calls, and exports.
- Repo contains only synthetic/sanitized sample data.
- Automated tests cover the anti-hallucination and export gates.
- README and PRIVACY.md make the local-first/provider-data-flow model obvious.
