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

test('studio UI labels the workflow and exposes operation progress', async () => {
  const source = await uiSource();

  for (const text of [
    'Project name',
    'Source filename',
    'Source type',
    'Target role title',
    'Generation tone',
    'Operation progress',
    'Ready for local work.',
    'Ingesting source document',
    'Extracting claims',
    'Generating bullet drafts',
    'Exporting approved resume',
  ]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('claims and bullets include inline source evidence previews', async () => {
  const source = await uiSource();

  for (const text of [
    'sourcePreviewByClaim',
    'evidence-preview',
    'Source preview',
    'Project-scoped evidence',
    'renderBulletEvidencePreview',
    'No linked source evidence yet',
  ]) {
    assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
