import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { makeId, nowIso, validateClaim } from './schema.js';
import { segmentEvidence, extractHeuristicClaims } from './extractor.js';
import { extractClaimsWithProvider, providerFromEnv } from './provider.js';
import { assertExportable, applyResumeSections, buildAuditManifest, writeDocxResume, writeMarkdownResume } from './exporter.js';

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2)); }

export class ClaimLedger {
  constructor({ dataDir = path.resolve('.local'), provider = null } = {}) {
    this.dataDir = dataDir;
    this.dbFile = path.join(dataDir, 'db', 'claimledger.sqlite3');
    this.jsonFile = path.join(dataDir, 'db', 'claimledger-store.json');
    this.uploadDir = path.join(dataDir, 'uploads');
    this.exportDir = path.join(dataDir, 'exports');
    this.auditDir = path.join(dataDir, 'audit');
    this.provider = provider || providerFromEnv();
  }

  async init() {
    await mkdir(path.dirname(this.dbFile), { recursive: true });
    await mkdir(this.uploadDir, { recursive: true });
    await mkdir(this.exportDir, { recursive: true });
    await mkdir(this.auditDir, { recursive: true });
    const current = normalizeStore(await readJson(this.jsonFile, null));
    if (!current) await writeJson(this.jsonFile, emptyStore());
    syncSqlite(this.dbFile, current || emptyStore());
  }

  async _store() { return normalizeStore(await readJson(this.jsonFile, emptyStore())); }
  async _save(store) { const normalized = normalizeStore(store); await writeJson(this.jsonFile, normalized); syncSqlite(this.dbFile, normalized); }

  async createProject(name) {
    const store = await this._store();
    const project = { id: makeId('prj'), name, created_at: nowIso(), updated_at: nowIso() };
    store.projects.push(project);
    store.audit_events.push(audit(project.id, 'system', 'project_created', 'project', project.id, null, project));
    await this._save(store);
    return project;
  }

  async ingestSourceDocument(projectId, input) {
    const store = await this._store();
    const id = makeId('src');
    const filename = input.filename || 'source.txt';
    const decoded = extractTextFromSourceInput(input);
    const sha256 = createHash('sha256').update(decoded.text).digest('hex');
    const source = { id, project_id: projectId, kind: input.kind || 'other', filename, mime_type: decoded.mimeType, sha256, text_content: decoded.text, created_at: nowIso() };
    store.source_documents.push(source);
    await writeFile(path.join(this.uploadDir, `${id}-${filename.replace(/[^a-z0-9._-]/gi, '_')}.txt`), decoded.text);
    store.audit_events.push(audit(projectId, 'system', 'document_ingested', 'source_document', id, null, { filename, kind: source.kind, sha256, extracted_chars: decoded.text.length }));
    const spans = segmentEvidence(source);
    store.evidence_spans.push(...spans);
    for (const span of spans) store.audit_events.push(audit(projectId, 'system', 'evidence_span_created', 'evidence_span', span.id, null, span));
    if (source.kind === 'approved_bullets') importApprovedBullets(store, projectId, source, spans);
    await this._save(store);
    return source;
  }

  async importApprovedItems(projectId, input) {
    const rows = parseApprovedImportRows(input);
    const store = await this._store();
    const source = {
      id: makeId('src'),
      project_id: projectId,
      kind: 'approved_import',
      filename: input.filename || 'approved-import',
      mime_type: input.content_type || input.mime_type || 'text/plain',
      sha256: createHash('sha256').update(input.content || '').digest('hex'),
      text_content: rows.map((row) => row.evidence || row.claim_text || row.bullet_text).filter(Boolean).join('\n'),
      created_at: nowIso()
    };
    const spans = [];
    for (const [index, row] of rows.entries()) {
      const text = String(row.evidence || row.claim_text || row.bullet_text || '').trim();
      if (!text) continue;
      const start = source.text_content.indexOf(text);
      spans.push({ id: makeId('ev'), source_document_id: source.id, start_char: Math.max(0, start), end_char: Math.max(0, start) + text.length, quote: text, label: row.claim_type || 'achievement', created_by: 'approved_import', created_at: nowIso() });
      row._span_id = spans[spans.length - 1].id;
      row._row_number = index + 1;
    }
    store.source_documents.push(source);
    store.evidence_spans.push(...spans);
    await writeFile(path.join(this.uploadDir, `${source.id}-${source.filename.replace(/[^a-z0-9._-]/gi, '_')}.txt`), source.text_content);
    const importedClaims = [];
    const importedBullets = [];
    for (const row of rows) {
      const text = String(row.claim_text || row.bullet_text || '').trim();
      const evidenceIds = row._span_id ? [row._span_id] : [];
      const noteParts = ['Imported from approved JSON/CSV bulk import.'];
      if (row.source_ref) noteParts.push(`source_ref: ${row.source_ref}`);
      const claim = { id: makeId('cl'), project_id: projectId, claim_text: text.replace(/\.$/, ''), claim_type: normalizeClaimType(row.claim_type), status: 'approved', confidence: 1, evidence_score: evidenceIds.length ? 1 : 0, source: 'user', evidence_span_ids: evidenceIds, manual_evidence_note: noteParts.join(' '), created_at: nowIso(), updated_at: nowIso() };
      validateClaim(claim);
      store.claims.push(claim);
      importedClaims.push(claim);
      if (evidenceIds.length) store.claim_evidence.push({ claim_id: claim.id, evidence_span_id: evidenceIds[0], relation: 'supports', rationale: 'Imported approved claim is supported by the supplied evidence/source reference.' });
      if (row.bullet_text) {
        const bullet = { id: makeId('bul'), project_id: projectId, bullet_text: ensureSentence(row.bullet_text), status: 'approved', tone: 'approved_import', created_from: 'approved_import', claim_ids: [claim.id], job_description_id: null, target_section: row.target_section || 'Experience', created_at: nowIso(), updated_at: nowIso() };
        store.bullets.push(bullet);
        store.bullet_claims.push({ bullet_id: bullet.id, claim_id: claim.id, relation: 'expresses' });
        importedBullets.push(bullet);
      }
    }
    store.audit_events.push(audit(projectId, 'system', 'approved_bulk_imported', 'source_document', source.id, null, { filename: source.filename, imported_claims: importedClaims.length, imported_bullets: importedBullets.length }));
    await this._save(store);
    return { source_document_id: source.id, imported_claims: importedClaims.length, imported_bullets: importedBullets.length, claim_ids: importedClaims.map((claim) => claim.id), bullet_ids: importedBullets.map((bullet) => bullet.id) };
  }

  async extractClaims(projectId, { allowProviderFallback = false } = {}) {
    const store = await this._store();
    const spans = store.evidence_spans.filter((span) => store.source_documents.some((doc) => doc.project_id === projectId && doc.id === span.source_document_id));
    const existing = new Set(store.claims.filter((claim) => claim.project_id === projectId).map((claim) => claim.claim_text.toLowerCase()));
    let claims = [];
    let extractor = 'heuristic';
    try {
      const providerClaims = await extractClaimsWithProvider(projectId, spans, this.provider);
      if (providerClaims) { claims = providerClaims; extractor = this.provider.id; }
    } catch (err) {
      store.audit_events.push(audit(projectId, 'system', 'provider_extraction_failed', 'project', projectId, null, { provider: this.provider.id, error: err.message }));
      await this._save(store);
      if (!allowProviderFallback) throw err;
    }
    if (!claims.length) claims = extractHeuristicClaims(projectId, spans);
    claims = claims.filter((claim) => !existing.has(claim.claim_text.toLowerCase()));
    for (const claim of claims) {
      validateClaim(claim);
      store.claims.push(claim);
      store.claim_evidence.push(...claim.evidence_span_ids.map((spanId) => ({ claim_id: claim.id, evidence_span_id: spanId, relation: 'supports', rationale: `${extractor} extractor linked this claim to the source quote.` })));
      store.audit_events.push(audit(projectId, 'system', 'claim_extracted', 'claim', claim.id, null, claim));
    }
    await this._save(store);
    return claims;
  }

  async approveClaim(claimId, manualEvidenceNote = '', projectId = null) { return this._updateClaim(claimId, (claim) => ({ ...claim, status: 'approved', manual_evidence_note: manualEvidenceNote || claim.manual_evidence_note, updated_at: nowIso() }), 'claim_approved', projectId); }
  async declineClaim(claimId, projectId = null) { return this._updateClaim(claimId, (claim) => ({ ...claim, status: 'declined', updated_at: nowIso() }), 'claim_declined', projectId); }
  async editClaim(claimId, patch, projectId = null) {
    const safePatch = {};
    for (const key of ['claim_text', 'claim_type', 'manual_evidence_note']) if (Object.hasOwn(patch, key)) safePatch[key] = patch[key];
    return this._updateClaim(claimId, (claim) => ({ ...claim, ...safePatch, status: 'edited', updated_at: nowIso() }), 'claim_edited', projectId);
  }

  async bulkClaims(ids, action, note = '') {
    const changed = [];
    for (const id of ids) changed.push(action === 'approve' ? await this.approveClaim(id, note) : await this.declineClaim(id));
    const store = await this._store();
    const projectId = changed[0]?.project_id;
    if (projectId) {
      store.audit_events.push(audit(projectId, 'user', 'claim_bulk_modified', 'claim', 'bulk', null, { ids, action, note }));
      await this._save(store);
    }
    return changed;
  }

  async _updateClaim(claimId, updater, eventType, projectId = null) {
    const store = await this._store();
    const idx = store.claims.findIndex((claim) => claim.id === claimId);
    if (idx === -1) throw new Error(`claim not found: ${claimId}`);
    const before = store.claims[idx];
    if (projectId && before.project_id !== projectId) throw new Error(`claim ${claimId} does not belong to project ${projectId}`);
    const after = updater(before);
    validateClaim(after);
    store.claims[idx] = after;
    store.audit_events.push(audit(after.project_id, 'user', eventType, 'claim', claimId, before, after));
    await this._save(store);
    return after;
  }

  async generateBullet(projectId, claimIds, { tone = 'civilian', jobDescriptionId = null } = {}) {
    const store = await this._store();
    const claims = store.claims.filter((claim) => claimIds.includes(claim.id));
    if (claims.length !== claimIds.length) throw new Error('all claims must exist before bullet generation');
    if (!claims.every((claim) => claim.project_id === projectId)) throw new Error('all claims must belong to the target project');
    if (!claims.every((claim) => claim.status === 'approved')) throw new Error('bullets can only be generated from approved claims');
    const text = claims.map((claim) => claim.claim_text.replace(/\.$/, '')).join('; ');
    const bullet = { id: makeId('bul'), project_id: projectId, bullet_text: renderBulletText(text, tone), status: 'needs_review', tone, created_from: 'claim', claim_ids: claimIds, job_description_id: jobDescriptionId, created_at: nowIso(), updated_at: nowIso() };
    store.bullets.push(bullet);
    store.bullet_claims.push(...claimIds.map((claimId) => ({ bullet_id: bullet.id, claim_id: claimId, relation: 'expresses' })));
    store.audit_events.push(audit(projectId, 'system', 'bullet_generated', 'bullet', bullet.id, null, bullet));
    await this._save(store);
    return bullet;
  }

  async generateRecommendedBullets(projectId, jobDescriptionId, { limit = 8, tone = 'civilian' } = {}) {
    const jobMatch = await this.matchJob(projectId, jobDescriptionId, { limit });
    const bullets = [];
    for (const match of jobMatch.matches) bullets.push(await this.generateBullet(projectId, [match.claim_id], { tone, jobDescriptionId }));
    return bullets;
  }

  async approveBullet(bulletId, projectId = null) { return this._updateBullet(bulletId, (bullet) => ({ ...bullet, status: 'approved', updated_at: nowIso() }), 'bullet_approved', projectId); }
  async declineBullet(bulletId, projectId = null) { return this._updateBullet(bulletId, (bullet) => ({ ...bullet, status: 'declined', updated_at: nowIso() }), 'bullet_declined', projectId); }
  async editBullet(bulletId, patch, projectId = null) {
    const safePatch = {};
    for (const key of ['bullet_text', 'tone', 'target_section']) if (Object.hasOwn(patch, key)) safePatch[key] = patch[key];
    return this._updateBullet(bulletId, (bullet) => ({ ...bullet, ...safePatch, status: 'needs_review', updated_at: nowIso() }), 'bullet_edited', projectId);
  }

  async _updateBullet(bulletId, updater, eventType, projectId = null) {
    const store = await this._store();
    const idx = store.bullets.findIndex((bullet) => bullet.id === bulletId);
    if (idx === -1) throw new Error(`bullet not found: ${bulletId}`);
    const before = store.bullets[idx];
    if (projectId && before.project_id !== projectId) throw new Error(`bullet ${bulletId} does not belong to project ${projectId}`);
    const after = updater(before);
    store.bullets[idx] = after;
    store.audit_events.push(audit(after.project_id, 'user', eventType, 'bullet', bulletId, before, after));
    await this._save(store);
    return after;
  }

  async createJobDescription(projectId, { title = 'Target Role', raw_text }) {
    const store = await this._store();
    const job = { id: makeId('job'), project_id: projectId, title, raw_text, requirements: extractRequirements(raw_text), created_at: nowIso() };
    store.job_descriptions.push(job);
    store.audit_events.push(audit(projectId, 'system', 'job_description_added', 'job_description', job.id, null, job));
    await this._save(store);
    return job;
  }

  async matchJob(projectId, jobDescriptionId, { limit = 8 } = {}) {
    const store = await this._store();
    const job = store.job_descriptions.find((item) => item.id === jobDescriptionId && item.project_id === projectId);
    if (!job) throw new Error(`job description not found: ${jobDescriptionId}`);
    const requirements = normalizeRequirements(job.requirements);
    const claims = store.claims.filter((claim) => claim.project_id === projectId && claim.status === 'approved');
    const covered = new Set();
    const matches = claims.map((claim) => {
      const text = normalizeText(claim.claim_text);
      const hits = requirements.filter((keyword) => text.includes(keyword));
      for (const hit of hits) covered.add(hit);
      const requirementScore = requirements.length ? hits.length / requirements.length : 0;
      const evidenceScore = Math.max(0, Math.min(1, Number(claim.evidence_score || 0)));
      const metricScore = /\d|%|\$/.test(claim.claim_text) ? 0.1 : 0;
      const score = Math.min(1, Number((requirementScore * 0.65 + evidenceScore * 0.25 + metricScore).toFixed(4)));
      return {
        claim_id: claim.id,
        score,
        relevance_label: score >= 0.75 ? 'strong' : score >= 0.45 ? 'moderate' : 'weak',
        requirement_hits: hits,
        missing_requirements: requirements.filter((keyword) => !hits.includes(keyword)),
        score_breakdown: { requirement_score: Number(requirementScore.toFixed(4)), evidence_score: evidenceScore, metric_score: metricScore },
        rationale: hits.length ? `Matched ${hits.join(', ')} with ${metricScore ? 'quantified ' : ''}approved evidence.` : 'No direct requirement keywords matched this approved claim.'
      };
    }).filter((match) => match.score > 0).sort((a, b) => b.score - a.score || a.claim_id.localeCompare(b.claim_id)).slice(0, limit);
    const skill_gaps = requirements.filter((requirement) => !covered.has(requirement)).map((requirement) => ({ requirement, reason: 'No approved claim currently contains this requirement keyword.' }));
    const result = { job_description_id: job.id, requirements, matches, skill_gaps, coverage: { matched_requirements: requirements.filter((requirement) => covered.has(requirement)), total_requirements: requirements.length }, length: matches.length };
    store.audit_events.push(audit(projectId, 'system', 'job_matched', 'job_description', job.id, null, result));
    await this._save(store);
    return result;
  }

  async exportResume(projectId, { title = 'Tailored Resume', format = 'markdown', jobDescriptionId = null } = {}) {
    const store = await this._store();
    const claims = store.claims.filter((claim) => claim.project_id === projectId);
    const bullets = applyResumeSections(store.bullets.filter((bullet) => bullet.project_id === projectId && bullet.status === 'approved'), claims);
    assertExportable({ bullets, claims });
    const job = jobDescriptionId ? store.job_descriptions.find((item) => item.id === jobDescriptionId) : null;
    const jobMatch = job ? await this.matchJob(projectId, jobDescriptionId) : null;
    const manifest = buildAuditManifest({ bullets, claims, jobDescription: job, matches: jobMatch || [] });
    const extension = format === 'docx' ? 'docx' : 'md';
    const outputPath = path.join(this.exportDir, `${projectId}-tailored-resume.${extension}`);
    if (format === 'docx') await writeDocxResume(outputPath, { title, bullets, manifest });
    else await writeMarkdownResume(outputPath, { title, bullets, manifest });
    const output = { id: makeId('out'), tailoring_run_id: makeId('run'), project_id: projectId, format, output_path: outputPath, audit_manifest_json: manifest, created_at: nowIso() };
    store.tailored_outputs.push(output);
    store.audit_events.push(audit(projectId, 'system', 'export_created', 'tailored_output', output.id, null, { output_path: outputPath, format, audit_manifest: manifest }));
    await writeFile(path.join(this.auditDir, `${projectId}-manifest.json`), JSON.stringify(manifest, null, 2));
    await this._save(store);
    return { output_path: outputPath, format, audit_manifest: manifest };
  }

  async exportMarkdown(projectId, options = {}) { return this.exportResume(projectId, { ...options, format: 'markdown' }); }

  async listClaims(projectId) { return (await this._store()).claims.filter((claim) => !projectId || claim.project_id === projectId); }
  async listBullets(projectId) { return (await this._store()).bullets.filter((bullet) => !projectId || bullet.project_id === projectId); }
  async listAuditEvents(projectId) { return (await this._store()).audit_events.filter((event) => !projectId || event.project_id === projectId); }
  async listSourceDocuments(projectId) { return (await this._store()).source_documents.filter((doc) => !projectId || doc.project_id === projectId); }
  async listEvidenceSpans(filter = null) {
    const store = await this._store();
    if (!filter) return store.evidence_spans;
    if (typeof filter === 'string') return store.evidence_spans.filter((span) => span.source_document_id === filter);
    const projectDocs = new Set(store.source_documents.filter((doc) => !filter.project_id || doc.project_id === filter.project_id).map((doc) => doc.id));
    return store.evidence_spans.filter((span) => (!filter.source_document_id || span.source_document_id === filter.source_document_id) && projectDocs.has(span.source_document_id));
  }
  async listJobDescriptions(projectId) { return (await this._store()).job_descriptions.filter((job) => !projectId || job.project_id === projectId); }
  async dump() { return this._store(); }
}

function extractTextFromSourceInput(input) {
  if (typeof input.text === 'string' && input.text.trim()) return { text: input.text, mimeType: input.mime_type || 'text/markdown' };
  if (!input.content_base64) throw new Error('source document requires text or content_base64');
  const buffer = Buffer.from(input.content_base64, 'base64');
  const name = String(input.filename || '').toLowerCase();
  if (name.endsWith('.docx') || input.mime_type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { text: extractDocxText(buffer), mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  }
  if (name.endsWith('.pdf') || input.mime_type === 'application/pdf') {
    return { text: extractPdfText(buffer), mimeType: 'application/pdf' };
  }
  return { text: buffer.toString('utf8'), mimeType: input.mime_type || 'text/plain' };
}

function extractDocxText(buffer) {
  const script = String.raw`
import re, sys, zipfile, xml.etree.ElementTree as ET
from io import BytesIO
raw=sys.stdin.buffer.read()
with zipfile.ZipFile(BytesIO(raw)) as z:
    xml=z.read('word/document.xml')
root=ET.fromstring(xml)
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
paras=[]
for p in root.findall('.//w:p', ns):
    text=''.join(t.text or '' for t in p.findall('.//w:t', ns)).strip()
    if text: paras.append(text)
print('\n'.join(paras))
`;
  const result = spawnSync('python3', ['-c', script], { input: buffer, encoding: 'buffer', maxBuffer: 10 * 1024 * 1024, timeout: 15_000 });
  if (result.status !== 0) throw new Error(`docx text extraction failed: ${String(result.stderr || result.stdout)}`);
  return String(result.stdout).trim();
}

function extractPdfText(buffer) {
  const result = spawnSync('pdftotext', ['-', '-'], { input: buffer, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024, timeout: 15_000 });
  if (result.error?.code === 'ENOENT') throw new Error('PDF text extraction requires the local `pdftotext` command. Install poppler-utils or upload/paste text/Markdown instead.');
  if (result.status !== 0) throw new Error(`PDF text extraction failed with pdftotext. Install/verify poppler-utils or upload/paste text/Markdown instead: ${String(result.stderr || result.stdout)}`);
  return String(result.stdout).trim();
}

function importApprovedBullets(store, projectId, source, spans) {
  const spanByQuote = new Map(spans.map((span) => [span.quote.toLowerCase(), span]));
  const lines = source.text_content.split(/\r?\n/).map((line) => line.trim().replace(/^[-•*]\s*/, '')).filter((line) => line.length > 12);
  for (const line of lines) {
    const span = spanByQuote.get(line.toLowerCase()) || spans.find((item) => item.quote.includes(line) || line.includes(item.quote));
    if (!span) continue;
    const claim = { id: makeId('cl'), project_id: projectId, claim_text: line.replace(/\.$/, ''), claim_type: 'achievement', status: 'approved', confidence: 1, evidence_score: 1, source: 'user', evidence_span_ids: [span.id], manual_evidence_note: 'Imported from approved bullets source document.', created_at: nowIso(), updated_at: nowIso() };
    const bullet = { id: makeId('bul'), project_id: projectId, bullet_text: line.replace(/\.$/, '.') , status: 'approved', tone: 'approved_source', created_from: 'approved_bullets_doc', claim_ids: [claim.id], job_description_id: null, created_at: nowIso(), updated_at: nowIso() };
    store.claims.push(claim);
    store.bullets.push(bullet);
    store.claim_evidence.push({ claim_id: claim.id, evidence_span_id: span.id, relation: 'supports', rationale: 'Imported approved bullet is supported by its approved bullets source quote.' });
    store.bullet_claims.push({ bullet_id: bullet.id, claim_id: claim.id, relation: 'expresses' });
    store.audit_events.push(audit(projectId, 'system', 'approved_bullet_imported', 'bullet', bullet.id, null, { bullet, claim }));
  }
}


function parseApprovedImportRows(input) {
  const raw = String(input.content ?? input.text ?? '');
  if (!raw.trim()) throw new Error('bulk import requires content');
  const lowerName = String(input.filename || '').toLowerCase();
  const type = String(input.content_type || input.mime_type || '').toLowerCase();
  const rows = lowerName.endsWith('.json') || type.includes('json') ? parseJsonRows(raw) : parseCsvRows(raw);
  return rows.map((row, index) => normalizeApprovedRow(row, index + 1));
}

function parseJsonRows(raw) {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) { throw new Error(`bulk JSON import is invalid: ${err.message}`); }
  const rows = Array.isArray(parsed) ? parsed : parsed.items || parsed.claims || parsed.bullets;
  if (!Array.isArray(rows)) throw new Error('bulk JSON import requires an array of rows');
  return rows;
}

function parseCsvRows(raw) {
  const records = parseCsv(raw);
  if (records.length < 2) throw new Error('bulk CSV import requires a header row and at least one data row');
  const headers = records[0].map((h) => h.trim());
  return records.slice(1).filter((row) => row.some((cell) => String(cell).trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quoted) {
      if (ch === '"' && raw[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeApprovedRow(row, rowNumber) {
  if (!row || typeof row !== 'object') throw new Error(`row ${rowNumber} must be an object`);
  const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [String(key).trim().toLowerCase(), typeof value === 'string' ? value.trim() : value]));
  const claimText = String(normalized.claim_text || normalized.claim || normalized.text || '').trim();
  const bulletText = String(normalized.bullet_text || normalized.bullet || '').trim();
  if (!claimText && !bulletText) throw new Error(`row ${rowNumber} requires claim_text or bullet_text`);
  return { claim_text: claimText || bulletText, bullet_text: bulletText, claim_type: normalized.claim_type || normalized.type || 'achievement', evidence: String(normalized.evidence || normalized.evidence_text || normalized.quote || '').trim(), source_ref: String(normalized.source_ref || normalized.source || '').trim(), target_section: String(normalized.target_section || normalized.section || 'Experience').trim() };
}

function normalizeClaimType(value) {
  const allowed = new Set(['achievement', 'skill', 'scope', 'credential', 'tool', 'domain', 'responsibility', 'metric', 'other']);
  const type = String(value || 'achievement').toLowerCase();
  return allowed.has(type) ? type : 'other';
}

function ensureSentence(text) {
  const clean = String(text || '').trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function normalizeRequirements(requirements) {
  const stop = new Set(['and', 'the', 'for', 'with', 'from', 'this', 'that', 'role', 'need', 'must', 'will', 'you', 'our', 'job']);
  return [...new Set((requirements || []).map((req) => normalizeText(req)).filter((req) => req.length > 2 && !stop.has(req)))];
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
}

function renderBulletText(text, tone) {
  const clean = text.replace(/\.$/, '');
  if (tone === 'technical') return `${clean}, applying technical execution, documentation, and repeatable controls.`;
  if (tone === 'leadership') return `${clean}, aligning team execution, risk controls, and stakeholder outcomes.`;
  return `${clean}.`;
}

function extractRequirements(text) {
  const stop = new Set(['The','And','For','With','From','This','That','Role','Need','Must','Will','You','Our','Job']);
  return [...new Set(String(text || '').match(/\b[A-Za-z][A-Za-z+#.]{2,}\b/g) || [])]
    .filter((word) => !stop.has(word))
    .slice(0, 40);
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
  const result = spawnSync('python3', ['-c', script, dbFile], { input: JSON.stringify(store), encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) throw new Error(`sqlite sync failed: ${result.stderr || result.stdout}`);
}

function emptyStore() {
  return { projects: [], source_documents: [], evidence_spans: [], claims: [], claim_evidence: [], bullets: [], bullet_claims: [], job_descriptions: [], tailoring_runs: [], tailored_outputs: [], audit_events: [] };
}
function normalizeStore(store) {
  if (!store) return store;
  return { ...emptyStore(), ...store };
}
function audit(projectId, actor, eventType, entityType, entityId, before, after) {
  return { id: makeId('aud'), project_id: projectId, actor, event_type: eventType, entity_type: entityType, entity_id: entityId, before_json: before, after_json: after, metadata_json: null, created_at: nowIso() };
}
