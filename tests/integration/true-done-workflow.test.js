import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ClaimLedger } from '../../packages/core/src/ledger.js';

test('approved bullets document imports traceable approved claims and exports docx', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-approved-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const project = await ledger.createProject('Approved bullets');
    await ledger.ingestSourceDocument(project.id, {
      kind: 'approved_bullets',
      filename: 'approved-bullets.md',
      text: '- Led 12-person operations team and reduced weekly reporting time by 30% using Python automation.\n- Managed risk controls for multi-team logistics operation.'
    });
    const claims = await ledger.listClaims(project.id);
    const bullets = await ledger.listBullets(project.id);
    assert.equal(claims.length, 2);
    assert.equal(bullets.length, 2);
    assert.ok(claims.every((claim) => claim.status === 'approved' && claim.evidence_span_ids.length === 1));
    assert.ok(bullets.every((bullet) => bullet.status === 'approved' && bullet.claim_ids.length === 1));
    const exported = await ledger.exportResume(project.id, { title: 'Approved Resume', format: 'docx' });
    assert.match(exported.output_path, /\.docx$/);
    const probe = spawnSync('python3', ['-c', "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print('word/document.xml' in z.namelist()); print(z.read('word/document.xml').decode())", exported.output_path], { encoding: 'utf8' });
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /True/);
    assert.match(probe.stdout, /Approved Resume/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('job description matching generates reviewable bullets from approved claims', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'claimledger-match-'));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const project = await ledger.createProject('JD match');
    await ledger.ingestSourceDocument(project.id, { kind: 'master_resume', filename: 'resume.md', text: 'Jordan automated Python reporting for risk management and documentation across 9 teams.' });
    const claims = await ledger.extractClaims(project.id);
    await ledger.bulkClaims(claims.map((claim) => claim.id), 'approve', 'verified');
    const job = await ledger.createJobDescription(project.id, { title: 'Risk Automation Analyst', raw_text: 'Need Python automation, risk management, and documentation.' });
    const matches = await ledger.matchJob(project.id, job.id);
    assert.ok(matches.length >= 1);
    const bullets = await ledger.generateRecommendedBullets(project.id, job.id, { tone: 'technical' });
    assert.ok(bullets.length >= 1);
    assert.equal(bullets[0].status, 'needs_review');
    await ledger.approveBullet(bullets[0].id);
    const exported = await ledger.exportResume(project.id, { title: job.title, format: 'markdown', jobDescriptionId: job.id });
    const markdown = await readFile(exported.output_path, 'utf8');
    assert.match(markdown, /Risk Automation Analyst/);
    assert.equal(exported.audit_manifest.job_description_id, job.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
