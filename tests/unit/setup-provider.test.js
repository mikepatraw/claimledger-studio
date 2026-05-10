import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const wizardSource = async () => readFile('scripts/setup-provider.js', 'utf8');

test('setup wizard prompts for API key or OAuth/provider CLI auth mode', async () => {
  const source = await wizardSource();
  assert.match(source, /Auth method: 1\) API key\s+2\) OAuth\/provider CLI token/);
  assert.match(source, /CLAIMLEDGER_AUTH_METHOD/);
});

test('setup wizard can write OAuth/provider CLI mode without an API key', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-setup-'));
  const result = spawnSync(process.execPath, [path.resolve('scripts/setup-provider.js')], {
    cwd: dir,
    env: {
      ...process.env,
      CLAIMLEDGER_SETUP_CHOICE: '2',
      CLAIMLEDGER_AUTH_METHOD: '2',
      CLAIMLEDGER_BASE_URL: 'https://example.invalid/v1/chat/completions',
      CLAIMLEDGER_MODEL: 'demo-model'
    },
    encoding: 'utf8'
  });
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const envText = await readFile(path.join(dir, '.env'), 'utf8');
    assert.match(envText, /CLAIMLEDGER_PROVIDER=openai-compatible/);
    assert.match(envText, /CLAIMLEDGER_AUTH_METHOD=oauth_or_provider_cli/);
    assert.match(envText, /CLAIMLEDGER_API_KEY=\n/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
