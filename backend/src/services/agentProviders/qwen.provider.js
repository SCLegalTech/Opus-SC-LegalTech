/**
 * qwen.provider.js
 *
 * Adapter para modelos que corren en Ollama con function calling nativo
 * (Qwen 2.5 family, Llama 3.1+, etc).
 *
 * Ollama expone /api/chat con formato OpenAI-compatible: acepta `tools` y
 * devuelve `message.tool_calls` cuando el modelo decide invocar una función.
 *
 * Este adapter es deliberadamente delgado: traduce desde/hacia el formato
 * canónico del agentLoop (OpenAI-style) y nada más. El loop es quien orquesta
 * iteraciones, valida nombres de tools y conversa con el MCP.
 */

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://host.docker.internal:11434';
// IMPORTANTE: NO heredar OLLAMA_MODEL legacy (apunta al runtime litert viejo,
// modelo que puede no estar descargado). Si OLLAMA_AGENT_MODEL no está seteado,
// caemos a qwen2.5:3b que es el sweet spot fiable para function calling local.
const DEFAULT_MODEL    = process.env.OLLAMA_AGENT_MODEL || 'qwen2.5:3b';
const DEFAULT_NUM_CTX  = parseInt(process.env.OLLAMA_AGENT_NUM_CTX  || '3072', 10);
const DEFAULT_TIMEOUT  = parseInt(process.env.OLLAMA_AGENT_TIMEOUT_MS || '300000', 10);
// keep_alive mantiene el modelo cargado en RAM entre requests para evitar el
// cold-load (hasta 30s en máquinas con disco lento). Default 1h.
const DEFAULT_KEEP_ALIVE = process.env.OLLAMA_AGENT_KEEP_ALIVE || '1h';

/**
 * Convierte una tool MCP a formato OpenAI (que Ollama acepta).
 * MCP devuelve inputSchema en JSON Schema lowercase ya compatible.
 */
function mcpToolToOllamaTool(mcpTool) {
  return {
    type: 'function',
    function: {
      name: mcpTool.name,
      description: mcpTool.description || '',
      parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

/**
 * Convierte un mensaje del formato canónico (OpenAI-style) al formato Ollama.
 * Ollama acepta casi tal cual, con la peculiaridad de que tool_calls dentro
 * de un assistant message van como array de { function: { name, arguments } }
 * — no llevan `id`.
 */
function canonicalToOllamaMessage(msg) {
  if (msg.role === 'tool') {
    // Bug observado en Ollama: si el content empieza con `{`, intenta parsearlo
    // como JSON estructurado y falla con "Value looks like object, but can't
    // find closing '}'". Prefijamos con texto plano para forzar interpretación
    // como string. Adicionalmente, si el caller ya pasó un objeto, lo
    // serializamos a JSON.
    const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return {
      role: 'tool',
      content: `Result of ${msg.name || 'tool'}:\n${raw}`,
    };
  }
  if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    // Ollama espera arguments como OBJETO (no como string JSON), igual que el
    // formato en el que los devuelve. Si recibimos string, intentamos parsear.
    return {
      role: 'assistant',
      content: msg.content || '',
      tool_calls: msg.tool_calls.map((tc) => {
        let argsObj = tc.args;
        if (typeof argsObj === 'string') {
          try { argsObj = JSON.parse(argsObj); } catch { argsObj = {}; }
        }
        return { function: { name: tc.name, arguments: argsObj || {} } };
      }),
    };
  }
  return {
    role: msg.role,
    content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
  };
}

/**
 * Parsea los argumentos de una tool call de Ollama. Pueden venir como string
 * (modelo más conservador) o como objeto (modelo más nuevo). Tolerante.
 */
function parseToolArgs(rawArgs) {
  if (rawArgs == null) return {};
  if (typeof rawArgs === 'object') return rawArgs;
  if (typeof rawArgs === 'string') {
    try { return JSON.parse(rawArgs); }
    catch { return { _raw: rawArgs, _parse_error: true }; }
  }
  return {};
}

/**
 * Una vuelta de chat: envía mensajes + tools al modelo y devuelve respuesta normalizada.
 * Streaming: si onChunk se provee, emite cada delta de contenido en tiempo real.
 *
 * @param {object} params
 * @param {string} params.systemInstruction
 * @param {Array} params.messages
 * @param {Array} params.mcpTools
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @param {Function} [params.onChunk] - (text) => void emitido por cada delta
 * @returns {Promise<{text, toolCalls, usage, raw}>}
 */
async function chat({ systemInstruction, messages, mcpTools = [], model = DEFAULT_MODEL, temperature = 0.2, onChunk = null }) {
  const ollamaMessages = [];
  if (systemInstruction) {
    ollamaMessages.push({ role: 'system', content: systemInstruction });
  }
  for (const m of messages) {
    ollamaMessages.push(canonicalToOllamaMessage(m));
  }

  const tools = mcpTools.map(mcpToolToOllamaTool);
  const useStream = typeof onChunk === 'function';

  const body = {
    model,
    messages: ollamaMessages,
    stream: useStream,
    keep_alive: DEFAULT_KEEP_ALIVE,
    options: {
      temperature,
      num_ctx: DEFAULT_NUM_CTX,
    },
  };
  if (tools.length) body.tools = tools;

  const started = Date.now();
  const res = await fetch(`${DEFAULT_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Ollama HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.rawText = text;
    throw err;
  }

  // No streaming: parseo simple del JSON.
  if (!useStream) {
    const data = await res.json();
    return normalizeResponse(data, model, started);
  }

  // Streaming: NDJSON, una línea = un objeto. Acumulamos content + tool_calls.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulatedContent = '';
  let toolCallsAcc = [];
  let lastJson = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      lastJson = obj;
      const msg = obj.message || {};
      if (msg.content) {
        accumulatedContent += msg.content;
        onChunk(msg.content);
      }
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        toolCallsAcc = msg.tool_calls; // último gana — Ollama suele mandar la lista completa al final
      }
    }
  }

  const fakeData = {
    message: { content: accumulatedContent, tool_calls: toolCallsAcc },
    prompt_eval_count: lastJson?.prompt_eval_count ?? null,
    eval_count: lastJson?.eval_count ?? null,
  };
  return normalizeResponse(fakeData, model, started);
}

function normalizeResponse(data, model, started) {
  const message = data.message || {};
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((tc) => ({
        name: tc.function?.name,
        args: parseToolArgs(tc.function?.arguments),
      }))
    : [];
  return {
    provider: 'qwen',
    model,
    text: message.content || '',
    toolCalls,
    usage: {
      prompt_tokens: data.prompt_eval_count || null,
      completion_tokens: data.eval_count || null,
      latency_ms: Date.now() - started,
    },
    raw: data,
  };
}

/**
 * Health check liviano: pide la lista de modelos.
 */
async function isAvailable() {
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Pre-warm: carga el modelo en RAM con un /api/generate mínimo. Útil al boot
 * del backend para que la primera consulta del usuario no pague el cold-load
 * (10-30s en máquinas con disco lento).
 *
 * @returns {Promise<{ok: boolean, model: string, latency_ms: number, error?: string}>}
 */
async function prewarm({ model = DEFAULT_MODEL } = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: '',          // sin prompt: solo carga el modelo
        keep_alive: DEFAULT_KEEP_ALIVE,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, model, latency_ms: Date.now() - started, error: text.slice(0, 200) };
    }
    await res.json().catch(() => null); // descarta el body
    return { ok: true, model, latency_ms: Date.now() - started };
  } catch (err) {
    return { ok: false, model, latency_ms: Date.now() - started, error: err.message };
  }
}

module.exports = {
  chat,
  isAvailable,
  prewarm,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
};
