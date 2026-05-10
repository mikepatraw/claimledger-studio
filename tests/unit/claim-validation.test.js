import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClaim, validateProviderExtraction } from '../../packages/core/src/schema.js';

test('validateClaim requires evidence for extracted non-manual claims', () => {
  assert.throws(() => validateClaim({ claim_text: 'Built 4 dashboards', claim_type: 'achievement', status: 'needs_review', source: 'heuristic', evidence_span_ids: [] }), /evidence/);
});

test('validateProviderExtraction rejects missing evidence span ids', () => {
  const result = validateProviderExtraction({ claims: [{ claim_text: 'Managed 12 systems', claim_type: 'scope', supporting_span_ids: ['span-missing'], confidence: 0.8 }] }, new Set(['span-1']));
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /span-missing/);
});

test('draft_unverified can be approved only with manual evidence note', () => {
  assert.throws(() => validateClaim({ claim_text: 'Unverified claim', claim_type: 'other', status: 'approved', source: 'user', evidence_span_ids: [], manual_evidence_note: '' }), /manual evidence note/);
  assert.doesNotThrow(() => validateClaim({ claim_text: 'Unverified claim', claim_type: 'other', status: 'approved', source: 'user', evidence_span_ids: [], manual_evidence_note: 'User attests this came from a private offline record.' }));
});
