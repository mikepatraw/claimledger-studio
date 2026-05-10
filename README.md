# ClaimLedger Studio

A local-first resume tailoring app with claim-level evidence, approvals, and audit trails.

ClaimLedger Studio is not a generic resume generator. It is a claim approval workspace: import trusted source material, extract candidate claims, approve/edit/decline them, generate bullets, and export only material that traces back to evidence or an explicit manual evidence note.

## Quick start

```bash
git clone https://github.com/mikepatraw/claimledger-studio.git
cd claimledger-studio
./install.sh
```

The installer:

1. checks Node.js,
2. installs dependencies,
3. creates ignored local directories under `.local/`,
4. copies `.env.example` to ignored `.env`,
5. opens a numbered provider setup wizard,
6. starts the local UI at `http://localhost:4173`.

For automated smoke tests, run:

```bash
CLAIMLEDGER_SETUP_CHOICE=4 CLAIMLEDGER_NO_START=1 ./install.sh
npm run start
curl http://localhost:4173/health
```

## Provider modes

1. Ollama/local model: maximum privacy; source text stays on the machine.
2. OpenAI-compatible API endpoint: source text may be sent to the configured API.
3. Anthropic API: source text may be sent to Anthropic.
4. Heuristic-only: no model calls; deterministic extraction only.

Provider secrets/auth settings are stored only in local `.env`, which is ignored by git. The setup wizard asks for API key vs OAuth/provider-CLI token mode for remote providers. Raw API keys are never displayed by the UI.

## MVP workflow

- Create a local project.
- Upload or paste a master resume and approved source-material document (`.md`, `.txt`, `.docx`, and PDF when `pdftotext` is available).
- Extract evidence spans and candidate claims with the configured provider, or deterministic heuristic extraction.
- Review the Claims Ledger: approve, edit, decline, and bulk-modify claims.
- Generate and review bullets from approved claims or from a saved job-description match.
- Export Markdown or DOCX with an internal audit manifest mapping each output bullet to claim IDs and evidence span IDs.
- Review audit events for ingestion, extraction, edits, approvals, bullet generation, job matching, provider failures, and exports.

## Public data boundary

This repo ships only synthetic sample data about `Jordan Rivera`, a fictional candidate. It must not contain Mike private resume data, user uploads, local databases, generated private resumes, provider tokens, or audit logs.

## Commands

```bash
npm install
npm run setup      # alias for node scripts/setup-provider.js if added by you
npm run start
npm test
npm run build
```

## Repository map

```text
apps/api/          local HTTP API and static UI server
apps/studio/       browser UI for onboarding, Claims Ledger, export, audit
packages/core/     schema validation, extraction, ledger, export gates
docs/              product spec, architecture, data model, acceptance criteria
samples/           sanitized synthetic sample documents only
tests/             unit, integration, smoke tests
```

## Current limitations

The public MVP is local-first and dependency-light. It now supports pasted text, Markdown/text uploads, DOCX text extraction through Python's standard library, PDF text extraction when `pdftotext` is installed, provider-backed claim extraction with heuristic fallback, approved-bullets import, JD matching, bullet review, and Markdown/DOCX export. Remaining follow-ons are stronger visual polish, richer resume section templates, OS keychain storage, and optional packaged binaries/Docker images.
