import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaimLedger } from '../../packages/core/src/ledger.js';

async function setupApprovedClaim(ledger, projectName, text) {
  const project = await ledger.createProject(projectName);
  await ledger.ingestSourceDocument(project.id, { kind: 'master_resume', filename: `${projectName}.md`, text });
  const claims = await ledger.extractClaims(project.id);
  await ledger.bulkClaims(claims.map((claim) => claim.id), 'approve', 'verified');
  return { project, claim: (await ledger.listClaims(project.id))[0] };
}

test('generic claim and bullet edits cannot bypass approval or rewrite trace fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-integrity-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const { project, claim } = await setupApprovedClaim(ledger, 'Integrity', 'Jordan automated 14 weekly checks using Python.');
    const editedClaim = await ledger.editClaim(claim.id, { status: 'approved', project_id: 'evil', source: 'user', evidence_span_ids: [], claim_text: 'Edited safe text' });
    assert.equal(editedClaim.status, 'edited');
    assert.equal(editedClaim.project_id, project.id);
    assert.equal(editedClaim.source, claim.source);
    assert.deepEqual(editedClaim.evidence_span_ids, claim.evidence_span_ids);
    await ledger.approveClaim(claim.id, 'verified');
    const bullet = await ledger.generateBullet(project.id, [claim.id]);
    const editedBullet = await ledger.editBullet(bullet.id, { status: 'approved', project_id: 'evil', claim_ids: [], bullet_text: 'Edited bullet.' });
    assert.equal(editedBullet.status, 'needs_review');
    assert.equal(editedBullet.project_id, project.id);
    assert.deepEqual(editedBullet.claim_ids, [claim.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('bullet generation rejects cross-project claims and empty export fails', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-cross-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const a = await setupApprovedClaim(ledger, 'A', 'Jordan automated 14 weekly checks using Python.');
    const b = await ledger.createProject('B');
    await assert.rejects(() => ledger.generateBullet(b.id, [a.claim.id]), /target project/);
    await assert.rejects(() => ledger.exportResume(b.id), /at least one approved bullet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('provider extraction failures are durably audited when fallback is disabled', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-provider-fail-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir, provider: { id: 'openai-compatible', baseUrl: 'http://127.0.0.1:9/v1', model: 'none', apiKey: '', timeoutMs: 250 } });
    await ledger.init();
    const project = await ledger.createProject('Provider failure');
    await ledger.ingestSourceDocument(project.id, { kind: 'master_resume', filename: 'resume.md', text: 'Jordan automated 14 weekly checks using Python.' });
    await assert.rejects(() => ledger.extractClaims(project.id, { allowProviderFallback: false }));
    const audit = await ledger.listAuditEvents(project.id);
    assert.ok(audit.some((event) => event.event_type === 'provider_extraction_failed'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
