#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { providerCatalog } from '../packages/core/src/schema.js';

const envPath = path.resolve('.env');
const providers = providerCatalog();

async function main() {
  console.log('ClaimLedger Studio local provider setup');
  console.log('Choose a model provider:');
  console.log('1) Ollama/local model (recommended for maximum privacy)');
  console.log('2) OpenAI-compatible API endpoint');
  console.log('3) Anthropic API');
  console.log('4) Skip AI setup and use heuristic extraction only');
  const rl = readline.createInterface({ input, output });
  const choice = process.env.CLAIMLEDGER_SETUP_CHOICE || await rl.question('Enter choice [1-4]: ');
  const index = Number(choice) - 1;
  if (index < 0 || index > 3 || Number.isNaN(index)) throw new Error('provider choice must be 1-4');
  const provider = providers[index];
  const values = { CLAIMLEDGER_PROVIDER: provider.id, CLAIMLEDGER_PRIVACY_MODE: provider.privacyMode };
  if (provider.id === 'ollama') values.CLAIMLEDGER_MODEL = process.env.CLAIMLEDGER_MODEL || await rl.question('Ollama model [llama3.1]: ') || 'llama3.1';
  if (provider.id === 'openai-compatible') {
    const auth = process.env.CLAIMLEDGER_AUTH_METHOD || await rl.question('Auth method: 1) API key  2) OAuth/provider CLI token [1]: ') || '1';
    values.CLAIMLEDGER_AUTH_METHOD = auth === '2' ? 'oauth_or_provider_cli' : 'api_key';
    values.CLAIMLEDGER_BASE_URL = process.env.CLAIMLEDGER_BASE_URL || await rl.question('OpenAI-compatible base URL: ');
    if (values.CLAIMLEDGER_AUTH_METHOD === 'api_key') {
      values.CLAIMLEDGER_API_KEY = process.env.CLAIMLEDGER_API_KEY || await rl.question('API key (stored only in local ignored .env): ');
    } else {
      values.CLAIMLEDGER_API_KEY = process.env.CLAIMLEDGER_API_KEY || '';
      console.log('OAuth/provider CLI selected. Configure your provider token outside ClaimLedger and expose it to the runtime environment if required.');
    }
    values.CLAIMLEDGER_MODEL = process.env.CLAIMLEDGER_MODEL || await rl.question('Model name: ');
  }
  if (provider.id === 'anthropic') {
    const auth = process.env.CLAIMLEDGER_AUTH_METHOD || await rl.question('Auth method: 1) API key  2) OAuth/provider CLI token [1]: ') || '1';
    values.CLAIMLEDGER_AUTH_METHOD = auth === '2' ? 'oauth_or_provider_cli' : 'api_key';
    if (values.CLAIMLEDGER_AUTH_METHOD === 'api_key') {
      values.CLAIMLEDGER_API_KEY = process.env.CLAIMLEDGER_API_KEY || await rl.question('Anthropic API key (stored only in local ignored .env): ');
    } else {
      values.CLAIMLEDGER_API_KEY = process.env.CLAIMLEDGER_API_KEY || '';
      console.log('OAuth/provider CLI selected. Configure your provider token outside ClaimLedger and expose it to the runtime environment if required.');
    }
    values.CLAIMLEDGER_MODEL = process.env.CLAIMLEDGER_MODEL || await rl.question('Model name [claude-sonnet-4-5]: ') || 'claude-sonnet-4-5';
  }
  rl.close();
  await mkdir('.local/db', { recursive: true });
  let existing = existsSync(envPath) ? await readFile(envPath, 'utf8') : '';
  const lines = existing.split(/\r?\n/).filter((line) => line && !Object.keys(values).some((key) => line.startsWith(`${key}=`)));
  for (const [key, value] of Object.entries(values)) lines.push(`${key}=${String(value).replace(/\n/g, '')}`);
  await writeFile(envPath, `${lines.join('\n')}\n`);
  console.log(`Saved ${provider.displayName} config to local .env (${provider.privacyMode}).`);
  if (provider.sendsOffMachine) console.log('Privacy notice: source text may be sent to the selected remote API provider during AI extraction.');
  else console.log('Privacy notice: this mode does not send source text outside this machine.');
}
main().catch((err) => { console.error(err.message); process.exit(1); });
