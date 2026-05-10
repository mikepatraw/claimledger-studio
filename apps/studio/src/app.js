let projectId = localStorage.getItem('claimledger.projectId') || '';
let currentClaims = [];
let currentBullets = [];
let currentJobs = [];
const selectedClaimIds = new Set();
const selectedBulletIds = new Set();
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}
function setStatus(message, error = false) { $('status').textContent = message; $('status').className = error ? 'error' : 'small'; }
function setProject(id) { projectId = id; localStorage.setItem('claimledger.projectId', id); $('current').textContent = `Current project: ${id}`; }

async function refresh() {
  await refreshSettings();
  if (!projectId) return;
  const [claims, bullets, jobs, spans, audit] = await Promise.all([
    api(`/api/claims?project_id=${projectId}`),
    api(`/api/bullets?project_id=${projectId}`),
    api(`/api/job-descriptions?project_id=${projectId}`),
    api(`/api/evidence-spans?project_id=${projectId}`),
    api(`/api/audit-events?project_id=${projectId}`)
  ]);
  currentClaims = claims;
  currentBullets = bullets;
  currentJobs = jobs;
  selectedClaimIds.forEach((id) => { if (!claims.some((claim) => claim.id === id)) selectedClaimIds.delete(id); });
  selectedBulletIds.forEach((id) => { if (!bullets.some((bullet) => bullet.id === id)) selectedBulletIds.delete(id); });
  $('claims').innerHTML = claims.map((claim) => claimRow(claim, spans)).join('');
  $('bullets').innerHTML = bullets.map((bullet) => bulletRow(bullet)).join('');
  $('jobSelect').innerHTML = jobs.map((job) => `<option value="${job.id}">${escapeHtml(job.title)} (${job.requirements.length} reqs)</option>`).join('');
  updateSelectionCount();
  $('audit').innerHTML = audit.slice(-18).reverse().map((event) => `${event.created_at} · ${event.event_type} · ${event.entity_type}:${event.entity_id}`).join('<br>');
}
async function refreshSettings() {
  const settings = await api('/api/settings');
  $('settings').innerHTML = `Provider: <b>${escapeHtml(settings.provider)}</b> · Model: ${escapeHtml(settings.model || '')} · Auth: ${escapeHtml(settings.authMode || '')}/${settings.apiKey} · Sends off-machine: <b>${settings.sendsOffMachine ? 'yes' : 'no'}</b> · Data: ${escapeHtml(settings.dataDir || '')}`;
}

function claimRow(claim, spans) {
  const evidence = claim.evidence_span_ids.map((id) => escapeHtml(spans.find((span) => span.id === id)?.quote || id)).join('<hr>');
  const checked = selectedClaimIds.has(claim.id) ? 'checked' : '';
  return `<tr><td><input type="checkbox" aria-label="Select claim" onchange="toggleClaim('${claim.id}', this.checked)" ${checked}></td><td class="status ${claim.status}">${claim.status}</td><td>${escapeHtml(claim.claim_text)}</td><td>${claim.claim_type}<br><span class="small">score ${Number(claim.evidence_score).toFixed(2)} · ${claim.source}</span></td><td>${evidence}</td><td><button class="ok" onclick="approve('${claim.id}')">Approve</button> <button onclick="editClaim('${claim.id}')">Edit</button> <button class="danger" onclick="decline('${claim.id}')">Decline</button></td></tr>`;
}
function bulletRow(bullet) {
  const checked = selectedBulletIds.has(bullet.id) ? 'checked' : '';
  return `<tr><td><input type="checkbox" aria-label="Select bullet" onchange="toggleBullet('${bullet.id}', this.checked)" ${checked}></td><td class="status ${bullet.status}">${bullet.status}</td><td>${escapeHtml(bullet.bullet_text)}</td><td>${escapeHtml(bullet.tone || '')}<br><span class="small">${bullet.claim_ids.length} linked claim(s)</span></td><td><button class="ok" onclick="approveBullet('${bullet.id}')">Approve</button> <button onclick="editBullet('${bullet.id}')">Edit</button> <button class="danger" onclick="declineBullet('${bullet.id}')">Decline</button></td></tr>`;
}
function updateSelectionCount() { $('selectionCount').textContent = `${selectedClaimIds.size} claim(s) selected`; $('bulletSelectionCount').textContent = `${selectedBulletIds.size} bullet(s) selected`; }

$('ingest').onclick = async () => {
  try {
    const project = projectId ? { id: projectId } : await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: $('project').value || 'Local Project' }) });
    setProject(project.id);
    const file = $('file').files[0];
    let payload = { project_id: project.id, kind: $('kind').value, filename: $('filename').value || 'pasted-source.md', text: $('source').value };
    if (file) payload = { project_id: project.id, kind: $('kind').value, filename: file.name, mime_type: file.type, content_base64: await fileToBase64(file) };
    await api('/api/source-documents', { method: 'POST', body: JSON.stringify(payload) });
    setStatus('Source ingested. Extract claims next, or review imported approved bullets.');
    await refresh();
  } catch (err) { setStatus(err.message, true); }
};
$('extract').onclick = async () => { try { await api('/api/claims', { method: 'POST', body: JSON.stringify({ project_id: projectId, allow_provider_fallback: $('allowFallback').checked }) }); setStatus('Claims extracted. Review and approve/edit/decline.'); await refresh(); } catch (err) { setStatus(err.message, true); } };
$('selectPending').onclick = () => { selectedClaimIds.clear(); currentClaims.filter((claim) => ['needs_review', 'draft_unverified', 'edited'].includes(claim.status)).forEach((claim) => selectedClaimIds.add(claim.id)); refresh(); };
$('bulkApprove').onclick = async () => bulkReview('approve');
$('bulkDecline').onclick = async () => bulkReview('decline');

window.toggleClaim = (id, selected) => { selected ? selectedClaimIds.add(id) : selectedClaimIds.delete(id); updateSelectionCount(); };
window.approve = async (id) => { await api(`/api/claims/${id}/approve`, { method: 'POST', body: JSON.stringify({ manual_evidence_note: $('bulkNote').value }) }); await refresh(); };
window.decline = async (id) => { await api(`/api/claims/${id}/decline`, { method: 'POST', body: '{}' }); await refresh(); };
window.editClaim = async (id) => {
  const existing = currentClaims.find((claim) => claim.id === id)?.claim_text || '';
  const claim_text = prompt('Edit claim text', existing);
  if (claim_text) { await api(`/api/claims/${id}`, { method: 'PATCH', body: JSON.stringify({ claim_text }) }); await refresh(); }
};
async function bulkReview(action) { const ids = [...selectedClaimIds]; if (!ids.length) return alert('Select claims first.'); await api('/api/claims/bulk', { method: 'POST', body: JSON.stringify({ ids, action, note: $('bulkNote').value }) }); selectedClaimIds.clear(); await refresh(); }

$('saveJob').onclick = async () => { try { const job = await api('/api/job-descriptions', { method: 'POST', body: JSON.stringify({ project_id: projectId, title: $('jobTitle').value || 'Target Role', raw_text: $('job').value }) }); setStatus(`Saved job description: ${job.title}`); await refresh(); } catch (err) { setStatus(err.message, true); } };
$('matchJob').onclick = async () => { try { const jobId = $('jobSelect').value; const matches = await api('/api/job-match', { method: 'POST', body: JSON.stringify({ project_id: projectId, job_description_id: jobId }) }); $('matchResult').textContent = JSON.stringify(matches, null, 2); } catch (err) { setStatus(err.message, true); } };
$('generate').onclick = async () => {
  try {
    const jobId = $('jobSelect').value || null;
    const claims = selectedClaimIds.size ? [...selectedClaimIds] : currentClaims.filter((claim) => claim.status === 'approved').slice(0, 5).map((claim) => claim.id);
    if (!claims.length) return alert('Approve or select at least one claim first.');
    for (const id of claims) await api('/api/bullets', { method: 'POST', body: JSON.stringify({ project_id: projectId, claim_ids: [id], tone: $('tone').value, job_description_id: jobId }) });
    setStatus('Bullet drafts generated. Review/approve bullets before export.');
    await refresh();
  } catch (err) { setStatus(err.message, true); }
};
$('generateRecommended').onclick = async () => { try { await api('/api/bullets/recommended', { method: 'POST', body: JSON.stringify({ project_id: projectId, job_description_id: $('jobSelect').value, tone: $('tone').value }) }); setStatus('Recommended bullets generated from JD matches.'); await refresh(); } catch (err) { setStatus(err.message, true); } };

window.toggleBullet = (id, selected) => { selected ? selectedBulletIds.add(id) : selectedBulletIds.delete(id); updateSelectionCount(); };
window.approveBullet = async (id) => { await api(`/api/bullets/${id}/approve`, { method: 'POST', body: '{}' }); await refresh(); };
window.declineBullet = async (id) => { await api(`/api/bullets/${id}/decline`, { method: 'POST', body: '{}' }); await refresh(); };
window.editBullet = async (id) => { const existing = currentBullets.find((bullet) => bullet.id === id)?.bullet_text || ''; const bullet_text = prompt('Edit bullet text', existing); if (bullet_text) { await api(`/api/bullets/${id}`, { method: 'PATCH', body: JSON.stringify({ bullet_text }) }); await refresh(); } };
$('approveSelectedBullets').onclick = async () => { for (const id of selectedBulletIds) await api(`/api/bullets/${id}/approve`, { method: 'POST', body: '{}' }); selectedBulletIds.clear(); await refresh(); };

$('export').onclick = async () => { try { const out = await api(`/api/tailoring-runs/${projectId}/export`, { method: 'POST', body: JSON.stringify({ title: $('exportTitle').value || 'Tailored Resume', format: $('format').value, job_description_id: $('jobSelect').value || null }) }); $('exportResult').textContent = JSON.stringify(out, null, 2); setStatus(`Export created: ${out.output_path}`); await refresh(); } catch (err) { setStatus(err.message, true); } };

function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
if (projectId) setProject(projectId);
refresh().catch((err) => setStatus(err.message, true));
