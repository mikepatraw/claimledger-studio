import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ClaimLedger } from '../../packages/core/src/ledger.js';

async function withLedger(prefix, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    const ledger = new ClaimLedger({ dataDir: dir });
    await ledger.init();
    const project = await ledger.createProject('Targeting project');
    return await fn(ledger, project);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('PDF ingestion reports a clear local dependency error when pdftotext is unavailable', async () => {
  await withLedger('claimledger-pdf-missing-', async (ledger, project) => {
    const originalPath = process.env.PATH;
    process.env.PATH = '/definitely-not-a-real-path';
    try {
      await assert.rejects(
        () => ledger.ingestSourceDocument(project.id, {
          kind: 'master_resume',
          filename: 'resume.pdf',
          mime_type: 'application/pdf',
          content_base64: Buffer.from('%PDF-1.4 synthetic').toString('base64'),
        }),
        /PDF text extraction requires the local `pdftotext` command.*poppler-utils/i,
      );
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

test('job matching returns deterministic scores, rationales, and project skill gaps', async () => {
  await withLedger('claimledger-job-match-', async (ledger, project) => {
    await ledger.ingestSourceDocument(project.id, {
      kind: 'master_resume',
      filename: 'resume.md',
      text: [
        'Jordan automated 14 weekly controls using Python and SQL.',
        'Jordan maintained Linux incident runbooks for support teams.',
      ].join('\n'),
    });
    const claims = await ledger.extractClaims(project.id);
    await ledger.bulkClaims(claims.map((claim) => claim.id), 'approve', 'verified source evidence');
    const job = await ledger.createJobDescription(project.id, {
      title: 'Data Automation Analyst',
      raw_text: 'Need Python SQL automation Kubernetes and stakeholder reporting.',
    });

    const result = await ledger.matchJob(project.id, job.id, { limit: 5 });

    assert.ok(Array.isArray(result.matches));
    assert.ok(result.matches.length >= 1);
    assert.deepEqual(result.matches, [...result.matches].sort((a, b) => b.score - a.score || a.claim_id.localeCompare(b.claim_id)));
    const top = result.matches[0];
    assert.equal(typeof top.score, 'number');
    assert.ok(top.score > 0 && top.score <= 1);
    assert.ok(top.relevance_label);
    assert.ok(top.rationale.includes('Matched'));
    assert.ok(top.score_breakdown.requirement_score > 0);
    assert.ok(top.requirement_hits.includes('python'));
    assert.ok(top.requirement_hits.includes('sql'));
    assert.ok(result.skill_gaps.some((gap) => gap.requirement === 'kubernetes'));
    assert.ok(result.requirements.includes('python'));
  });
});

test('bulk import accepts JSON approved claims and bullets with evidence references', async () => {
  await withLedger('claimledger-json-import-', async (ledger, project) => {
    const result = await ledger.importApprovedItems(project.id, {
      filename: 'approved.json',
      content_type: 'application/json',
      content: JSON.stringify([
        {
          claim_text: 'Jordan automated 14 weekly controls using Python and SQL',
          bullet_text: 'Automated 14 weekly controls using Python and SQL.',
          claim_type: 'achievement',
          evidence: 'Jordan automated 14 weekly controls using Python and SQL.',
          source_ref: 'synthetic-resume:4',
        },
      ]),
    });

    assert.equal(result.imported_claims, 1);
    assert.equal(result.imported_bullets, 1);
    const [claim] = await ledger.listClaims(project.id);
    const [bullet] = await ledger.listBullets(project.id);
    const spans = await ledger.listEvidenceSpans({ project_id: project.id });
    assert.equal(claim.status, 'approved');
    assert.deepEqual(bullet.claim_ids, [claim.id]);
    assert.equal(claim.evidence_span_ids.length, 1);
    assert.equal(spans[0].quote, 'Jordan automated 14 weekly controls using Python and SQL.');
    assert.match(claim.manual_evidence_note, /source_ref: synthetic-resume:4/);
  });
});

test('bulk import accepts CSV approved claims and rejects rows without claim or bullet text', async () => {
  await withLedger('claimledger-csv-import-', async (ledger, project) => {
    const result = await ledger.importApprovedItems(project.id, {
      filename: 'approved.csv',
      content_type: 'text/csv',
      content: 'claim_text,bullet_text,claim_type,evidence,source_ref\n"Jordan maintained Linux runbooks","Maintained Linux runbooks.",responsibility,"Jordan maintained Linux runbooks.",resume:7\n',
    });
    assert.equal(result.imported_claims, 1);
    assert.equal(result.imported_bullets, 1);

    await assert.rejects(
      () => ledger.importApprovedItems(project.id, {
        filename: 'bad.csv',
        content_type: 'text/csv',
        content: 'claim_text,bullet_text,evidence\n,,"orphan evidence"\n',
      }),
      /row 1 requires claim_text or bullet_text/i,
    );
  });
});
