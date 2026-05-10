import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExportable, buildAuditManifest } from '../../packages/core/src/exporter.js';

test('export blocks unapproved or unsupported bullets', () => {
  const claims = [{ id: 'c1', status: 'needs_review', evidence_span_ids: ['e1'] }];
  const bullets = [{ id: 'b1', status: 'approved', claim_ids: ['c1'], bullet_text: 'Built a test harness.' }];
  assert.throws(() => assertExportable({ bullets, claims }), /approved claim/);
});

test('export manifest maps every bullet to claims and evidence spans', () => {
  const claims = [{ id: 'c1', status: 'approved', evidence_span_ids: ['e1'] }];
  const bullets = [{ id: 'b1', status: 'approved', claim_ids: ['c1'], bullet_text: 'Built a test harness.' }];
  assertExportable({ bullets, claims });
  assert.deepEqual(buildAuditManifest({ bullets, claims }).bullets[0], { bullet_id: 'b1', claim_ids: ['c1'], evidence_span_ids: ['e1'] });
});
