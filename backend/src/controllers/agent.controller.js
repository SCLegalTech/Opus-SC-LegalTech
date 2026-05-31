/**
 * agent.controller.js
 *
 * Endpoint SSE del agente Phi — versión MCP-first (Fase 3 de la migración).
 *
 * Antes había tres caminos paralelos (router determinístico, Gemini con tools,
 * local sin tools) y dos catálogos de tools (mcp-server vs agentTools.service).
 * Esto producía la divergencia clásica: terminal funciona, UI no funciona.
 *
 * Ahora todo pasa por agentLoop.service:
 *   1. Bus único de tools = mcpClient → mcp-server (50 tools).
 *   2. Loop provider-agnóstico (Qwen, Gemini, mañana Claude).
 *   3. Mismo system prompt para todos los providers (todos tienen tools).
 *
 * El router determinístico se desactivó deliberadamente: si lo necesitamos como
 * caché de queries directas, vuelve después como capa opcional encima del loop.
 */

const agentLoop = require('../services/agentLoop.service');
const mcpClient = require('../services/mcpClient.service');
const geminiService = require('../services/gemini.service'); // legacy: solo para circuit breaker / isAvailable

const DEFAULT_PROVIDER = (process.env.AGENT_DEFAULT_PROVIDER || 'qwen').toLowerCase();

/**
 * Selección de tools para providers locales según el contexto activo.
 *
 * Por qué importa: cada tool en el prompt cuesta ~300 tokens de schema. En una
 * tostadora con 2.7 tokens/seg de prompt eval, 10 tools = 18 minutos de espera.
 * Bajando a 3-4 tools relevantes al contexto pasamos a 30-90s.
 *
 * La selección depende del artefacto activo: si arrastraste un caso, te doy
 * las tools de caso. Si no hay artefacto, modo browsing.
 *
 * Override total con env var AGENT_LOCAL_TOOLS=tool1,tool2,...
 */
const LOCAL_TOOL_PROFILES = {
  // Sin artefactos: 3 tools esenciales (buscar, ver, crear tarea). El modelo
  // halucinó antes porque create_task no estaba expuesto; ahora sí. Quitamos
  // list_tasks y add_communication para mantener prompt eval rápido en local.
  browse:  ['list_cases', 'get_case', 'create_task'],
  // Caso en contexto: lo más común — leer/modificar el caso, sus tareas y comms.
  caso:    ['get_case', 'update_case', 'list_tasks', 'create_task', 'add_communication'],
  // Tarea en contexto: el usuario quiere actuar sobre la tarea misma.
  tarea:   ['update_task', 'get_case', 'create_task'],
  // Cliente en contexto: ubicar sus casos.
  cliente: ['get_client', 'list_cases', 'get_case'],
};
const ENV_OVERRIDE_TOOLS = (process.env.AGENT_LOCAL_TOOLS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Devuelve la lista de tools a exponer al modelo local según artefactos.
 * Si AGENT_LOCAL_TOOLS está seteado, sobrescribe todo (control manual).
 */
function pickLocalTools(artifacts = []) {
  if (ENV_OVERRIDE_TOOLS.length) return ENV_OVERRIDE_TOOLS;
  if (!artifacts.length) return LOCAL_TOOL_PROFILES.browse;

  // Si hay varios artefactos, prioriza por el primero. Mapeo de tipos comunes.
  const primary = artifacts[0].type;
  if (primary === 'caso' || primary === 'case')       return LOCAL_TOOL_PROFILES.caso;
  if (primary === 'tarea' || primary === 'task')      return LOCAL_TOOL_PROFILES.tarea;
  if (primary === 'cliente' || primary === 'client')  return LOCAL_TOOL_PROFILES.cliente;

  // Tipo desconocido → modo browse + get_case por si pide más contexto.
  return [...LOCAL_TOOL_PROFILES.browse, 'get_case'];
}

/**
 * Prompt rico — para providers grandes (Gemini, Claude). Contiene todo el
 * protocolo, identidad y reglas con detalle.
 */
function buildSystemPromptRich(user, artifacts = []) {
  const fecha = new Date().toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  let prompt = `Eres Phi, la inteligencia artificial nativa de SC LegalTech, firma jurídica colombiana.

FECHA DE HOY: ${fecha}
USUARIO ACTIVO: ${user.name || user.email} (${user.role})

IDENTIDAD Y TONO:
- Auxiliar administrativo del abogado. Amplificas su criterio, no lo reemplazas.
- Respondes en español colombiano, con precisión y concisión. Sin emojis ni relleno.
- Cuando cites datos del sistema, sé exacta: números de caso (SC-YYYY-NNN), fechas, estados.
- Puedes dar contexto jurídico GENERAL: qué es una tutela, qué significa un término procesal,
  cómo funciona un trámite. Pero la APLICACIÓN CONCRETA al caso del cliente la deja siempre
  el profesional jurídico humano. Si te piden definir qué hacer en su caso particular,
  redirige al abogado responsable.

PROTOCOLO (tienes herramientas — úsalas y ACTÚA):
- LECTURA: list_cases, get_case, list_tasks, list_deadlines, list_communications,
  whatsapp_list_conversations, whatsapp_list_messages
- ACCIÓN INTERNA (ejecuta directo): create_task, update_task, update_case, add_communication,
  create_deadline, whatsapp_link_to_case
- A TERCEROS (solo con aprobación humana — usa dry_run=true por defecto):
  gmail_send, whatsapp_send, whatsapp_send_template

REGLAS DE ORO:
1. Si el usuario pide una acción concreta, HAZLA con la herramienta correspondiente en el mismo turno.
2. NO INVENTES datos. Si falta contexto, llama get_case o list_*. Máx 1-2 lecturas antes de actuar.
3. Después de actuar, da un mensaje corto: qué hiciste, en qué caso, ID resultante.`;

  if (artifacts.length > 0) {
    prompt += `\n\nARTEFACTOS EN CONTEXTO (el usuario los arrastró al panel):\n`;
    artifacts.forEach((artifact, i) => {
      prompt += `\n[${i + 1}] ${artifact.type.toUpperCase()}: ${artifact.title}`;
      if (artifact.summary) prompt += ` - ${artifact.summary}`;
      if (artifact.data) prompt += `\nDatos: ${JSON.stringify(artifact.data, null, 2)}`;
    });
    prompt += `\n\nLos artefactos son el foco de la conversación. Cuando el usuario diga "este caso", "esta tarea", refiérete a ellos.`;
  }

  return prompt;
}

/**
 * Prompt slim — para Qwen 3B / Gemma 4B. Cada token de prompt cuesta ~0.4s
 * de eval en una tostadora. Lo bajamos a lo esencial: identidad, regla de uso
 * de tools, datos del artefacto si hay. Sin doctrina extensa.
 */
function buildSystemPromptSlim(user, artifacts = []) {
  let prompt = `Eres Phi, asistente jurídico SC LegalTech. Hoy ${new Date().toLocaleDateString('es-CO')}.

Usa herramientas para todo. NUNCA digas que hiciste una acción si no llamaste la tool de creación/edición correspondiente — list_* solo LEE. No inventes IDs. Para crear tarea en un caso: primero list_cases o get_case para sacar case_id, después create_task. No envíes filtros (status, priority, service_type) salvo que el usuario los pida; no mandes null.`;

  if (artifacts.length > 0) {
    prompt += `\n\nContexto activo:`;
    artifacts.forEach((a) => {
      prompt += `\n- ${a.type}: ${a.title}`;
      if (a.summary) prompt += ` (${a.summary})`;
      // Para Qwen NO inyectamos a.data — son cientos de tokens por artefacto.
      // El modelo puede llamar get_case si necesita más detalle.
    });
  }

  return prompt;
}

/**
 * Resuelve qué provider usar según lo que mandó el frontend.
 * Frontend envía:
 *   provider === 'gemini'  → forzar gemini
 *   profile presente      → forzar local (qwen)
 *   ambos null/vacíos     → DEFAULT_PROVIDER
 */
function resolveProvider({ provider, profile }) {
  if (provider === 'gemini') return 'gemini';
  if (provider === 'qwen' || provider === 'ollama' || provider === 'local') return 'qwen';
  if (profile) return 'qwen'; // cualquier perfil local → qwen
  return DEFAULT_PROVIDER;
}

/**
 * Convierte eventos del agentLoop al formato SSE que el frontend ya entiende.
 * El AgentContext espera:
 *   - { chunk: "..." }            texto a acumular en el mensaje del asistente
 *   - { status: {...} }           paso de progreso (id, label, state, detail)
 *   - { tool_call: { phase, ...} } tool call con phase 'start' o 'end'
 *   - { done: true, ... }         fin de stream
 *   - { error: "..." }            error fatal
 */
function makeEventBridge(send, sendStatus) {
  return (event) => {
    if (event.type === 'content_chunk') {
      // Streaming del modelo local — chunk de texto va directo a la UI.
      if (event.text) send({ chunk: event.text });
      return;
    }
    if (event.type === 'iteration') {
      sendStatus({
        id: `iteration_${event.iteration}`,
        label: event.iteration === 1
          ? `Consultando ${event.provider}`
          : `Razonando (iteración ${event.iteration})`,
        state: 'running',
      });
    } else if (event.type === 'tool_call_start') {
      sendStatus({
        id: `tool_${event.name}_${Date.now()}`,
        label: `Ejecutando: ${event.name}`,
        detail: JSON.stringify(event.args).slice(0, 200),
        state: 'running',
      });
      send({ tool_call: { name: event.name, args: event.args, phase: 'start' } });
    } else if (event.type === 'tool_call_end') {
      sendStatus({
        id: `tool_${event.name}_end`,
        label: event.ok ? `Listo: ${event.name}` : `Error en ${event.name}`,
        detail: event.error || null,
        state: event.ok ? 'done' : 'error',
      });
      send({
        tool_call: {
          name: event.name,
          phase: 'end',
          ok: event.ok,
          output_preview: event.ok
            ? JSON.stringify(event.output).slice(0, 300)
            : event.error,
        },
      });
    } else if (event.type === 'tool_call_invalid') {
      sendStatus({
        id: `tool_invalid_${Date.now()}`,
        label: `Tool inválida: ${event.name}`,
        detail: event.reason,
        state: 'warn',
      });
    } else if (event.type === 'warn') {
      sendStatus({
        id: `warn_${Date.now()}`,
        label: event.message,
        state: 'warn',
      });
    }
    // 'text' lo enviamos manualmente al final (un solo chunk con el texto completo)
  };
}

const chat = async (req, res) => {
  const {
    messages = [],
    artifacts = [],
    profile = null,
    provider: providerOverride = null,
  } = req.body;

  if (!messages.length) {
    return res.status(400).json({ error: 'messages es requerido' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const sendStatus = (status) => {
    send({
      status: {
        id: status.id || `status_${Date.now()}`,
        label: status.label || 'Trabajando',
        state: status.state || 'running',
        detail: status.detail || null,
        ts: new Date().toISOString(),
      },
    });
  };

  try {
    sendStatus({ id: 'request', label: 'Leyendo tu mensaje y preparando contexto', state: 'running' });

    // Defensivo: si el MCP client no estaba conectado al boot, intenta ahora.
    const mcpStatus = mcpClient.getStatus();
    if (!mcpStatus.connected) {
      sendStatus({ id: 'mcp', label: 'Conectando al bus MCP', state: 'running' });
      const conn = await mcpClient.connect();
      if (!conn.connected) {
        send({ error: `MCP no disponible: ${conn.error || conn.reason}` });
        return res.end();
      }
      sendStatus({ id: 'mcp', label: `MCP conectado — ${conn.tools_count} tools`, state: 'done' });
    }

    const provider = resolveProvider({ provider: providerOverride, profile });

    // Si el usuario pidió Gemini explícitamente y no está disponible (sin key o
    // circuit breaker abierto por cuota), avisa y degrada a default local.
    let effectiveProvider = provider;
    if (provider === 'gemini' && !geminiService.isAvailable()) {
      const circuit = geminiService.getCircuitState();
      const reason = circuit.open
        ? `cuota Gemini agotada (reintenta en ${Math.max(0, Math.round((circuit.until - Date.now())/60000))} min)`
        : 'GEMINI_API_KEY no configurada';
      sendStatus({ id: 'provider', label: `Gemini no disponible: ${reason} — uso ${DEFAULT_PROVIDER}`, state: 'warn' });
      effectiveProvider = DEFAULT_PROVIDER;
    }

    // Prompt slim para locales (cada token de prompt cuesta ~0.4s en tostadora);
    // prompt rico con artifact data para Gemini/Claude.
    const systemPrompt = effectiveProvider === 'qwen'
      ? buildSystemPromptSlim(req.user, artifacts)
      : buildSystemPromptRich(req.user, artifacts);
    const onEvent = makeEventBridge(send, sendStatus);

    // Tool subset acotado al contexto en providers locales. Para Gemini/Claude
    // exponemos todo el catálogo (tienen ctx grande y son rápidos).
    const toolNames = effectiveProvider === 'qwen' ? pickLocalTools(artifacts) : null;
    if (effectiveProvider === 'qwen') {
      sendStatus({
        id: 'tools_scope',
        label: `Tools acotadas: ${toolNames.length} (${artifacts.length ? 'según artefacto' : 'modo browse'})`,
        state: 'done',
      });
    }

    const result = await agentLoop.runAgenticLoop({
      provider: effectiveProvider,
      systemInstruction: systemPrompt,
      messages,
      toolNames,
      onEvent,
      // Identidad del usuario que habla con el agente. Se propaga hasta MCP
      // server vía X-On-Behalf-Of para que la RBAC del backend (canAccessCase,
      // buildCasesFilter) se aplique con la identidad real, no con el usuario
      // de servicio MCP. Sin esto, un assistant podría leer todos los casos
      // de la firma a través del agente.
      actor: req.user ? { id: req.user.id, role: req.user.role } : null,
    });

    // El loop devuelve el texto final en `result.text`. Para Qwen ya se
    // streamearon los chunks vía content_chunk; para Gemini no hay streaming
    // todavía y emitimos el texto entero como un chunk al final.
    if (result.text && effectiveProvider !== 'qwen') {
      send({ chunk: result.text });
    }
    send({
      done: true,
      provider: result.provider,
      model: result.model,
      tool_calls_executed: result.toolCalls.length,
      iterations: result.iterations,
      usage: result.usage,
      aborted: result.aborted || false,
    });

  } catch (err) {
    if (err.name === 'TimeoutError') {
      send({ error: 'Tiempo de espera agotado. El modelo tardó demasiado en responder.' });
    } else {
      send({ error: err.message || 'Error interno del agente' });
    }
  } finally {
    res.end();
  }
};

module.exports = { chat };
