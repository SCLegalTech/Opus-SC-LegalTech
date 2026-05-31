/**
 * gemini.service.js
 *
 * Servicio centralizado para invocar Google Gemini 2.0 Flash como motor primario
 * del agente Phi de SC LegalTech.
 *
 * Tres modos de operacion:
 *   1) generateJson()     - salida JSON estructurada con schema validado (tareas, riesgos, analisis)
 *   2) streamChat()       - respuesta conversacional en streaming (agente chat)
 *   3) runAgenticLoop()   - loop con function calling, ejecuta tools del manifest y continua el razonamiento
 *
 * Lee GEMINI_API_KEY desde env. Si no existe, cada funcion retorna null para permitir fallback.
 */

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.GEMINI_TIMEOUT_MS || '60000', 10);
const MAX_TOOL_ITERATIONS = parseInt(process.env.GEMINI_MAX_TOOL_ITERATIONS || '6', 10);

let cachedClient = null;

// Circuit breaker para cuota agotada. Cuando Gemini devuelve 429 con texto de
// quota, marcamos un cooldown global de 10 min para no perder ~83s de retries
// en cada request siguiente. isAvailable() devolvera false durante el cooldown
// asi que el controller cae directo a runtime local.
const QUOTA_COOLDOWN_MS = parseInt(process.env.GEMINI_QUOTA_COOLDOWN_MS || '600000', 10);
let quotaExhaustedUntil = 0;
let lastQuotaError = null;

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) {
    cachedClient = new GoogleGenerativeAI(apiKey);
  }
  return cachedClient;
}

function isAvailable() {
  if (!process.env.GEMINI_API_KEY) return false;
  if (Date.now() < quotaExhaustedUntil) return false;
  return true;
}

function getCircuitState() {
  return {
    open: Date.now() < quotaExhaustedUntil,
    until: quotaExhaustedUntil || null,
    last_error: lastQuotaError,
    cooldown_ms: QUOTA_COOLDOWN_MS,
  };
}

function tripQuotaCircuit(errMessage) {
  quotaExhaustedUntil = Date.now() + QUOTA_COOLDOWN_MS;
  lastQuotaError = String(errMessage || '').slice(0, 200);
}

function resetQuotaCircuit() {
  quotaExhaustedUntil = 0;
  lastQuotaError = null;
}

/**
 * Schema JSON canonico de Opus para analisis de caso.
 * Se alinea con el shape esperado por caseIntelligence.service.normalizeAiAnalysis.
 */
const CASE_ANALYSIS_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    executive_summary: {
      type: SchemaType.STRING,
      description: 'Resumen ejecutivo en una frase del insumo analizado',
    },
    relevant_facts: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Hechos concretos extraidos del texto, sin interpretacion',
    },
    detected_parties: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Partes, entidades o terceros mencionados',
    },
    suggested_case_type: {
      type: SchemaType.STRING,
      description: 'Tipo de caso sugerido: TUTELA | PQRS | OTRO',
    },
    suggested_status: {
      type: SchemaType.STRING,
      description: 'Estado sugerido: EN_PROCESO | PENDIENTE | CERRADO | etc',
    },
    suggested_next_action: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING },
        due_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD o null' },
        rationale: { type: SchemaType.STRING },
      },
    },
    suggested_tasks: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          priority: { type: SchemaType.STRING, description: 'CRITICA|ALTA|MEDIA|BAJA' },
          due_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD o null' },
        },
      },
    },
    suggested_deadlines: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          title: { type: SchemaType.STRING },
          due_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          urgency: { type: SchemaType.STRING, description: 'CRITICO|ALTO|MEDIO|BAJO' },
        },
      },
    },
    missing_documents: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    risks: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    open_questions: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    input_signals: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: 'Etiquetas: radicacion|respuesta|silencio|contacto_cliente|documentos|audiencia|pago',
    },
    confidence: {
      type: SchemaType.NUMBER,
      description: 'Confianza entre 0 y 1',
    },
  },
  required: ['executive_summary', 'suggested_next_action', 'suggested_tasks', 'confidence'],
};

/**
 * Genera JSON estructurado segun un schema dado.
 * @returns {Promise<{analysis: object, usage: object, model: string, provider: 'gemini'} | null>}
 */
async function generateJson({ systemInstruction, prompt, schema = CASE_ANALYSIS_SCHEMA, model = DEFAULT_MODEL, temperature = 0.2 }) {
  const client = getClient();
  if (!client) return null;

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemInstruction || undefined,
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  const started = Date.now();
  const result = await Promise.race([
    genModel.generateContent(prompt),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout')), DEFAULT_TIMEOUT_MS)
    ),
  ]);

  const text = result.response.text();
  const usage = result.response.usageMetadata || {};

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Gemini devolvio JSON invalido: ${text.slice(0, 200)}`);
    parsed = JSON.parse(match[0]);
  }

  return {
    provider: 'gemini',
    model,
    analysis: parsed,
    usage: {
      prompt_tokens: usage.promptTokenCount || null,
      completion_tokens: usage.candidatesTokenCount || null,
      total_tokens: usage.totalTokenCount || null,
      latency_ms: Date.now() - started,
    },
  };
}

/**
 * Stream conversacional. Invoca `onChunk(text)` por cada delta y retorna metadata final.
 * @returns {Promise<{provider, model, usage} | null>}
 */
async function streamChat({ systemInstruction, messages, model = DEFAULT_MODEL, temperature = 0.3, onChunk }) {
  const client = getClient();
  if (!client) return null;

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemInstruction || undefined,
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
    },
  });

  // Gemini espera history + message actual. Tomamos el ultimo user message como "message".
  const history = [];
  const list = Array.isArray(messages) ? messages.slice() : [];
  const lastUser = [...list].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('streamChat requiere al menos un mensaje user');

  for (const m of list) {
    if (m === lastUser) break;
    if (!m.content) continue;
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    });
  }

  const chatSession = genModel.startChat({ history });
  const started = Date.now();
  const result = await chatSession.sendMessageStream(String(lastUser.content));

  let fullText = '';
  for await (const chunk of result.stream) {
    const delta = chunk.text();
    if (delta) {
      fullText += delta;
      if (typeof onChunk === 'function') onChunk(delta);
    }
  }

  const aggregated = await result.response;
  const usage = aggregated.usageMetadata || {};

  return {
    provider: 'gemini',
    model,
    text: fullText,
    usage: {
      prompt_tokens: usage.promptTokenCount || null,
      completion_tokens: usage.candidatesTokenCount || null,
      total_tokens: usage.totalTokenCount || null,
      latency_ms: Date.now() - started,
    },
  };
}

/**
 * Loop agentico con function calling.
 *
 * @param {object} params
 * @param {string} params.systemInstruction - System prompt
 * @param {Array<{role:string,content:string}>} params.messages - Historia conversacional
 * @param {Array<object>} params.toolDeclarations - FunctionDeclaration[] Gemini
 * @param {Function} params.toolExecutor - async (name, args, context) => result
 * @param {object} [params.context] - Contexto opaco pasado al executor (user, case, etc)
 * @param {Function} [params.onEvent] - (event) => void. Eventos: tool_call_start, tool_call_end, text_chunk, iteration
 * @param {string} [params.model]
 * @param {number} [params.temperature]
 * @returns {Promise<{text, toolCalls, iterations, usage, provider, model} | null>}
 */
async function runAgenticLoop({
  systemInstruction,
  messages,
  toolDeclarations,
  toolExecutor,
  context = {},
  onEvent = () => {},
  model = DEFAULT_MODEL,
  temperature = 0.2,
}) {
  const client = getClient();
  if (!client) return null;

  const genModel = client.getGenerativeModel({
    model,
    systemInstruction: systemInstruction || undefined,
    tools: toolDeclarations && toolDeclarations.length ? [{ functionDeclarations: toolDeclarations }] : undefined,
    generationConfig: { temperature, maxOutputTokens: 2048 },
  });

  const history = [];
  const list = Array.isArray(messages) ? messages.slice() : [];
  const lastUser = [...list].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('runAgenticLoop requiere al menos un mensaje user');
  for (const m of list) {
    if (m === lastUser) break;
    if (!m.content) continue;
    history.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    });
  }

  const chatSession = genModel.startChat({ history });
  const started = Date.now();
  const executedCalls = [];
  let iterations = 0;
  let currentMessage = String(lastUser.content);
  let finalText = '';
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  // Retry helper para 429 (rate limit) y errores transitorios. Hasta 2 reintentos
  // con backoff 4s/12s antes de dejar caer al fallback.
  async function sendWithRetry(message) {
    // Backoff para rate-limit transitorio por minuto (15 RPM en 2.5 Flash free).
    // Si el error es de QUOTA DIARIA agotada, no reintenta y "trip" el circuit
    // breaker para que isAvailable() devuelva false los siguientes 10 min y el
    // controller pueda saltar Gemini sin esperar 83s en cada request.
    const delays = [8000, 25000, 50000];
    let lastErr;
    for (let attempt = 0; attempt <= delays.length; attempt += 1) {
      try {
        const result = await chatSession.sendMessage(message);
        return result;
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || '');
        const isQuotaExhausted = (msg.includes('429') || msg.includes('Too Many Requests'))
          && (msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('exceeded'));
        if (isQuotaExhausted) {
          // Cuota diaria agotada: no tiene sentido reintentar.
          tripQuotaCircuit(msg);
          onEvent({ type: 'quota_exhausted', reason: msg.slice(0, 200), cooldown_ms: QUOTA_COOLDOWN_MS });
          throw err;
        }
        const transient = msg.includes('429') || msg.includes('Too Many Requests')
          || msg.includes('503') || msg.includes('UNAVAILABLE') || msg.includes('overloaded');
        if (!transient || attempt === delays.length) throw err;
        const wait = delays[attempt];
        onEvent({ type: 'retry', attempt: attempt + 1, wait_ms: wait, reason: msg.slice(0, 120) });
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;
    onEvent({ type: 'iteration', iteration: iterations });

    const response = await sendWithRetry(currentMessage);
    const usage = response.response.usageMetadata || {};
    totalPromptTokens += usage.promptTokenCount || 0;
    totalCompletionTokens += usage.candidatesTokenCount || 0;

    const functionCalls = response.response.functionCalls() || [];

    if (!functionCalls.length) {
      finalText = response.response.text();
      onEvent({ type: 'text', text: finalText });
      break;
    }

    // Ejecutar todas las llamadas en paralelo
    const results = await Promise.all(
      functionCalls.map(async (call) => {
        onEvent({ type: 'tool_call_start', name: call.name, args: call.args });
        try {
          const output = await toolExecutor(call.name, call.args || {}, context);
          const entry = { name: call.name, args: call.args, output, ok: true };
          executedCalls.push(entry);
          onEvent({ type: 'tool_call_end', ...entry });
          return { call, output, ok: true };
        } catch (err) {
          const entry = { name: call.name, args: call.args, error: err.message, ok: false };
          executedCalls.push(entry);
          onEvent({ type: 'tool_call_end', ...entry });
          return { call, output: { error: err.message }, ok: false };
        }
      })
    );

    // Alimentar resultados al modelo en el siguiente turno
    currentMessage = results.map(({ call, output }) => ({
      functionResponse: {
        name: call.name,
        response: typeof output === 'object' ? output : { result: output },
      },
    }));
  }

  return {
    provider: 'gemini',
    model,
    text: finalText,
    toolCalls: executedCalls,
    iterations,
    usage: {
      prompt_tokens: totalPromptTokens || null,
      completion_tokens: totalCompletionTokens || null,
      latency_ms: Date.now() - started,
    },
  };
}

module.exports = {
  isAvailable,
  getCircuitState,
  resetQuotaCircuit,
  generateJson,
  streamChat,
  runAgenticLoop,
  CASE_ANALYSIS_SCHEMA,
  DEFAULT_MODEL,
};
