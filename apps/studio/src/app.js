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
function setProgress(message, state = 'idle', stage = null) {
  const progress = $('operationProgress');
  progress.className = `progress ${state === 'error' ? 'error' : state === 'working' ? 'working' : ''}`.trim();
  progress.innerHTML = `<b>Operation progress</b><br><span>${escapeHtml(message)}</span>`;
  if (stage) setWorkflowStage(stage);
}
function setWorkflowStage(stage) {
  document.querySelectorAll('#workflowStages [data-stage]').forEach((step) => {
    const active = step.dataset.stage === stage;
    if (active) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
}
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
  const sourcePreviewByClaim = new Map(claims.map((claim) => [claim.id, renderClaimEvidencePreview(claim, spans)]));
  $('claims').innerHTML = claims.map((claim) => claimRow(claim, spans)).join('');
  $('bullets').innerHTML = bullets.map((bullet) => bulletRow(bullet, sourcePreviewByClaim)).join('');
  $('jobSelect').innerHTML = jobs.map((job) => `<option value="${job.id}">${escapeHtml(job.title)} (${job.requirements.length} reqs)</option>`).join('');
  updateSelectionCount();
  $('audit').innerHTML = audit.slice(-18).reverse().map((event) => `${event.created_at} · ${event.event_type} · ${event.entity_type}:${event.entity_id}`).join('<br>');
}
async function refreshSettings() {
  const settings = await api('/api/settings');
  $('settings').innerHTML = `Provider: <b>${escapeHtml(settings.provider)}</b> · Model: ${escapeHtml(settings.model || '')} · Auth: ${escapeHtml(settings.authMode || '')}/${settings.apiKey} · Sends off-machine: <b>${settings.sendsOffMachine ? 'yes' : 'no'}</b> · Data: ${escapeHtml(settings.dataDir || '')}`;
}

function claimRow(claim, spans) {
  const evidence = renderClaimEvidencePreview(claim, spans);
  const checked = selectedClaimIds.has(claim.id) ? 'checked' : '';
  return `<tr><td><input type="checkbox" aria-label="Select claim" onchange="toggleClaim('${claim.id}', this.checked)" ${checked}></td><td class="status ${claim.status}">${claim.status}</td><td>${escapeHtml(claim.claim_text)}</td><td>${claim.claim_type}<br><span class="small">score ${Number(claim.evidence_score).toFixed(2)} · ${claim.source}</span></td><td>${evidence}</td><td><button class="ok" onclick="approve('${claim.id}')">Approve</button> <button onclick="editClaim('${claim.id}')">Edit</button> <button class="danger" onclick="decline('${claim.id}')">Decline</button></td></tr>`;
}
function bulletRow(bullet, sourcePreviewByClaim = new Map()) {
  const checked = selectedBulletIds.has(bullet.id) ? 'checked' : '';
  const preview = renderBulletEvidencePreview(bullet, sourcePreviewByClaim);
  return `<tr><td><input type="checkbox" aria-label="Select bullet" onchange="toggleBullet('${bullet.id}', this.checked)" ${checked}></td><td class="status ${bullet.status}">${bullet.status}</td><td>${escapeHtml(bullet.bullet_text)}</td><td>${escapeHtml(bullet.tone || '')}<br><span class="small">${bullet.claim_ids.length} linked claim(s)</span>${preview}</td><td><button class="ok" onclick="approveBullet('${bullet.id}')">Approve</button> <button onclick="editBullet('${bullet.id}')">Edit</button> <button class="danger" onclick="declineBullet('${bullet.id}')">Decline</button></td></tr>`;
}
function renderClaimEvidencePreview(claim, spans) {
  const quotes = claim.evidence_span_ids.map((id) => spans.find((span) => span.id === id)).filter(Boolean);
  if (!quotes.length) return '<span class="small">No linked source evidence yet.</span>';
  const body = quotes.map((span) => `<div class="quote"><b>${escapeHtml(span.source_document_id)}</b><br>${escapeHtml(span.quote)}</div>`).join('');
  return `<details class="evidence-preview" open><summary>Source preview · Project-scoped evidence (${quotes.length})</summary>${body}</details>`;
}
function renderBulletEvidencePreview(bullet, sourcePreviewByClaim) {
  const previews = bullet.claim_ids.map((id) => sourcePreviewByClaim.get(id)).filter(Boolean);
  if (!previews.length) return '<div class="small">No linked source evidence yet.</div>';
  return `<details class="evidence-preview"><summary>Source preview · ${previews.length} linked claim(s)</summary>${previews.join('')}</details>`;
}
function updateSelectionCount() { $('selectionCount').textContent = `${selectedClaimIds.size} claim(s) selected`; $('bulletSelectionCount').textContent = `${selectedBulletIds.size} bullet(s) selected`; }

$('ingest').onclick = async () => {
  try {
    setWorkflowStage('source');
    setProgress('Ingesting source document into the local project...', 'working', 'source');
    const project = projectId ? { id: projectId } : await api('/api/projects', { method: 'POST', body: JSON.stringify({ name: $('project').value || 'Local Project' }) });
    setProject(project.id);
    const file = $('file').files[0];
    let payload = { project_id: project.id, kind: $('kind').value, filename: $('filename').value || 'pasted-source.md', text: $('source').value };
    if (file) payload = { project_id: project.id, kind: $('kind').value, filename: file.name, mime_type: file.type, content_base64: await fileToBase64(file) };
    await api('/api/source-documents', { method: 'POST', body: JSON.stringify(payload) });
    setStatus('Source ingested. Extract claims next, or review imported approved bullets.');
    setProgress('Source ingested locally. Evidence spans are ready for claim extraction.', 'idle', 'claims');
    await refresh();
  } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); }
};
$('extract').onclick = async () => { try { setWorkflowStage('claims'); setProgress('Extracting claims and linking project-scoped evidence...', 'working', 'claims'); await api('/api/claims', { method: 'POST', body: JSON.stringify({ project_id: projectId, allow_provider_fallback: $('allowFallback').checked }) }); setWorkflowStage('review'); setStatus('Claims extracted. Review and approve/edit/decline.'); setProgress('Claims extracted. Inline source previews are available in the ledger.', 'idle', 'review'); await refresh(); } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); } };
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

$('saveJob').onclick = async () => { try { setProgress('Saving target job description locally...', 'working'); const job = await api('/api/job-descriptions', { method: 'POST', body: JSON.stringify({ project_id: projectId, title: $('jobTitle').value || 'Target Role', raw_text: $('job').value }) }); setStatus(`Saved job description: ${job.title}`); setProgress('Job description saved for this project.'); await refresh(); } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); } };
$('matchJob').onclick = async () => { try { setProgress('Matching approved claims against the selected job...', 'working', 'review'); const jobId = $('jobSelect').value; const matchResult = await api('/api/job-match', { method: 'POST', body: JSON.stringify({ project_id: projectId, job_description_id: jobId }) }); $('matchResult').textContent = JSON.stringify(matchResult, null, 2); setProgress(`Matched ${(matchResult.matches || []).length} approved claim(s) to the selected job.`); } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); } };
$('generate').onclick = async () => {
  try {
    setWorkflowStage('bullets');
    setProgress('Generating bullet drafts from approved, traceable claims...', 'working', 'bullets');
    const jobId = $('jobSelect').value || null;
    const claims = selectedClaimIds.size ? [...selectedClaimIds] : currentClaims.filter((claim) => claim.status === 'approved').slice(0, 5).map((claim) => claim.id);
    if (!claims.length) return alert('Approve or select at least one claim first.');
    for (const id of claims) await api('/api/bullets', { method: 'POST', body: JSON.stringify({ project_id: projectId, claim_ids: [id], tone: $('tone').value, job_description_id: jobId }) });
    setStatus('Bullet drafts generated. Review/approve bullets before export.');
    setProgress('Generating bullet drafts complete. Review source previews before approving bullets.', 'idle', 'review');
    await refresh();
  } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); }
};
$('generateRecommended').onclick = async () => { try { setWorkflowStage('bullets'); setProgress('Generating bullet drafts from recommended job matches...', 'working', 'bullets'); await api('/api/bullets/recommended', { method: 'POST', body: JSON.stringify({ project_id: projectId, job_description_id: $('jobSelect').value, tone: $('tone').value }) }); setStatus('Recommended bullets generated from JD matches.'); setProgress('Recommended bullet drafts generated. Review source previews before export.', 'idle', 'review'); await refresh(); } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); } };

window.toggleBullet = (id, selected) => { selected ? selectedBulletIds.add(id) : selectedBulletIds.delete(id); updateSelectionCount(); };
window.approveBullet = async (id) => { await api(`/api/bullets/${id}/approve`, { method: 'POST', body: '{}' }); await refresh(); };
window.declineBullet = async (id) => { await api(`/api/bullets/${id}/decline`, { method: 'POST', body: '{}' }); await refresh(); };
window.editBullet = async (id) => { const existing = currentBullets.find((bullet) => bullet.id === id)?.bullet_text || ''; const bullet_text = prompt('Edit bullet text', existing); if (bullet_text) { await api(`/api/bullets/${id}`, { method: 'PATCH', body: JSON.stringify({ bullet_text }) }); await refresh(); } };
$('approveSelectedBullets').onclick = async () => { for (const id of selectedBulletIds) await api(`/api/bullets/${id}/approve`, { method: 'POST', body: '{}' }); selectedBulletIds.clear(); await refresh(); };

$('export').onclick = async () => { try { setWorkflowStage('export'); setProgress('Exporting approved resume and audit manifest locally...', 'working', 'export'); const out = await api(`/api/tailoring-runs/${projectId}/export`, { method: 'POST', body: JSON.stringify({ title: $('exportTitle').value || 'Tailored Resume', format: $('format').value, job_description_id: $('jobSelect').value || null }) }); $('exportResult').textContent = JSON.stringify(out, null, 2); setStatus(`Export created: ${out.output_path}`); setProgress('Exporting approved resume complete. Output and manifest stayed in the local data directory.', 'idle', 'export'); await refresh(); } catch (err) { setStatus(err.message, true); setProgress(err.message, 'error'); } };

function fileToBase64(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); }); }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
if (projectId) setProject(projectId);
setWorkflowStage('source');
refresh().catch((err) => setStatus(err.message, true));
