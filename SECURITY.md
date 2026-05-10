# Security policy

ClaimLedger Studio is a local-first proof-of-work repository. Do not upload private resumes, provider keys, generated private resumes, or audit logs to GitHub.

## Secret handling

- `.env` is ignored.
- `.env.example` contains placeholders only.
- The UI reports whether an API key is set but does not display raw key values.

## Supported local threat model

The app is designed for single-user localhost use. It is not a multi-tenant SaaS backend and should not be exposed directly to the public internet without authentication, rate limiting, durable secret management, and additional review.

## Reporting issues

Open a GitHub issue with reproduction steps. Do not include real resume data, credentials, or private job materials.
