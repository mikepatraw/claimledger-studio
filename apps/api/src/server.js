import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaimLedger } from '../../../packages/core/src/ledger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const studioDir = path.join(root, 'apps/studio/src');
const port = Number(process.env.PORT || 4173);
const ledger = new ClaimLedger({ dataDir: process.env.CLAIMLEDGER_DATA_DIR || path.join(root, '.local') });
await ledger.init();

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw);
}
function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  res.end(JSON.stringify(value, null, 2));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/health') return json(res, 200, { ok: true, app: 'claimledger-studio' });
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(await readFile(path.join(studioDir, 'index.html'), 'utf8'));
    }
    if (url.pathname === '/app.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      return res.end(await readFile(path.join(studioDir, 'app.js'), 'utf8'));
    }
    if (url.pathname === '/api/projects' && req.method === 'GET') return json(res, 200, (await ledger.dump()).projects);
    if (url.pathname === '/api/projects' && req.method === 'POST') return json(res, 201, await ledger.createProject((await parseBody(req)).name || 'Local Project'));
    if (url.pathname === '/api/source-documents' && req.method === 'GET') return json(res, 200, await ledger.listSourceDocuments(url.searchParams.get('project_id')));
    if (url.pathname === '/api/source-documents' && req.method === 'POST') {
      const body = await parseBody(req);
      return json(res, 201, await ledger.ingestSourceDocument(body.project_id, { kind: body.kind, filename: body.filename, text: body.text }));
    }
    if (url.pathname.startsWith('/api/source-documents/') && req.method === 'GET') {
      const id = url.pathname.split('/').pop();
      return json(res, 200, (await ledger.listSourceDocuments()).find((doc) => doc.id === id));
    }
    if (url.pathname === '/api/evidence-spans' && req.method === 'GET') return json(res, 200, await ledger.listEvidenceSpans(url.searchParams.get('source_document_id')));
    if (url.pathname === '/api/claims' && req.method === 'GET') return json(res, 200, await ledger.listClaims(url.searchParams.get('project_id')));
    if (url.pathname === '/api/claims' && req.method === 'POST') return json(res, 201, await ledger.extractClaims((await parseBody(req)).project_id));
    const approveClaim = url.pathname.match(/^\/api\/claims\/([^/]+)\/approve$/);
    if (approveClaim && req.method === 'POST') return json(res, 200, await ledger.approveClaim(approveClaim[1], (await parseBody(req)).manual_evidence_note));
    const declineClaim = url.pathname.match(/^\/api\/claims\/([^/]+)\/decline$/);
    if (declineClaim && req.method === 'POST') return json(res, 200, await ledger.declineClaim(declineClaim[1]));
    const patchClaim = url.pathname.match(/^\/api\/claims\/([^/]+)$/);
    if (patchClaim && req.method === 'PATCH') return json(res, 200, await ledger.editClaim(patchClaim[1], await parseBody(req)));
    if (url.pathname === '/api/claims/bulk' && req.method === 'POST') { const b = await parseBody(req); return json(res, 200, await ledger.bulkClaims(b.ids, b.action)); }
    if (url.pathname === '/api/bullets' && req.method === 'GET') return json(res, 200, await ledger.listBullets(url.searchParams.get('project_id')));
    if (url.pathname === '/api/bullets' && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.generateBullet(b.project_id, b.claim_ids, { tone: b.tone })); }
    const patchBullet = url.pathname.match(/^\/api\/bullets\/([^/]+)$/);
    if (patchBullet && req.method === 'PATCH') return json(res, 200, await ledger.approveBullet(patchBullet[1]));
    const approveBullet = url.pathname.match(/^\/api\/bullets\/([^/]+)\/approve$/);
    if (approveBullet && req.method === 'POST') return json(res, 200, await ledger.approveBullet(approveBullet[1]));
    if (url.pathname === '/api/bullets/bulk' && req.method === 'POST') return json(res, 200, { ok: true });
    const exportRun = url.pathname.match(/^\/api\/tailoring-runs\/([^/]+)\/export$/);
    if (exportRun && req.method === 'POST') { const b = await parseBody(req); return json(res, 201, await ledger.exportMarkdown(exportRun[1], { title: b.title || 'Tailored Resume' })); }
    if (url.pathname === '/api/job-descriptions' && req.method === 'GET') return json(res, 200, (await ledger.dump()).job_descriptions);
    if (url.pathname === '/api/job-descriptions' && req.method === 'POST') return json(res, 201, { ok: true, requirements: String((await parseBody(req)).raw_text || '').match(/\b[A-Z][A-Za-z+#.]+\b/g) || [] });
    if (url.pathname === '/api/tailoring-runs' && req.method === 'POST') return json(res, 201, { id: 'run-local', status: 'ready_for_review' });
    if (url.pathname.startsWith('/api/tailoring-runs/') && req.method === 'GET') return json(res, 200, { id: url.pathname.split('/').pop(), status: 'ready_for_review' });
    if (url.pathname === '/api/audit-events' && req.method === 'GET') return json(res, 200, await ledger.listAuditEvents(url.searchParams.get('project_id')));
    if (url.pathname === '/api/settings' && req.method === 'GET') return json(res, 200, { provider: process.env.CLAIMLEDGER_PROVIDER || 'heuristic-only', privacyMode: process.env.CLAIMLEDGER_PRIVACY_MODE || 'heuristic_only', apiKey: process.env.CLAIMLEDGER_API_KEY ? 'set' : 'not_set' });
    if (url.pathname === '/api/settings' && req.method === 'PATCH') return json(res, 200, { ok: true, note: 'Run npm run setup to persist provider settings.' });
    json(res, 404, { error: 'not found' });
  } catch (err) { json(res, 500, { error: err.message }); }
});

server.listen(port, () => console.log(`ClaimLedger Studio running at http://localhost:${port}`));
