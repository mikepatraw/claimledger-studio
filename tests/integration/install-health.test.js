import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function waitForHealth(port, deadlineMs = 5000) {
  const deadline = Date.now() + deadlineMs;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return resolve(await res.json());
      } catch {}
      if (Date.now() > deadline) return reject(new Error('health check timed out'));
      setTimeout(tick, 150);
    };
    tick();
  });
}

test('local UI health check is reachable after setup', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-health-'));
  const port = 49373;
  const child = spawn(process.execPath, ['apps/api/src/server.js'], {
    cwd: path.resolve('.'),
    env: { ...process.env, PORT: String(port), CLAIMLEDGER_DATA_DIR: dir, CLAIMLEDGER_PROVIDER: 'heuristic-only' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const health = await waitForHealth(port);
    assert.deepEqual(health, { ok: true, app: 'claimledger-studio' });
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
