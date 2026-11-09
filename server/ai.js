// ---------------------------------------------------------------------------
// AI provider gateway.
//
// One neutral message format, adapted to each supported provider:
//   OpenAI-compatible (OpenAI, Azure, Groq, OpenRouter, local, …)
//   Google Gemini
//   Anthropic Claude
//
// Every credential stays server-side. The browser never sees a key.
// ---------------------------------------------------------------------------

export const PROVIDERS = [
  { key: 'openai', label: 'OpenAI', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { key: 'gemini', label: 'Google Gemini', base_url: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-1.5-flash' },
  { key: 'anthropic', label: 'Anthropic Claude', base_url: 'https://api.anthropic.com/v1', model: 'claude-3-5-sonnet-latest' },
  { key: 'custom', label: 'Custom / OpenAI-compatible', base_url: '', model: '' },
];

export function providerLabel(key) {
  return PROVIDERS.find((p) => p.key === key)?.label || key || 'Unknown';
}

export function normalizeConfig(config) {
  if (!config) return null;
  const provider = String(config.provider || 'openai').toLowerCase();
  const fallback = PROVIDERS.find((p) => p.key === provider) || PROVIDERS[0];
  return {
    id: config.id || null,
    provider,
    name: config.name || providerLabel(provider),
    baseUrl: String(config.base_url || config.baseUrl || fallback.base_url || '').replace(/\/+$/, ''),
    apiKey: config.api_key || config.apiKey || '',
    model: config.model || fallback.model,
    apiVersion: config.api_version || config.apiVersion || '',
    orgId: config.org_id || config.orgId || '',
    extraHeaders: parseHeaders(config.extra_headers || config.extraHeaders),
    maxTokens: Number(config.max_tokens || config.maxTokens || 0) || null,
    temperature: config.temperature === null || config.temperature === undefined
      ? null : Number(config.temperature),
    timeoutMs: Math.max(3000, Number(config.timeout_ms || config.timeoutMs || 45000)),
  };
}

function parseHeaders(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function requestInit(cfg, url, body, extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...cfg.extraHeaders, ...extra };
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  };
}

function friendlyError(status, bodyText) {
  let detail = '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.error?.message || parsed?.message || parsed?.error || '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    detail = String(bodyText || '').slice(0, 300);
  }
  if (status === 401 || status === 403) return { status: 'invalid_key', message: `Invalid API key (HTTP ${status}). ${detail}`.trim() };
  if (status === 404) return { status: 'invalid_url', message: `API URL or model not found (HTTP 404). ${detail}`.trim() };
  if (status === 429) return { status: 'rate_limited', message: `Rate limit exceeded (HTTP 429). ${detail}`.trim() };
  if (status >= 500) return { status: 'provider_error', message: `Provider error (HTTP ${status}). ${detail}`.trim() };
  return { status: 'provider_error', message: `Request failed (HTTP ${status}). ${detail}`.trim() };
}

// ------------------------------ OpenAI -------------------------------------

function openAiPayload(cfg, { messages, tools, temperature, maxTokens }) {
  const out = messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: String(m.content ?? '') };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
        })),
      };
    }
    return { role: m.role, content: String(m.content ?? '') };
  });
  const body = {
    model: cfg.model,
    messages: out,
    temperature: temperature ?? cfg.temperature ?? 0.2,
  };
  const max = maxTokens || cfg.maxTokens;
  if (max) body.max_tokens = max;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = 'auto';
  }
  return body;
}

async function callOpenAi(cfg, opts) {
  const url = `${cfg.baseUrl || 'https://api.openai.com/v1'}/chat/completions`;
  const extra = { Authorization: `Bearer ${cfg.apiKey}` };
  if (cfg.orgId) extra['OpenAI-Organization'] = cfg.orgId;
  const res = await fetch(url, requestInit(cfg, url, openAiPayload(cfg, opts), extra));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: friendlyError(res.status, text) };
  }
  const data = await res.json();
  const message = data?.choices?.[0]?.message || {};
  return {
    text: message.content || '',
    toolCalls: (message.tool_calls || []).map((c) => {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || '{}'); } catch { args = {}; }
      return { id: c.id, name: c.function?.name, args };
    }),
    usage: data?.usage || null,
  };
}

// ------------------------------ Gemini -------------------------------------

function geminiPayload(cfg, { messages, tools, temperature, maxTokens }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const contents = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name || 'tool', response: { result: String(m.content ?? '') } } }],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const parts = [];
      if (m.content) parts.push({ text: String(m.content) });
      for (const c of m.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.args || {} } });
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }
    contents.push({ role: 'user', parts: [{ text: String(m.content ?? '') }] });
  }
  const body = {
    contents,
    generationConfig: {
      temperature: temperature ?? cfg.temperature ?? 0.2,
      ...(maxTokens || cfg.maxTokens ? { maxOutputTokens: maxTokens || cfg.maxTokens } : {}),
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.name, description: t.description, parameters: t.parameters,
      })),
    }];
  }
  return body;
}

async function callGemini(cfg, opts) {
  const base = cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  const version = cfg.apiVersion && !base.includes('/v1') ? `/${cfg.apiVersion}` : '';
  const url = `${base}${version}/models/${cfg.model}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await fetch(url, requestInit(cfg, url, geminiPayload(cfg, opts)));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: friendlyError(res.status, text) };
  }
  const data = await res.json();
  if (data?.promptFeedback?.blockReason) {
    return { error: { status: 'blocked', message: `Provider blocked the request: ${data.promptFeedback.blockReason}.` } };
  }
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.filter((p) => p.text).map((p) => p.text).join('\n');
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `gemini_${Date.now()}_${i}`, name: p.functionCall.name, args: p.functionCall.args || {} }));
  return { text, toolCalls, usage: data?.usageMetadata || null };
}

// ----------------------------- Anthropic -----------------------------------

function anthropicPayload(cfg, { messages, tools, temperature, maxTokens }) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const converted = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = {
        type: 'tool_result',
        tool_use_id: m.toolCallId,
        content: String(m.content ?? ''),
      };
      const last = converted[converted.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) last.content.push(block);
      else converted.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant') {
      const blocks = [];
      if (m.content) blocks.push({ type: 'text', text: String(m.content) });
      for (const c of m.toolCalls || []) {
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args || {} });
      }
      if (blocks.length) converted.push({ role: 'assistant', content: blocks });
      continue;
    }
    converted.push({ role: 'user', content: String(m.content ?? '') });
  }
  const body = {
    model: cfg.model,
    max_tokens: maxTokens || cfg.maxTokens || 1024,
    temperature: temperature ?? cfg.temperature ?? 0.2,
    messages: converted,
  };
  if (system) body.system = system;
  if (tools?.length) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters || { type: 'object', properties: {} },
    }));
  }
  return body;
}

async function callAnthropic(cfg, opts) {
  const url = `${cfg.baseUrl || 'https://api.anthropic.com/v1'}/messages`;
  const res = await fetch(url, requestInit(cfg, url, anthropicPayload(cfg, opts), {
    'x-api-key': cfg.apiKey,
    'anthropic-version': cfg.apiVersion || '2023-06-01',
  }));
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { error: friendlyError(res.status, text) };
  }
  const data = await res.json();
  const blocks = data?.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const toolCalls = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, args: b.input || {} }));
  return { text, toolCalls, usage: data?.usage || null };
}

// ------------------------------ public API ---------------------------------

/** One completion turn against the configured provider. */
export async function providerChat(config, opts) {
  const cfg = normalizeConfig(config);
  if (!cfg) return { error: { status: 'not_configured', message: 'No AI provider has been configured.' } };
  if (!cfg.apiKey) return { error: { status: 'missing_key', message: 'No API key is stored for this provider.' } };
  try {
    if (cfg.provider === 'gemini') return await callGemini(cfg, opts);
    if (cfg.provider === 'anthropic') return await callAnthropic(cfg, opts);
    return await callOpenAi(cfg, opts);
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      return { error: { status: 'timeout', message: 'The provider did not respond before the timeout.' } };
    }
    return { error: { status: 'network', message: `Could not reach the provider: ${e.message}` } };
  }
}

/** Safe connection test — one short prompt, no tools. */
export async function testProvider(config) {
  const started = Date.now();
  const result = await providerChat(config, {
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    tools: [],
    temperature: 0,
    maxTokens: 16,
  });
  const elapsed = Date.now() - started;
  if (result.error) {
    return { ok: false, status: result.error.status, message: result.error.message, elapsed_ms: elapsed };
  }
  const reply = String(result.text || '').trim();
  if (!reply) {
    return { ok: false, status: 'empty', message: 'The provider responded but returned no text.', elapsed_ms: elapsed };
  }
  return { ok: true, status: 'connected', message: `Connected — provider replied: “${reply.slice(0, 80)}”`, elapsed_ms: elapsed };
}
