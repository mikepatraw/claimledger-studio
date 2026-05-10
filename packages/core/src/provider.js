import { normalizeProviderClaims } from './extractor.js';

const DEFAULT_TIMEOUT_MS = 45_000;

export function providerFromEnv(env = process.env) {
  const id = env.CLAIMLEDGER_PROVIDER || 'heuristic-only';
  return {
    id,
    model: env.CLAIMLEDGER_MODEL || (id === 'anthropic' ? 'claude-3-5-sonnet-latest' : id === 'ollama' ? 'llama3.1' : 'gpt-4o-mini'),
    baseUrl: env.CLAIMLEDGER_BASE_URL || (id === 'ollama' ? 'http://127.0.0.1:11434' : 'https://api.openai.com/v1'),
    apiKey: env.CLAIMLEDGER_API_KEY || env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY || '',
    authMode: env.CLAIMLEDGER_AUTH_METHOD || env.CLAIMLEDGER_AUTH_MODE || 'api_key',
    timeoutMs: Number(env.CLAIMLEDGER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

export async function extractClaimsWithProvider(projectId, evidenceSpans, provider) {
  if (!provider || provider.id === 'heuristic-only') return null;
  const prompt = buildExtractionPrompt(evidenceSpans);
  let output;
  if (provider.id === 'ollama') output = await callOllama(provider, prompt);
  else if (provider.id === 'openai-compatible') output = await callOpenAICompatible(provider, prompt);
  else if (provider.id === 'anthropic') output = await callAnthropic(provider, prompt);
  else throw new Error(`unsupported provider: ${provider.id}`);
  return normalizeProviderClaims(projectId, parseJsonObject(output), evidenceSpans);
}

function buildExtractionPrompt(evidenceSpans) {
  const spans = evidenceSpans.map((span) => ({ id: span.id, quote: span.quote, label: span.label }));
  return `Extract resume claims from the evidence spans below. Return ONLY JSON with this shape: {"claims":[{"claim_text":"...","claim_type":"achievement|skill|scope|credential|tool|domain|responsibility|metric|other","confidence":0.0,"supporting_span_ids":["ev_..."]}]}. Rules: every claim must be supported by one or more provided span ids; do not invent facts; preserve metrics and tools exactly; split unrelated facts into separate claims. Evidence spans: ${JSON.stringify(spans)}`;
}

async function callOllama(provider, prompt) {
  const endpoint = new URL('/api/generate', provider.baseUrl).toString();
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: provider.model, prompt, stream: false, format: 'json' })
  }, provider.timeoutMs);
  if (!response.ok) throw new Error(`ollama extraction failed: HTTP ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.response || '';
}

async function callOpenAICompatible(provider, prompt) {
  const endpoint = new URL('/chat/completions', provider.baseUrl).toString();
  const headers = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: 'system', content: 'You extract evidence-backed resume claims. Return strict JSON only.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0,
      response_format: { type: 'json_object' }
    })
  }, provider.timeoutMs);
  if (!response.ok) throw new Error(`openai-compatible extraction failed: HTTP ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return payload.choices?.[0]?.message?.content || '';
}

async function callAnthropic(provider, prompt) {
  const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
  if (provider.apiKey) headers['x-api-key'] = provider.apiKey;
  const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 1500,
      temperature: 0,
      system: 'You extract evidence-backed resume claims. Return strict JSON only.',
      messages: [{ role: 'user', content: prompt }]
    })
  }, provider.timeoutMs);
  if (!response.ok) throw new Error(`anthropic extraction failed: HTTP ${response.status} ${await response.text()}`);
  const payload = await response.json();
  return (payload.content || []).map((part) => part.text || '').join('\n');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (err) {
    if (err.name === 'AbortError') throw new Error(`provider request timed out after ${timeoutMs}ms`);
    throw err;
  } finally { clearTimeout(timer); }
}

export function parseJsonObject(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('provider response did not contain JSON');
  return JSON.parse(match[0]);
}
