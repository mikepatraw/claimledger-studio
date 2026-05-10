import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { makeId, nowIso, validateClaim } from './schema.js';
import { segmentEvidence, extractHeuristicClaims } from './extractor.js';
import { assertExportable, buildAuditManifest, renderMarkdownResume } from './exporter.js';

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2)); }

export class ClaimLedger {
  constructor({ dataDir = path.resolve('.local'), provider = { id: 'heuristic-only' } } = {}) {
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'db', 'claimledger.sqlite3');
    this.jsonFile = path.join(dataDir, 'db', 'claimledger-store.json');
    this.uploadDir = path.join(dataDir, 'uploads');
    this.exportDir = path.join(dataDir, 'exports');
    this.auditDir = path.join(dataDir, 'audit');
    this.provider = provider;
  }

  async init() {
    await mkdir(path.dirname(this.dbFile), { recursive: true });
    await mkdir(this.uploadDir, { recursive: true });
    await mkdir(this.exportDir, { recursive: true });
    await mkdir(this.auditDir, { recursive: true });
    const current = await readJson(this.jsonFile, null);
    if (!current) await writeJson(this.jsonFile, emptyStore());
    syncSqlite(this.dbFile, current || emptyStore());
  }

  async _store() { return readJson(this.jsonFile, emptyStore()); }
  async _save(store) { await writeJson(this.jsonFile, store); syncSqlite(this.dbFile, store); }

  async createProject(name) {
    const store = await this._store();
    const project = { id: makeId('prj'), name, created_at: nowIso(), updated_at: nowIso() };
    store.projects.push(project);
    store.audit_events.push(audit(project.id, 'system', 'project_created', 'project', project.id, null, project));
    await this._save(store);
    return project;
  }

  async ingestSourceDocument(projectId, { kind, filename, text }) {
    const store = await this._store();
    const id = makeId('src');
    const sha256 = createHash('sha256').update(text).digest('hex');
    const source = { id, project_id: projectId, kind, filename, mime_type: 'text/markdown', sha256, text_content: text, created_at: nowIso() };
    store.source_documents.push(source);
    await writeFile(path.join(this.uploadDir, `${id}-${filename.replace(/[^a-z0-9._-]/gi, '_')}`), text);
    store.audit_events.push(audit(projectId, 'system', 'document_ingested', 'source_document', id, null, { filename, kind, sha256 }));
    const spans = segmentEvidence(source);
    store.evidence_spans.push(...spans);
    for (const span of spans) store.audit_events.push(audit(projectId, 'system', 'evidence_span_created', 'evidence_span', span.id, null, span));
    await this._save(store);
    return source;
  }

  async extractClaims(projectId) {
    const store = await this._store();
    const spans = store.evidence_spans.filter((span) => store.source_documents.some((doc) => doc.project_id === projectId && doc.id === span.source_document_id));
    const existing = new Set(store.claims.filter((claim) => claim.project_id === projectId).map((claim) => claim.claim_text.toLowerCase()));
    const claims = extractHeuristicClaims(projectId, spans).filter((claim) => !existing.has(claim.claim_text.toLowerCase()));
    for (const claim of claims) {
      validateClaim(claim);
      store.claims.push(claim);
      store.claim_evidence.push(...claim.evidence_span_ids.map((spanId) => ({ claim_id: claim.id, evidence_span_id: spanId, relation: 'supports', rationale: 'Heuristic extractor linked this claim to the source quote.' })));
      store.audit_events.push(audit(projectId, 'system', 'claim_extracted', 'claim', claim.id, null, claim));
    }
    await this._save(store);
    return claims;
  }

  async approveClaim(claimId, manualEvidenceNote = '') { return this._updateClaim(claimId, (claim) => ({ ...claim, status: 'approved', manual_evidence_note: manualEvidenceNote || claim.manual_evidence_note, updated_at: nowIso() }), 'claim_approved'); }
  async declineClaim(claimId) { return this._updateClaim(claimId, (claim) => ({ ...claim, status: 'declined', updated_at: nowIso() }), 'claim_declined'); }
  async editClaim(claimId, patch) { return this._updateClaim(claimId, (claim) => ({ ...claim, ...patch, status: patch.status || 'edited', updated_at: nowIso() }), 'claim_edited'); }

  async bulkClaims(ids, action) {
    const changed = [];
    for (const id of ids) changed.push(action === 'approve' ? await this.approveClaim(id) : await this.declineClaim(id));
    const store = await this._store();
    const projectId = changed[0]?.project_id;
    if (projectId) {
      store.audit_events.push(audit(projectId, 'user', 'claim_bulk_modified', 'claim', 'bulk', null, { ids, action }));
      await this._save(store);
    }
    return changed;
  }

  async _updateClaim(claimId, updater, eventType) {
    const store = await this._store();
    const idx = store.claims.findIndex((claim) => claim.id === claimId);
    if (idx === -1) throw new Error(`claim not found: ${claimId}`);
    const before = store.claims[idx];
    const after = updater(before);
    validateClaim(after);
    store.claims[idx] = after;
    store.audit_events.push(audit(after.project_id, 'user', eventType, 'claim', claimId, before, after));
    await this._save(store);
    return after;
  }

  async generateBullet(projectId, claimIds, { tone = 'civilian' } = {}) {
    const store = await this._store();
    const claims = store.claims.filter((claim) => claimIds.includes(claim.id));
    if (claims.length !== claimIds.length) throw new Error('all claims must exist before bullet generation');
    if (!claims.every((claim) => claim.status === 'approved')) throw new Error('bullets can only be generated from approved claims');
    const text = claims.map((claim) => claim.claim_text.replace(/\.$/, '')).join('; ');
    const bullet = { id: makeId('bul'), project_id: projectId, bullet_text: `${text}.`, status: 'needs_review', tone, created_from: 'claim', claim_ids: claimIds, created_at: nowIso(), updated_at: nowIso() };
    store.bullets.push(bullet);
    store.bullet_claims.push(...claimIds.map((claimId) => ({ bullet_id: bullet.id, claim_id: claimId, relation: 'expresses' })));
    store.audit_events.push(audit(projectId, 'system', 'bullet_generated', 'bullet', bullet.id, null, bullet));
    await this._save(store);
    return bullet;
  }

  async approveBullet(bulletId) {
    const store = await this._store();
    const idx = store.bullets.findIndex((bullet) => bullet.id === bulletId);
    if (idx === -1) throw new Error(`bullet not found: ${bulletId}`);
    const before = store.bullets[idx];
    const after = { ...before, status: 'approved', updated_at: nowIso() };
    store.bullets[idx] = after;
    store.audit_events.push(audit(after.project_id, 'user', 'bullet_approved', 'bullet', bulletId, before, after));
    await this._save(store);
    return after;
  }

  async exportMarkdown(projectId, { title = 'Tailored Resume' } = {}) {
    const store = await this._store();
    const claims = store.claims.filter((claim) => claim.project_id === projectId);
    const bullets = store.bullets.filter((bullet) => bullet.project_id === projectId && bullet.status === 'approved');
    assertExportable({ bullets, claims });
    const manifest = buildAuditManifest({ bullets, claims });
    const outputPath = path.join(this.exportDir, `${projectId}-tailored-resume.md`);
    await writeFile(outputPath, renderMarkdownResume({ title, bullets, manifest }));
    const output = { id: makeId('out'), tailoring_run_id: makeId('run'), format: 'markdown', output_path: outputPath, audit_manifest_json: manifest, created_at: nowIso() };
    store.tailored_outputs.push(output);
    store.audit_events.push(audit(projectId, 'system', 'export_created', 'tailored_output', output.id, null, { output_path: outputPath, audit_manifest: manifest }));
    await writeFile(path.join(this.auditDir, `${projectId}-manifest.json`), JSON.stringify(manifest, null, 2));
    await this._save(store);
    return { output_path: outputPath, audit_manifest: manifest };
  }

  async listClaims(projectId) { return (await this._store()).claims.filter((claim) => !projectId || claim.project_id === projectId); }
  async listBullets(projectId) { return (await this._store()).bullets.filter((bullet) => !projectId || bullet.project_id === projectId); }
  async listAuditEvents(projectId) { return (await this._store()).audit_events.filter((event) => !projectId || event.project_id === projectId); }
  async listSourceDocuments(projectId) { return (await this._store()).source_documents.filter((doc) => !projectId || doc.project_id === projectId); }
  async listEvidenceSpans(sourceDocumentId) { return (await this._store()).evidence_spans.filter((span) => !sourceDocumentId || span.source_document_id === sourceDocumentId); }
  async dump() { return this._store(); }
}

function syncSqlite(dbFile, store) {
  const script = String.raw`
import json, sqlite3, sys
path=sys.argv[1]
store=json.loads(sys.stdin.read())
conn=sqlite3.connect(path)
cur=conn.cursor()
for table in ['projects','source_documents','evidence_spans','claims','bullets','job_descriptions','tailoring_runs','tailored_outputs','audit_events']:
    cur.execute(f'CREATE TABLE IF NOT EXISTS {table} (id TEXT PRIMARY KEY, data_json TEXT NOT NULL)')
    cur.execute(f'DELETE FROM {table}')
for table, rows in store.items():
    if table in ['claim_evidence','bullet_claims']:
        continue
    if table not in ['projects','source_documents','evidence_spans','claims','bullets','job_descriptions','tailoring_runs','tailored_outputs','audit_events']:
        continue
    for row in rows:
        cur.execute(f'INSERT OR REPLACE INTO {table} (id, data_json) VALUES (?, ?)', (row.get('id'), json.dumps(row)))
cur.execute('CREATE TABLE IF NOT EXISTS claim_evidence (claim_id TEXT NOT NULL, evidence_span_id TEXT NOT NULL, relation TEXT NOT NULL, rationale TEXT)')
cur.execute('DELETE FROM claim_evidence')
for row in store.get('claim_evidence', []):
    cur.execute('INSERT INTO claim_evidence VALUES (?, ?, ?, ?)', (row.get('claim_id'), row.get('evidence_span_id'), row.get('relation'), row.get('rationale')))
cur.execute('CREATE TABLE IF NOT EXISTS bullet_claims (bullet_id TEXT NOT NULL, claim_id TEXT NOT NULL, relation TEXT NOT NULL)')
cur.execute('DELETE FROM bullet_claims')
for row in store.get('bullet_claims', []):
    cur.execute('INSERT INTO bullet_claims VALUES (?, ?, ?)', (row.get('bullet_id'), row.get('claim_id'), row.get('relation')))
conn.commit(); conn.close()
`;
  const result = spawnSync('python3', ['-c', script, dbFile], { input: JSON.stringify(store), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`sqlite sync failed: ${result.stderr || result.stdout}`);
}

function emptyStore() {
  return { projects: [], source_documents: [], evidence_spans: [], claims: [], claim_evidence: [], bullets: [], bullet_claims: [], job_descriptions: [], tailoring_runs: [], tailored_outputs: [], audit_events: [] };
}
function audit(projectId, actor, eventType, entityType, entityId, before, after) {
  return { id: makeId('aud'), project_id: projectId, actor, event_type: eventType, entity_type: entityType, entity_id: entityId, before_json: before, after_json: after, metadata_json: null, created_at: nowIso() };
}
