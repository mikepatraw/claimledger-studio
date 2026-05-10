# Privacy model

ClaimLedger Studio is local-first. User content stays on the user's machine unless the user selects a remote model provider and chooses to run AI-assisted extraction or rewriting.

## What stays local in every mode

- Local project records
- Uploaded source documents
- Evidence spans
- Claim approval decisions
- Audit events
- Exported resumes and audit manifests
- Provider credentials in `.env`

Ignored local paths include `.env`, `.local/`, uploads, exports, audit logs, and SQLite/database files.

## Provider data flow

| Provider mode | Leaves the machine? | Sent data | Secret storage |
| --- | --- | --- | --- |
| Ollama/local model | No, assuming Ollama runs locally | Source chunks sent to local Ollama endpoint | No API key |
| OpenAI-compatible API | Yes | Source chunks, evidence span IDs, extraction/rewrite prompts, selected job description text | Local ignored `.env` |
| Anthropic API | Yes | Source chunks, evidence span IDs, extraction/rewrite prompts, selected job description text | Local ignored `.env` |
| Heuristic-only | No | Nothing | No API key |

Remote providers may retain or process data according to their own terms. Use heuristic-only or Ollama/local mode for maximum privacy.

## Anti-hallucination boundary

Every exported bullet must map to approved claims and evidence span IDs, or to a manually approved unverified claim with an explicit manual evidence note. Unsupported gap-filling claims are not silently exported.
