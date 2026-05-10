import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SECRET_KEYS = new Set(['CLAIMLEDGER_API_KEY']);
const DEFAULT_SECRET_FILE = path.join('.local', 'secrets.env');

export function defaultSecretFile(root = process.cwd()) {
  return path.resolve(root, DEFAULT_SECRET_FILE);
}

export function splitSecretValues(values) {
  const publicValues = {};
  const secretValues = {};
  for (const [key, value] of Object.entries(values)) {
    if (SECRET_KEYS.has(key)) secretValues[key] = value;
    else publicValues[key] = value;
  }
  return { publicValues, secretValues };
}

export async function writeEnvFile(file, values, { mode = 0o600 } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  let existing = '';
  try { existing = await readFile(file, 'utf8'); } catch {}
  const keys = Object.keys(values);
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => line && !keys.some((key) => line.startsWith(`${key}=`)));
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${sanitizeEnvValue(value)}`);
  await writeFile(file, `${lines.join('\n')}\n`, { mode });
  try { await chmod(file, mode); } catch {}
}

export function loadEnvText(text, env = process.env) {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || env[match[1]]) continue;
    env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
}

export async function loadEnvFile(file, env = process.env) {
  try { loadEnvText(await readFile(file, 'utf8'), env); } catch {}
  return env;
}

export async function loadClaimLedgerEnv(root = process.cwd(), env = process.env) {
  await loadEnvFile(path.join(root, '.env'), env);
  const configuredSecretFile = env.CLAIMLEDGER_SECRET_FILE || DEFAULT_SECRET_FILE;
  await loadEnvFile(path.resolve(root, configuredSecretFile), env);
  return env;
}

function sanitizeEnvValue(value) {
  return String(value ?? '').replace(/[\r\n]/g, '');
}
