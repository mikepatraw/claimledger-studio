# ClaimLedger Studio container run

The container defaults to heuristic-only mode so a fresh clone can run without provider credentials or network model calls.

```bash
docker compose up --build
curl http://localhost:4173/health
```

Runtime data is mounted at `./.local/container-data` on the host and `/data` in the container. The directory is ignored by git.

For remote-provider experiments, keep secrets outside the image. Either pass a short-lived environment variable at runtime:

```bash
CLAIMLEDGER_PROVIDER=anthropic \
CLAIMLEDGER_MODEL=claude-sonnet-4-5 \
CLAIMLEDGER_API_KEY="$ANTHROPIC_API_KEY" \
docker compose up --build
```

or mount the ignored local secret file created by `npm run setup`:

```yaml
volumes:
  - ./.local/secrets.env:/app/.local/secrets.env:ro
```

Do not copy `.env`, `.local/secrets.env`, uploads, exports, databases, audit logs, or generated resumes into a public image. The included `.dockerignore` excludes those local/private paths from `docker build` contexts.
