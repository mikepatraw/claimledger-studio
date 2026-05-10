import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaimLedger } from '../../../packages/core/src/ledger.js';
import { providerFromEnv } from '../../../packages/core/src/provider.js';
import { providerCatalog } from '../../../packages/core/src/schema.js';
import { loadClaimLedgerEnv } from '../../../packages/core/src/secrets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
await loadClaimLedgerEnv(root);
const studioDir = path.join(root, 'apps/studio/src');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const provider = providerFromEnv();
const ledger = new ClaimLedger({ dataDir: process.env.CLAIMLEDGER_DATA_DIR || path.join(root, '.local'), provider });
await ledger.init();

async function parseBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 25 * 1024 * 1024) throw new Error('request body too large; max 25MB');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(value, null, 2));
}
function sendFile(res, contentType, body) {
  res.writeHead(200, { 'content-type': contentType, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true, app: 'claimledger-studio', provider: provider.id });
    if (url.pathname === '/' || url.pathname === '/index.html') return sendFile(res, 'text/html; charset=utf-8', await readFile(path.join(studioDir, 'index.html'), 'utf8'));
    if (url.pathname === '/app.js') return sendFile(res, 'text/javascript; charset=utf-8', await readFile(path.join(studioDir, 'app.js'), 'utf8'));

    if (url.pathname === '/api/projects' && req.method === 'GET') return json(res, 200, (await ledger.dump()).projects);
    if (url.pathname === '/api/projects' && req.method === 'POST') return json(res, 201, await ledger.createProject((await parseBody(req)).name || 'Local Project'));

    if (url.pathname === '/api/source-documents' && req.method === 'GET') return json(res, 200, await ledger.listSourceDocuments(url.searchParams.get('project_id')));
    if (url.pathname === '/api/source-documents' && req.method === 'POST') {
      const body = await parseBody(req);
      return json(res, 201, await ledger.ingestSourceDocument(body.project_id, body));
    }
    if (url.pathname.startsWith('/api/source-documents/') && req.method === 'GET') {
      const id = url.pathname.split('/').pop();
      return json(res, 200, (await ledger.listSourceDocuments()).find((doc) => doc.id === id));
    }

    if (url.pathname === '/api/evidence-spans' && req.method === 'GET') return json(res, 200, await ledger.listEvidenceSpans({ source_document_id: url.searchParams.get('source_document_id'), project_id: url.searchParams.get('project_id') }));

    if (url.pathname === '/api/claims' && req.method === 'GET') return json(res, 200, await ledger.listClaims(url.searchParams.get('project_id')));
    if (url.pathname === '/api/claims' && req.method === 'POST') {
      const body = await parseBody(req);
      return json(res, 201, await ledger.extractClaims(body.project_id, { allowProviderFallback: Boolean(body.allow_provider_fallback) }));
    }
    const approveClaim = url.pathname.match(/^\/api\/claims\/([^/]+)\/approve$/);
    if (approveClaim && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.approveClaim(approveClaim[1], b.manual_evidence_note, b.project_id || null)); }
    const declineClaim = url.pathname.match(/^\/api\/claims\/([^/]+)\/decline$/);
    if (declineClaim && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.declineClaim(declineClaim[1], b.project_id || null)); }
    const patchClaim = url.pathname.match(/^\/api\/claims\/([^/]+)$/);
    if (patchClaim && req.method === 'PATCH') { const b = await parseBody(req); return json(res, 200, await ledger.editClaim(patchClaim[1], b, b.project_id || null)); }
    if (url.pathname === '/api/claims/bulk' && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.bulkClaims(b.ids, b.action, b.note || '')); }
    if (url.pathname === '/api/import/approved-items' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.importApprovedItems(b.project_id, b)); }

    if (url.pathname === '/api/bullets' && req.method === 'GET') return json(res, 200, await ledger.listBullets(url.searchParams.get('project_id')));
    if (url.pathname === '/api/bullets' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.generateBullet(b.project_id, b.claim_ids, { tone: b.tone, jobDescriptionId: b.job_description_id })); }
    const approveBullet = url.pathname.match(/^\/api\/bullets\/([^/]+)\/approve$/);
    if (approveBullet && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.approveBullet(approveBullet[1], b.project_id || null)); }
    const declineBullet = url.pathname.match(/^\/api\/bullets\/([^/]+)\/decline$/);
    if (declineBullet && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.declineBullet(declineBullet[1], b.project_id || null)); }
    const patchBullet = url.pathname.match(/^\/api\/bullets\/([^/]+)$/);
    if (patchBullet && req.method === 'PATCH') { const b = await parseBody(req); return json(res, 200, await ledger.editBullet(patchBullet[1], b, b.project_id || null)); }
    if (url.pathname === '/api/bullets/recommended' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.generateRecommendedBullets(b.project_id, b.job_description_id, { limit: b.limit || 8, tone: b.tone || 'civilian' })); }

    if (url.pathname === '/api/job-descriptions' && req.method === 'GET') return json(res, 200, await ledger.listJobDescriptions(url.searchParams.get('project_id')));
    if (url.pathname === '/api/job-descriptions' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.createJobDescription(b.project_id, { title: b.title, raw_text: b.raw_text || b.text || '' })); }
    if (url.pathname === '/api/job-match' && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.matchJob(b.project_id, b.job_description_id, { limit: b.limit || 8 })); }

    const exportRun = url.pathname.match(/^\/api\/tailoring-runs\/([^/]+)\/export$/);
    if (exportRun && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.exportResume(exportRun[1], { title: b.title || 'Tailored Resume', format: b.format || 'markdown', jobDescriptionId: b.job_description_id || null })); }
    if (url.pathname === '/api/tailoring-runs' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, { id: b.project_id, project_id: b.project_id, status: 'ready_for_review' }); }
    if (url.pathname.startsWith('/api/tailoring-runs/') && req.method === 'GET') return json(res, 200, { id: url.pathname.split('/').pop(), status: 'ready_for_review' });

    if (url.pathname === '/api/audit-events' && req.method === 'GET') return json(res, 200, await ledger.listAuditEvents(url.searchParams.get('project_id')));
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, { provider: provider.id, model: provider.model, baseUrl: redactUrl(provider.baseUrl), authMode: provider.authMode, privacyMode: providerCatalog().find((item) => item.id === provider.id)?.privacyMode || 'unknown', sendsOffMachine: Boolean(providerCatalog().find((item) => item.id === provider.id)?.sendsOffMachine), apiKey: provider.apiKey ? 'set' : 'not_set', dataDir: ledger.dataDir });
    if (url.pathname === '/api/provider-catalog' && req.method === 'GET') return json(res, 200, providerCatalog());
    if (url.pathname === '/api/settings' && req.method === 'PATCH') return json(res, 200, { ok: true, note: 'Run npm run setup to persist provider settings.' });

    json(res, 404, { error: 'not found' });
  } catch (err) { json(res, 500, { error: err.message }); }
});

server.listen(port, host, () => console.log(`ClaimLedger Studio running at http://${host}:${port}`));

function redactUrl(value) {
  if (!value) return '';
  try { const u = new URL(value); u.username = ''; u.password = ''; return u.toString(); } catch { return value; }
}
