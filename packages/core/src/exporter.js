export function assertExportable({ bullets, claims }) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  for (const bullet of bullets) {
    if (bullet.status !== 'approved') throw new Error(`bullet ${bullet.id} is not approved`);
    if (!bullet.claim_ids || bullet.claim_ids.length === 0) throw new Error(`bullet ${bullet.id} has no linked claims`);
    for (const claimId of bullet.claim_ids) {
      const claim = claimById.get(claimId);
      if (!claim) throw new Error(`bullet ${bullet.id} references missing claim ${claimId}`);
      if (claim.status !== 'approved') throw new Error(`bullet ${bullet.id} requires approved claim ${claimId}`);
      const hasEvidence = (claim.evidence_span_ids || []).length > 0;
      if (!hasEvidence && !String(claim.manual_evidence_note || '').trim()) {
        throw new Error(`claim ${claimId} lacks evidence or manual evidence note`);
      }
    }
  }
  return true;
}

export function buildAuditManifest({ bullets, claims }) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  return {
    generated_at: new Date().toISOString(),
    bullets: bullets.map((bullet) => {
      const linkedClaims = (bullet.claim_ids || []).map((id) => claimById.get(id)).filter(Boolean);
      return {
        bullet_id: bullet.id,
        claim_ids: linkedClaims.map((claim) => claim.id),
        evidence_span_ids: [...new Set(linkedClaims.flatMap((claim) => claim.evidence_span_ids || []))]
      };
    })
  };
}

export function renderMarkdownResume({ title, bullets, manifest }) {
  const lines = [`# ${title}`, '', '> Generated locally by ClaimLedger Studio from approved evidence-backed claims.', ''];
  for (const bullet of bullets) lines.push(`- ${bullet.bullet_text} <!-- bullet:${bullet.id} -->`);
  lines.push('', '## Internal audit manifest', '', '```json', JSON.stringify(manifest, null, 2), '```', '');
  return lines.join('\n');
}
