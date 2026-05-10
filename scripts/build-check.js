#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
const required = ['README.md', 'PRIVACY.md', 'SECURITY.md', '.env.example', '.dockerignore', 'install.sh', 'Dockerfile', 'compose.yaml', 'docs/container.md', 'apps/api/src/server.js', 'apps/studio/src/index.html', 'packages/core/src/ledger.js', 'packages/core/src/secrets.js'];
for (const file of required) await access(file);
const gitignore = await readFile('.gitignore', 'utf8');
for (const entry of ['.env', '.local/', 'uploads/', 'exports/', 'audit-logs/', '*.sqlite3', '*.db']) {
  if (!gitignore.includes(entry)) throw new Error(`.gitignore missing ${entry}`);
}
console.log('build check passed');
