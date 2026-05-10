let projectId = localStorage.getItem('claimledger.projectId') || '';
let currentClaims = [];
const selectedClaimIds = new Set();
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function setProject(id) {
  projectId = id;
  localStorage.setItem('claimledger.projectId', id);
  $('current').textContent = `Current project: ${id}`;
}

async function refresh() {
  if (!projectId) return;
  const claims = await api(`/api/claims?project_id=${projectId}`);
  const spans = await api('/api/evidence-spans');
  currentClaims = claims;
  selectedClaimIds.forEach((id) => {
    if (!claims.some((claim) => claim.id === id)) selectedClaimIds.delete(id);
  });
  $('claims').innerHTML = claims.map((claim) => claimRow(claim, spans)).join('');
  updateSelectionCount();
  const audit = await api(`/api/audit-events?project_id=${projectId}`);
  $('audit').innerHTML = audit.slice(-12).reverse().map((event) => `${event.created_at} · ${event.event_type} · ${event.entity_type}:${event.entity_id}`).join('<br>');
}

function claimRow(claim, spans) {
  const evidence = claim.evidence_span_ids.map((id) => escapeHtml(spans.find((span) => span.id === id)?.quote || id)).join('<hr>');
  const checked = selectedClaimIds.has(claim.id) ? 'checked' : '';
  return `<tr><td><input type="checkbox" aria-label="Select claim" onchange="toggleClaim('${claim.id}', this.checked)" ${checked}></td><td class="status ${claim.status}">${claim.status}</td><td>${escapeHtml(claim.claim_text)}</td><td>${claim.claim_type}<br><span class="small">score ${Number(claim.evidence_score).toFixed(2)} · ${claim.source}</span></td><td>${evidence}</td><td><button class="ok" onclick="approve('${claim.id}')">Approve</button> <button onclick="editClaim('${claim.id}')">Edit</button> <button class="danger" onclick="decline('${claim.id}')">Decline</button></td></tr>`;
}

function updateSelectionCount() {
  $('selectionCount').textContent = `${selectedClaimIds.size} selected`;
}

$('ingest').onclick = async () => {
  const project = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: $('project').value }) });
  setProject(project.id);
  await api('/api/source-documents', { method: 'POST', body: JSON.stringify({ project_id: project.id, kind: $('kind').value, filename: $('filename').value, text: $('source').value }) });
  await refresh();
};
$('extract').onclick = async () => { await api('/api/claims', { method: 'POST', body: JSON.stringify({ project_id: projectId }) }); await refresh(); };
$('selectPending').onclick = () => {
  selectedClaimIds.clear();
  currentClaims.filter((claim) => ['needs_review', 'draft_unverified', 'edited'].includes(claim.status)).forEach((claim) => selectedClaimIds.add(claim.id));
  refresh();
};
$('bulkApprove').onclick = async () => bulkReview('approve');
$('bulkDecline').onclick = async () => bulkReview('decline');

window.toggleClaim = (id, selected) => {
  if (selected) selectedClaimIds.add(id);
  else selectedClaimIds.delete(id);
  updateSelectionCount();
};
window.approve = async (id) => { await api(`/api/claims/${id}/approve`, { method: 'POST', body: '{}' }); await refresh(); };
window.decline = async (id) => { await api(`/api/claims/${id}/decline`, { method: 'POST', body: '{}' }); await refresh(); };
window.editClaim = async (id) => {
  const existing = currentClaims.find((claim) => claim.id === id)?.claim_text || '';
  const claim_text = prompt('Edit claim text', existing);
  if (claim_text) { await api(`/api/claims/${id}`, { method: 'PATCH', body: JSON.stringify({ claim_text }) }); await refresh(); }
};

async function bulkReview(action) {
  const ids = [...selectedClaimIds];
  if (!ids.length) return alert('Select claims first.');
  await api('/api/claims/bulk', { method: 'POST', body: JSON.stringify({ ids, action, note: $('bulkNote').value }) });
  selectedClaimIds.clear();
  await refresh();
}

$('generate').onclick = async () => {
  const claims = (await api(`/api/claims?project_id=${projectId}`)).filter((claim) => claim.status === 'approved');
  if (!claims.length) return alert('Approve at least one claim first.');
  const bullet = await api('/api/bullets', { method: 'POST', body: JSON.stringify({ project_id: projectId, claim_ids: [claims[0].id], tone: 'technical' }) });
  await api(`/api/bullets/${bullet.id}`, { method: 'PATCH', body: '{}' });
  alert('Bullet created. Approve it via API in this MVP; integration test covers export gate.');
  await refresh();
};
$('export').onclick = async () => {
  const out = await api(`/api/tailoring-runs/${projectId}/export`, { method: 'POST', body: JSON.stringify({ title: 'Synthetic Target Role' }) });
  $('exportResult').textContent = JSON.stringify(out, null, 2);
  await refresh();
};
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
if (projectId) setProject(projectId);
refresh();
