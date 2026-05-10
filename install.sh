#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
printf 'ClaimLedger Studio installer\n'
NODE_VERSION=$(node --version 2>/dev/null || true)
if [ -z "$NODE_VERSION" ]; then echo 'Node.js 20+ is required. Install Node.js, then rerun ./install.sh.' >&2; exit 1; fi
NODE_MAJOR=${NODE_VERSION#v}; NODE_MAJOR=${NODE_MAJOR%%.*}
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node.js 20+ is required; found $NODE_VERSION" >&2; exit 1; fi
mkdir -p .local/uploads .local/exports .local/audit .local/db
[ -f .env ] || cp .env.example .env
npm install
node scripts/setup-provider.js
if [ "${CLAIMLEDGER_NO_START:-0}" = "1" ]; then
  echo 'Install complete. Start later with npm run start.'
else
  echo 'Starting local UI at http://localhost:4173'
  npm run start
fi
