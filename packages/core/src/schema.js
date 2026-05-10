export const CLAIM_STATUSES = ['needs_review', 'approved', 'edited', 'declined', 'draft_unverified'];
export const CLAIM_TYPES = ['achievement', 'skill', 'scope', 'credential', 'tool', 'domain', 'responsibility', 'metric', 'other'];
export const CLAIM_SOURCES = ['heuristic', 'ai', 'user'];

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function validateClaim(claim) {
  if (!claim || typeof claim !== 'object') throw new Error('claim is required');
  if (!claim.claim_text || typeof claim.claim_text !== 'string') throw new Error('claim_text is required');
  if (!CLAIM_TYPES.includes(claim.claim_type)) throw new Error(`invalid claim_type: ${claim.claim_type}`);
  if (!CLAIM_STATUSES.includes(claim.status)) throw new Error(`invalid status: ${claim.status}`);
  if (!CLAIM_SOURCES.includes(claim.source)) throw new Error(`invalid source: ${claim.source}`);
  const evidenceIds = claim.evidence_span_ids ?? [];
  if (!Array.isArray(evidenceIds)) throw new Error('evidence_span_ids must be an array');
  if (claim.source !== 'user' && claim.status !== 'draft_unverified' && evidenceIds.length === 0) {
    throw new Error('extracted claims require at least one evidence span');
  }
  if (claim.status === 'approved' && evidenceIds.length === 0 && !String(claim.manual_evidence_note || '').trim()) {
    throw new Error('approved unverified claims require a manual evidence note');
  }
  return true;
}

export function validateProviderExtraction(output, availableSpanIds) {
  const errors = [];
  if (!output || !Array.isArray(output.claims)) {
    return { valid: false, errors: ['provider output must include claims array'] };
  }
  for (const [index, claim] of output.claims.entries()) {
    for (const spanId of claim.supporting_span_ids || []) {
      if (!availableSpanIds.has(spanId)) errors.push(`claim ${index} references unknown evidence span ${spanId}`);
    }
    if (!claim.claim_text) errors.push(`claim ${index} missing claim_text`);
    if (!CLAIM_TYPES.includes(claim.claim_type)) errors.push(`claim ${index} has invalid claim_type ${claim.claim_type}`);
  }
  return { valid: errors.length === 0, errors };
}

export function providerCatalog() {
  return [
    { id: 'ollama', displayName: 'Ollama/local model', privacyMode: 'local', requiredFields: ['model'], sendsOffMachine: false },
    { id: 'openai-compatible', displayName: 'OpenAI-compatible API endpoint', privacyMode: 'remote_api', requiredFields: ['baseUrl', 'apiKey', 'model'], sendsOffMachine: true },
    { id: 'anthropic', displayName: 'Anthropic API', privacyMode: 'remote_api', requiredFields: ['apiKey', 'model'], sendsOffMachine: true },
    { id: 'heuristic-only', displayName: 'Heuristic extraction only', privacyMode: 'heuristic_only', requiredFields: [], sendsOffMachine: false }
  ];
}
