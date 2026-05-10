import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaimLedger } from '../../packages/core/src/ledger.js';

test('upload to extraction to approve to bullet to markdown export workflow', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const project = await ledger.createProject('Synthetic demo');
    const doc = await ledger.ingestSourceDocument(project.id, { kind: 'master_resume', filename: 'sample.md', text: 'Jordan Rivera led 8-person lab team and automated 14 weekly checks using Python.' });
    assert.match(doc.sha256, /^[a-f0-9]{64}$/);
    const claims = await ledger.extractClaims(project.id);
    assert.ok(claims.length >= 1);
    assert.ok(claims.every((claim) => claim.evidence_span_ids.length >= 1));
    await ledger.bulkClaims(claims.map((claim) => claim.id), 'approve', 'reviewed in one batch');
    const bulkAudit = await ledger.listAuditEvents(project.id);
    const bulkEvent = bulkAudit.find((event) => event.event_type === 'claim_bulk_modified');
    assert.deepEqual(bulkEvent.after_json, {
      ids: claims.map((claim) => claim.id),
      action: 'approve',
      note: 'reviewed in one batch',
    });
    const approved = (await ledger.listClaims(project.id)).find((claim) => claim.id === claims[0].id);
    const bullet = await ledger.generateBullet(project.id, [approved.id], { tone: 'technical' });
    await ledger.approveBullet(bullet.id);
    const exported = await ledger.exportMarkdown(project.id, { title: 'Synthetic Target Role' });
    const markdown = await readFile(exported.output_path, 'utf8');
    assert.match(markdown, /Synthetic Target Role/);
    assert.equal(exported.audit_manifest.bullets[0].claim_ids[0], approved.id);
    const audit = await ledger.listAuditEvents(project.id);
    assert.ok(audit.some((event) => event.event_type === 'export_created'));
    const { spawnSync } = await import('node:child_process');
    const sqliteCheck = spawnSync('python3', ['-c', "import sqlite3,sys; conn=sqlite3.connect(sys.argv[1]); print(conn.execute('select count(*) from claims').fetchone()[0])", path.join(dir, 'db', 'claimledger.sqlite3')], { encoding: 'utf8' });
    assert.equal(sqliteCheck.status, 0, sqliteCheck.stderr);
    assert.ok(Number(sqliteCheck.stdout.trim()) >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
