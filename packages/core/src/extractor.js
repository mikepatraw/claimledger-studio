import { makeId, nowIso, validateProviderExtraction } from './schema.js';

const ACTION_RE = /\b(led|built|managed|implemented|reduced|increased|trained|secured|automated|created|coordinated|improved|deployed|analyzed|maintained)\b/i;
const METRIC_RE = /\b(\d+[\w%$.-]*|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i;
const TOOL_RE = /\b(Python|JavaScript|TypeScript|SQL|Linux|React|Node|AWS|Azure|Kubernetes|Docker|Splunk|GitHub|Excel)\b/i;

export function segmentEvidence(sourceDocument) {
  const text = sourceDocument.text_content || '';
  const chunks = [];
  const regex = /[^\n.!?•-][^\n.!?]*(?:[.!?]|$)/g;
  let match;
  while ((match = regex.exec(text))) {
    const quote = match[0].trim().replace(/^[-•]\s*/, '');
    if (quote.length < 12) continue;
    chunks.push({
      id: makeId('ev'),
      source_document_id: sourceDocument.id,
      start_char: match.index,
      end_char: match.index + match[0].length,
      quote,
      label: classifySpan(quote),
      created_by: 'heuristic',
      created_at: nowIso()
    });
  }
  return chunks;
}

function classifySpan(text) {
  if (METRIC_RE.test(text)) return 'metric';
  if (TOOL_RE.test(text)) return 'tool';
  if (ACTION_RE.test(text)) return 'achievement';
  return 'context';
}

export function extractHeuristicClaims(projectId, evidenceSpans) {
  const claims = [];
  const seen = new Set();
  for (const span of evidenceSpans) {
    const quote = span.quote.trim();
    if (!ACTION_RE.test(quote) && !METRIC_RE.test(quote) && !TOOL_RE.test(quote)) continue;
    const normalized = quote.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    const claimType = TOOL_RE.test(quote) && !ACTION_RE.test(quote) ? 'tool' : METRIC_RE.test(quote) ? 'achievement' : 'responsibility';
    const evidenceScore = Math.min(1, 0.6 + (METRIC_RE.test(quote) ? 0.25 : 0) + (ACTION_RE.test(quote) ? 0.15 : 0));
    claims.push({
      id: makeId('cl'),
      project_id: projectId,
      claim_text: quote.replace(/\.$/, ''),
      claim_type: claimType,
      status: 'needs_review',
      confidence: evidenceScore,
      evidence_score: evidenceScore,
      source: 'heuristic',
      evidence_span_ids: [span.id],
      manual_evidence_note: '',
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }
  return claims;
}

export function normalizeProviderClaims(projectId, providerOutput, evidenceSpans) {
  const spanIds = new Set(evidenceSpans.map((span) => span.id));
  const validation = validateProviderExtraction(providerOutput, spanIds);
  if (!validation.valid) {
    const err = new Error(`provider output rejected: ${validation.errors.join('; ')}`);
    err.validationErrors = validation.errors;
    throw err;
  }
  return providerOutput.claims.map((claim) => ({
    id: makeId('cl'),
    project_id: projectId,
    claim_text: claim.claim_text,
    claim_type: claim.claim_type,
    status: 'needs_review',
    confidence: claim.confidence ?? null,
    evidence_score: (claim.supporting_span_ids || []).length > 0 ? 0.85 : 0,
    source: 'ai',
    evidence_span_ids: claim.supporting_span_ids || [],
    manual_evidence_note: '',
    created_at: nowIso(),
    updated_at: nowIso()
  }));
}
