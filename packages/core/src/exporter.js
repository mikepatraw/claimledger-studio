import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const RESUME_SECTION_ORDER = ['Summary', 'Skills', 'Experience', 'Leadership', 'Projects'];
const RESUME_SECTION_SET = new Set(RESUME_SECTION_ORDER.map((section) => section.toLowerCase()));

export function assertExportable({ bullets, claims }) {
  if (!bullets.length) throw new Error('export requires at least one approved bullet');
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

export function applyResumeSections(bullets, claims) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  return bullets.map((bullet) => {
    const linkedClaims = (bullet.claim_ids || []).map((id) => claimById.get(id)).filter(Boolean);
    return { ...bullet, target_section: normalizeResumeSection(bullet.target_section) || deriveResumeSection(bullet, linkedClaims) };
  });
}

export function buildAuditManifest({ bullets, claims, jobDescription = null, matches = [] }) {
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));
  const jobMatch = Array.isArray(matches) ? { matches, skill_gaps: [] } : matches;
  return {
    generated_at: new Date().toISOString(),
    job_description_id: jobDescription?.id || null,
    requirements: jobDescription?.requirements || [],
    matches: jobMatch.matches || [],
    skill_gaps: jobMatch.skill_gaps || [],
    bullets: bullets.map((bullet) => {
      const linkedClaims = (bullet.claim_ids || []).map((id) => claimById.get(id)).filter(Boolean);
      return {
        bullet_id: bullet.id,
        target_section: normalizeResumeSection(bullet.target_section) || deriveResumeSection(bullet, linkedClaims),
        claim_ids: linkedClaims.map((claim) => claim.id),
        evidence_span_ids: [...new Set(linkedClaims.flatMap((claim) => claim.evidence_span_ids || []))]
      };
    })
  };
}

export function renderMarkdownResume({ title, bullets, manifest }) {
  const lines = [`# ${title}`, '', '> Generated locally by ClaimLedger Studio from approved evidence-backed claims.', ''];
  for (const [section, sectionBullets] of groupBulletsBySection(bullets)) {
    lines.push(`## ${section}`, '');
    for (const bullet of sectionBullets) lines.push(`- ${bullet.bullet_text} <!-- bullet:${bullet.id} -->`);
    lines.push('');
  }
  lines.push('', '## Internal audit manifest', '', '```json', JSON.stringify(manifest, null, 2), '```', '');
  return lines.join('\n');
}

export async function writeDocxResume(outputPath, { title, bullets, manifest }) {
  const payload = JSON.stringify({ title, sections: groupBulletsBySection(bullets).map(([name, items]) => ({ name, bullets: items.map((b) => ({ id: b.id, text: b.bullet_text })) })), manifest });
  const script = String.raw`
import html, json, sys, zipfile
out=sys.argv[1]
data=json.loads(sys.stdin.read())
def p(text, style=None):
    text=html.escape(text or '')
    st=f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ''
    return f'<w:p>{st}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
paras=[p(data.get('title','Tailored Resume'), 'Title')]
paras.append(p('Generated locally by ClaimLedger Studio from approved evidence-backed claims.'))
for section in data.get('sections', []):
    paras.append(p(section.get('name', 'Experience'), 'Heading1'))
    for bullet in section.get('bullets', []):
        paras.append(p('• ' + bullet.get('text', '')))
paras.append(p('Internal audit manifest', 'Heading1'))
paras.append(p(json.dumps(data.get('manifest', {}), indent=2)))
doc='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+''.join(paras)+'<w:sectPr/></w:body></w:document>'
content_types='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
rels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
styles='<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', content_types)
    z.writestr('_rels/.rels', rels)
    z.writestr('word/document.xml', doc)
    z.writestr('word/styles.xml', styles)
`;
  const result = spawnSync('python3', ['-c', script, outputPath], { input: payload, encoding: 'utf8', timeout: 15_000 });
  if (result.status !== 0) throw new Error(`docx export failed: ${result.stderr || result.stdout}`);
  return outputPath;
}

export async function writeMarkdownResume(outputPath, args) {
  await writeFile(outputPath, renderMarkdownResume(args));
  return outputPath;
}

function normalizeResumeSection(section) {
  const raw = String(section || '').trim();
  if (!raw) return null;
  const compact = raw.toLowerCase().replace(/[^a-z]/g, '');
  const aliases = new Map([
    ['professionalsummary', 'Summary'],
    ['summary', 'Summary'],
    ['skill', 'Skills'],
    ['skills', 'Skills'],
    ['technicalskills', 'Skills'],
    ['experience', 'Experience'],
    ['workexperience', 'Experience'],
    ['leadership', 'Leadership'],
    ['militaryleadership', 'Leadership'],
    ['project', 'Projects'],
    ['projects', 'Projects'],
    ['selectedprojects', 'Projects']
  ]);
  if (aliases.has(compact)) return aliases.get(compact);
  return RESUME_SECTION_ORDER.find((item) => item.toLowerCase() === raw.toLowerCase()) || null;
}

function deriveResumeSection(bullet, linkedClaims) {
  const text = `${bullet?.bullet_text || ''} ${linkedClaims.map((claim) => `${claim.claim_text} ${claim.claim_type}`).join(' ')}`.toLowerCase();
  if (linkedClaims.some((claim) => ['skill', 'tool', 'credential'].includes(claim.claim_type))) return 'Skills';
  if (/\b(project|dashboard|deployed|built|created|implemented)\b/.test(text)) return 'Projects';
  if (bullet?.tone === 'leadership' || /\b(led|managed|trained|coordinated|mentored|supervised|team)\b/.test(text)) return 'Leadership';
  return 'Experience';
}

function groupBulletsBySection(bullets) {
  const grouped = new Map();
  for (const section of RESUME_SECTION_ORDER) grouped.set(section, []);
  for (const bullet of bullets) {
    const section = normalizeResumeSection(bullet.target_section) || 'Experience';
    if (!RESUME_SECTION_SET.has(section.toLowerCase())) grouped.set(section, []);
    grouped.get(section).push(bullet);
  }
  return [...grouped.entries()].filter(([, items]) => items.length > 0);
}
