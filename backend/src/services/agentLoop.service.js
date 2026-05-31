/**
 * agentLoop.service.js
 *
 * Loop agéntico provider-agnóstico. Su trabajo es:
 *   1. Tomar el catálogo de tools del MCP client (única fuente de verdad).
 *   2. Pedirle al provider activo (Qwen, Gemini, etc.) que decida qué tool invocar.
 *   3. Validar el nombre y ejecutarla contra el MCP.
 *   4. Devolver el resultado al provider y repetir hasta que produzca texto final
 *      o se alcance el límite de iteraciones.
 *
 * Guardrails contra modelos pequeños (Qwen 1.5B):
 *   - Validación estricta de tool name contra el catálogo. Si el modelo inventa
 *     `get_caso` cuando existe `get_case`, devolvemos un mensaje correctivo en
 *     vez de explotar.
 *   - Tolerancia con args malformados (parseToolArgs ya maneja JSON inválido).
 *   - Máximo MAX_INVALID_RETRIES correcciones antes de abortar la conversación.
 *
 * Mensajes en formato canónico (OpenAI-style):
 *   { role: 'system'|'user'|'assistant'|'tool', content, tool_calls?, name? }
 *
 * Eventos emitidos vía onEvent (para SSE en el controller):
 *   - { type: 'iteration', iteration }
 *   - { type: 'tool_call_start', name, args }
 *   - { type: 'tool_call_end', name, args, ok, output|error }
 *   - { type: 'tool_call_invalid', name, reason }
 *   - { type: 'text', text }
 */

const mcpClient = require('./mcpClient.service');
const qwenProvider   = require('./agentProviders/qwen.provider');
const geminiProvider = require('./agentProviders/gemini.provider');

const MAX_ITERATIONS      = parseInt(process.env.AGENT_LOOP_MAX_ITERATIONS || '6',  10);
const MAX_INVALID_RETRIES = parseInt(process.env.AGENT_LOOP_MAX_INVALID_RETRIES || '2', 10);
// Truncado de outputs MCP que regresan al modelo. Una llamada list_cases puede
// devolver 30 KB de JSON. Para una tostadora con 2.7 tok/s de prompt eval, cada
// 100 chars extra ≈ 9 segundos de espera. Default agresivo de 600 chars para
// mantener iter 2 bajo control. Override con AGENT_LOOP_MAX_TOOL_OUTPUT.
const MAX_TOOL_OUTPUT_CHARS = parseInt(process.env.AGENT_LOOP_MAX_TOOL_OUTPUT || '600', 10);

const PROVIDERS = {
  qwen:   qwenProvider,
  gemini: geminiProvider,
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Provider desconocido: ${name}`);
  return p;
}

/**
 * Resuelve un alias de tool a un nombre válido del catálogo MCP.
 * Si el modelo inventa una variante (case insensitive, snake/kebab), intenta
 * mapearla. Si nada matchea, devuelve null.
 */
function resolveToolName(requestedName, mcpToolNames) {
  if (!requestedName) return null;
  if (mcpToolNames.includes(requestedName)) return requestedName;
  const normalized = String(requestedName).toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const exact = mcpToolNames.find((n) => n.toLowerCase() === normalized);
  if (exact) return exact;
  return null;
}

/**
 * Ejecuta el loop completo.
 *
 * @param {object} params
 * @param {string} params.provider - 'qwen' | 'gemini'
 * @param {string} params.systemInstruction
 * @param {Array}  params.messages - mensajes canónicos (incluye user al final)
 * @param {object} [params.providerOptions] - { model, temperature, ... }
 * @param {string[]} [params.toolNames] - Subset de tools a exponer al modelo. Si
 *   se omite, se exponen TODAS las del MCP. Crítico para modelos pequeños:
 *   Qwen 1.5B no puede con 50 schemas en el prompt — pasar 5-10 acotadas.
 * @param {Function} [params.onEvent] - emisor de eventos para SSE
 * @returns {Promise<{text, toolCalls, iterations, provider, model, usage}>}
 */
async function runAgenticLoop({
  provider: providerName = 'qwen',
  systemInstruction,
  messages,
  providerOptions = {},
  toolNames = null,
  // Si true, después de la primera tanda de tool_calls dejamos de inyectar las
  // tool schemas (~600 tokens en local) y forzamos respuesta texto. Crítico
  // para tostadoras: ahorra ~220s de prompt eval en iter 2. Default true para
  // qwen, false para providers grandes (Gemini puede encadenar tools sin pena).
  singleToolDepth = providerName === 'qwen',
  onEvent = () => {},
  // Identidad del usuario que originó la conversación. Se reenvía a cada
  // tool call para que mcp-server lo propague como X-On-Behalf-Of al backend
  // y la RBAC se aplique con la identidad real, no con el servicio MCP.
  actor = null,
}) {
  const provider = getProvider(providerName);

  // Catálogo de tools: viene del MCP client (singleton ya conectado en boot).
  // Si el caller pasó toolNames, filtramos. Si no, se exponen todas — útil para
  // modelos grandes (Gemini, Claude) pero peligroso para modelos pequeños.
  const fullCatalog = mcpClient.listTools();
  const mcpTools = Array.isArray(toolNames) && toolNames.length
    ? fullCatalog.filter((t) => toolNames.includes(t.name))
    : fullCatalog;
  const mcpToolNames = mcpTools.map((t) => t.name);
  if (!mcpTools.length) {
    onEvent({ type: 'warn', message: 'MCP sin tools — el agente operará sin herramientas' });
  }

  // Trabajamos sobre una copia de messages que vamos extendiendo en cada iteración.
  const conversation = messages.slice();
  const executedCalls = [];
  let iterations = 0;
  let invalidRetries = 0;
  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, latency_ms: 0 };
  let lastModelName = null;
  // Contador de batches de tool calls ejecutados. Antes era boolean (1 batch máx),
  // pero eso impedía cadenas como "list_cases → create_task" — el modelo solo
  // tenía herramientas en iter 1 y no podía actuar tras leer. Subimos a 2: el
  // modelo puede leer y luego actuar. El costo es ~600 tokens más en iter 2.
  let toolBatchesExecuted = 0;
  const MAX_TOOL_BATCHES = singleToolDepth ? 2 : MAX_ITERATIONS;

  while (iterations < MAX_ITERATIONS) {
    iterations += 1;
    onEvent({ type: 'iteration', iteration: iterations, provider: providerName });

    // Streaming: si el provider lo soporta y el caller pidió chunks, los
    // forwardeamos al evento bus para que el controller los empuje a SSE.
    const streamOnChunk = (text) => onEvent({ type: 'content_chunk', text });

    // Tras MAX_TOOL_BATCHES de tool calls, dejamos de reinyectar schemas para
    // forzar respuesta texto y ahorrar prompt eval en local.
    const dropTools = singleToolDepth && toolBatchesExecuted >= MAX_TOOL_BATCHES;
    const toolsForThisIteration = dropTools ? [] : mcpTools;
    if (dropTools) onEvent({ type: 'iteration_text_only', iteration: iterations });

    const response = await provider.chat({
      systemInstruction,
      messages: conversation,
      mcpTools: toolsForThisIteration,
      model: providerOptions.model,
      temperature: providerOptions.temperature ?? 0.2,
      onChunk: streamOnChunk,
    });
    lastModelName = response.model;
    if (response.usage) {
      totalUsage.prompt_tokens     += response.usage.prompt_tokens     || 0;
      totalUsage.completion_tokens += response.usage.completion_tokens || 0;
      totalUsage.latency_ms        += response.usage.latency_ms        || 0;
    }

    // Caso A: el modelo respondió texto (sin tool calls) → fin del loop.
    if (!response.toolCalls?.length) {
      const finalText = response.text || '';
      onEvent({ type: 'text', text: finalText });
      return {
        provider: providerName,
        model: lastModelName,
        text: finalText,
        toolCalls: executedCalls,
        iterations,
        usage: totalUsage,
      };
    }

    // Caso B: hay tool calls. Validamos cada una contra el catálogo MCP.
    // Limpieza: modelos pequeños pasan `status: null` en lugar de omitir el
    // campo, lo que rompe enums opcionales. Filtramos null/undefined/"" para
    // que MCP los trate como ausentes.
    const validated = response.toolCalls.map((tc) => {
      const resolvedName = resolveToolName(tc.name, mcpToolNames);
      const cleanArgs = {};
      for (const [k, v] of Object.entries(tc.args || {})) {
        if (v !== null && v !== undefined && v !== '') cleanArgs[k] = v;
      }
      return { requested: tc.name, name: resolvedName, args: cleanArgs };
    });

    const invalid = validated.filter((v) => !v.name);
    if (invalid.length) {
      invalidRetries += 1;
      for (const inv of invalid) {
        onEvent({
          type: 'tool_call_invalid',
          name: inv.requested,
          reason: 'Tool no existe en el catálogo MCP',
        });
      }

      if (invalidRetries > MAX_INVALID_RETRIES) {
        const finalText = `No pude completar la tarea: el modelo intentó usar tools que no existen (${invalid.map(i=>i.requested).join(', ')}).`;
        onEvent({ type: 'text', text: finalText });
        return {
          provider: providerName,
          model: lastModelName,
          text: finalText,
          toolCalls: executedCalls,
          iterations,
          usage: totalUsage,
          aborted: true,
        };
      }

      // Inyectar mensaje correctivo y dar otra oportunidad.
      conversation.push({
        role: 'assistant',
        content: '',
        tool_calls: response.toolCalls.map((tc) => ({ name: tc.name, args: tc.args })),
      });
      const availablePreview = mcpToolNames.slice(0, 30).join(', ');
      conversation.push({
        role: 'user',
        content: `La tool "${invalid[0].requested}" no existe. Tools disponibles (primeras 30): ${availablePreview}. Reintenta usando un nombre exacto del catálogo, o responde en texto si no aplica ninguna.`,
      });
      continue;
    }

    // Caso C: todas las tool calls válidas → ejecutarlas vía MCP.
    toolBatchesExecuted += 1;
    conversation.push({
      role: 'assistant',
      content: response.text || '',
      tool_calls: validated.map((v) => ({ name: v.name, args: v.args })),
    });

    const results = await Promise.all(validated.map(async (v) => {
      onEvent({ type: 'tool_call_start', name: v.name, args: v.args });
      const result = await mcpClient.callTool(v.name, v.args, { actor });
      const event = {
        type: 'tool_call_end',
        name: v.name,
        args: v.args,
        ok: result.ok,
        output: result.ok ? result.output : null,
        error: result.ok ? null : result.error,
      };
      executedCalls.push({ name: v.name, args: v.args, ok: result.ok, output: result.output, error: result.error });
      onEvent(event);
      return { name: v.name, result };
    }));

    // Pasar los resultados al modelo para la siguiente iteración.
    for (const r of results) {
      const rawContent = r.result.ok
        ? extractTextFromMcpResult(r.result.output)
        : `Error: ${r.result.error}`;
      const content = truncateForModel(rawContent, MAX_TOOL_OUTPUT_CHARS);
      conversation.push({
        role: 'tool',
        name: r.name,
        content,
      });
    }
  }

  // Caso D: se agotaron las iteraciones sin texto final.
  const finalText = `Alcancé el límite de ${MAX_ITERATIONS} pasos sin completar la tarea. Puedes pedirme que continúe o reformular.`;
  onEvent({ type: 'text', text: finalText });
  return {
    provider: providerName,
    model: lastModelName,
    text: finalText,
    toolCalls: executedCalls,
    iterations,
    usage: totalUsage,
    aborted: true,
  };
}

/**
 * El MCP devuelve { content: [{ type: 'text', text: '<json string>' }] }.
 * Para el modelo nos interesa el texto plano (que suele ser JSON serializado).
 */
function extractTextFromMcpResult(mcpOutput) {
  if (!mcpOutput) return '';
  if (typeof mcpOutput === 'string') return mcpOutput;
  if (Array.isArray(mcpOutput.content)) {
    return mcpOutput.content
      .map((c) => c.text || (typeof c === 'string' ? c : JSON.stringify(c)))
      .filter(Boolean)
      .join('\n');
  }
  return JSON.stringify(mcpOutput);
}

/**
 * Trunca y comprime un tool output para no inundar el ctx. Estrategia:
 *   1. Si es el envelope v1 ({success, data}), desenvuelve.
 *   2. Si data.<X> es array, deja solo primeros 3 + count del total.
 *   3. Para cada item, conserva solo campos clave (id, número, título, estado).
 *   4. Si aún excede el límite, corte plano con notice.
 */
function truncateForModel(text, maxChars) {
  if (!text || text.length <= maxChars) return text;

  let parsed;
  try { parsed = JSON.parse(text); } catch { /* no JSON */ }

  if (parsed) {
    // Desenvolver envelope v1 si aplica
    const payload = (parsed && typeof parsed === 'object' && 'success' in parsed && 'data' in parsed)
      ? parsed.data : parsed;

    // Buscar el primer array significativo dentro del payload (cases, tasks, etc.)
    if (payload && typeof payload === 'object') {
      for (const [key, val] of Object.entries(payload)) {
        if (Array.isArray(val) && val.length > 0) {
          const head = val.slice(0, 3).map(slimObject);
          const summary = {
            [key]: head,
            total: val.length,
            note: val.length > head.length ? `Mostrando ${head.length} de ${val.length}. Llama de nuevo con offset/limit para ver más.` : undefined,
          };
          const out = JSON.stringify(summary);
          if (out.length <= maxChars) return out;
          // Si aún largo, slim aún más
          const minimal = { [key]: val.slice(0, 3).map((it) => ({ id: it.id, num: it.case_number || it.number, t: it.title })), total: val.length };
          const out2 = JSON.stringify(minimal);
          if (out2.length <= maxChars) return out2;
        }
      }
    }

    const compact = JSON.stringify(payload);
    if (compact.length <= maxChars) return compact;
  }

  return text.slice(0, maxChars - 60) + `\n[truncado ${text.length - maxChars + 60} chars]`;
}

/**
 * Reduce un objeto a sus campos esenciales para que el modelo no se atragante
 * con metadata de auditoría (created_at, updated_by, etc).
 */
function slimObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const KEEP = new Set([
    'id', 'case_number', 'number', 'title', 'titulo',
    'status', 'estado', 'priority', 'prioridad',
    'due_date', 'fecha_vencimiento', 'next_action', 'next_action_date',
    'client_name', 'cliente', 'description', 'descripcion',
  ]);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (KEEP.has(k) && obj[k] != null) out[k] = obj[k];
  }
  // Si no encontramos campos conocidos, devolvemos primeros 5 keys del objeto
  if (Object.keys(out).length === 0) {
    const keys = Object.keys(obj).slice(0, 5);
    for (const k of keys) out[k] = obj[k];
  }
  return out;
}

module.exports = {
  runAgenticLoop,
  PROVIDERS: Object.keys(PROVIDERS),
};
