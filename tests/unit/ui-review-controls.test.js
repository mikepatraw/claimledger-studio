import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const uiSource = async () => `${await readFile('apps/studio/src/index.html', 'utf8')}\n${await readFile('apps/studio/src/app.js', 'utf8')}`;

test('review UI exposes individual and bulk claim review controls', async () => {
  const source = await uiSource();

  for (const label of [
    'Approve',
    'Edit',
    'Decline',
    'Select all pending',
    'Approve selected',
    'Decline selected',
    'Bulk note',
  ]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
