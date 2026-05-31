/**
 * gemini.provider.js
 *
 * Adapter de Gemini para el agentLoop unificado. Replica el contrato canónico
 * (mensajes OpenAI-style entran, { text, toolCalls } salen) usando directamente
 * el SDK @google/generative-ai sin pasar por la capa legacy gemini.service.js.
 *
 * Diferencia con la implementación legacy: aquí el adapter solo hace UNA vuelta
 * de chat (un sendMessage). El loop de iteraciones lo lleva agentLoop.service,
 * igual que con Qwen. Esto nos da un loop con la misma forma para todos los
 * providers — clave para enchufar Claude/OpenAI mañana.
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const DEFAULT_MODEL    = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_TIMEOUT  = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);

let cachedClient = null;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new GoogleGenerativeAI(apiKey);
  return cachedClient;
}

/**
 * Mapea tipos JSON Schema (lowercase) → SchemaType de Gemini (uppercase).
 * Recursivo sobre objetos y arrays anidados.
 */
function jsonSchemaToGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  if (schema.type) {
    const map = {
      object: SchemaType.OBJECT,
      array:  SchemaType.ARRAY,
      string: SchemaType.STRING,
      number: SchemaType.NUMBER,
      integer: SchemaType.INTEGER,
      boolean: SchemaType.BOOLEAN,
    };
    out.type = map[String(schema.type).toLowerCase()] || SchemaType.STRING;
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum)        out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      out.properties[k] = jsonSchemaToGeminiSchema(v);
    }
  }
  if (schema.required) out.required = schema.required;
  if (schema.items)    out.items = jsonSchemaToGeminiSchema(schema.items);
  return out;
}

/**
 * Convierte una tool MCP a FunctionDeclaration de Gemini.
 */
function mcpToolToGeminiTool(mcpTool) {
  return {
    name: mcpTool.name,
    description: (mcpTool.description || '').slice(0, 1024),
    parameters: jsonSchemaToGeminiSchema(mcpTool.inputSchema || { type: 'object', properties: {} }),
  };
}

/**
 * Convierte el array canónico de mensajes a la pareja (history, currentMessage)
 * que espera el chatSession de Gemini. El último mensaje user/tool va como
 * mensaje actual; todo lo anterior va a history.
 */
function buildHistoryAndCurrent(messages) {
  const history = [];
  const list = Array.isArray(messages) ? messages.slice() : [];
  if (!list.length) throw new Error('Gemini provider: messages vacío');

  // Encontrar el último mensaje "tractor" (user con texto o tool con resultados)
  let cutoff = -1;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const m = list[i];
    if (m.role === 'user' || m.role === 'tool') { cutoff = i; break; }
  }
  if (cutoff < 0) throw new Error('Gemini provider: no hay mensaje user/tool al final');

  // Acumular tool messages contiguos (en caso de varias tools en una iteración)
  let currentStart = cutoff;
  while (currentStart > 0 && list[currentStart - 1].role === 'tool' && list[cutoff].role === 'tool') {
    currentStart -= 1;
  }

  for (let i = 0; i < currentStart; i += 1) {
    const m = list[i];
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      history.push({
        role: 'function',
        parts: [{ functionResponse: {
          name: m.name,
          response: typeof m.content === 'string'
            ? safeParseObject(m.content)
            : (m.content || {}),
        } }],
      });
      continue;
    }
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      history.push({
        role: 'model',
        parts: m.tool_calls.map((tc) => ({
          functionCall: { name: tc.name, args: tc.args || {} },
        })),
      });
      continue;
    }
    if (!m.content) continue;
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    });
  }

  // Construir el "currentMessage" — texto o array de functionResponses
  const currentSlice = list.slice(currentStart);
  if (currentSlice.length === 1 && currentSlice[0].role === 'user') {
    return { history, currentMessage: String(currentSlice[0].content || '') };
  }
  // Múltiples tool messages → array de functionResponses
  const parts = currentSlice
    .filter((m) => m.role === 'tool')
    .map((m) => ({
      functionResponse: {
        name: m.name,
        response: typeof m.content === 'string' ? safeParseObject(m.content) : (m.content || {}),
      },
    }));
  return { history, currentMessage: parts };
}

function safeParseObject(text) {
  try { return JSON.parse(text); }
  catch { return { result: String(text) }; }
}

/**
 * Una vuelta de chat con Gemini.
 *
 * @returns {Promise<{provider, model, text, toolCalls, usage, raw}>}
 */
async function chat({ systemInstruction, messages, mcpTools = [], model = DEFAULT_MODEL, temperature = 0.2 }) {
  const client = getClient();
  if (!client) throw new Error('GEMINI_API_KEY no configurada');

  const tools = mcpTools.length
    ? [{ functionDeclarations: mcpTools.map(mcpToolToGeminiTool) }]
    : undefined;

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemInstruction || undefined,
    tools,
    generationConfig: { temperature, maxOutputTokens: 2048 },
  });

  const { history, currentMessage } = buildHistoryAndCurrent(messages);
  const chatSession = genModel.startChat({ history });

  const started = Date.now();
  const result = await Promise.race([
    chatSession.sendMessage(currentMessage),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout')), DEFAULT_TIMEOUT)
    ),
  ]);

  const response = result.response;
  const usage = response.usageMetadata || {};
  const fnCalls = (response.functionCalls && response.functionCalls()) || [];

  return {
    provider: 'gemini',
    model,
    text: fnCalls.length ? '' : response.text(),
    toolCalls: fnCalls.map((fc) => ({ name: fc.name, args: fc.args || {} })),
    usage: {
      prompt_tokens: usage.promptTokenCount || null,
      completion_tokens: usage.candidatesTokenCount || null,
      latency_ms: Date.now() - started,
    },
    raw: response,
  };
}

function isAvailable() {
  return Boolean(process.env.GEMINI_API_KEY);
}

module.exports = {
  chat,
  isAvailable,
  DEFAULT_MODEL,
};
