/**
 * @deprecated DESDE FASE 3 — usar `mcpClient.service.js` + `agentLoop.service.js`.
 *
 * Este archivo es el catálogo paralelo de tools que existía antes de la migración
 * a arquitectura MCP. Hoy las únicas verdades son:
 *   - mcp-server (stdio + HTTP)        catálogo único de 50 tools
 *   - mcpClient.service.js             cliente MCP del backend
 *   - agentLoop.service.js             orquestador provider-agnóstico
 *
 * Por qué sigue aquí: lo usan flujos que aún no migraron a MCP — el `proactiveAgent`
 * (autopilot 60min) y `agentProactive.controller` (endpoints `/api/agent/status`,
 * `/api/agent/tools`, `/api/agent/proactive/run`). Ver FASE5_MIGRATION.md para el
 * camino de borrado.
 *
 * NO AGREGAR tools nuevas aquí. Cualquier capacidad nueva va al mcp-server.
 *
 * --- Documentación original abajo ---
 *
 * Tool manifest del agente Phi. Define QUE puede hacer el agente con function calling
 * via Gemini, con dos niveles de permiso:
 *
 *   autonomous  - se ejecuta directamente (lectura, organizacion interna, tareas,
 *                 vencimientos, notas, actualizaciones operativas del caso)
 *   approval    - genera una propuesta que se registra como paso de agent_plan
 *                 requiriendo aprobacion humana antes de ejecutarse
 *
 * Filosofia publica: "La decision juridica es humana. Siempre."
 * SOLO requieren aprobacion los actos que salen de la firma a clientes o
 * terceros (correos, comunicaciones externas, firmas). Todo lo que organiza
 * el trabajo dentro de la firma -- crear tareas, dejar notas, ajustar la
 * siguiente accion del caso, marcar correos leidos, clasificar archivos --
 * es autonomo. El abogado siempre puede revertir desde la UI; el log de
 * agent_actions deja rastro inmutable.
 */

const { SchemaType } = require('@google/generative-ai');
const db = require('../config/db');

// ============================================================================
// Helpers
// ============================================================================

function truncate(text, max = 400) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}...`;
}

async function logAgentAction({ actionType, caseId, userId, params, result, status = 'executed', reversible = true }) {
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, case_id, user_id, params, result, status, reversible, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())`,
      [actionType, caseId || null, userId || null, JSON.stringify(params || {}), JSON.stringify(result || {}), status, reversible]
    );
  } catch (err) {
    // No debe bloquear al agente si el log falla
    console.error('[agentTools] logAgentAction failed:', err.message);
  }
}

// ============================================================================
// Executors - AUTONOMOUS (lectura y preparacion interna)
// ============================================================================

async function execSearchCases({ query, limit = 10 }, { user }) {
  const q = String(query || '').trim();
  if (!q) return { results: [], message: 'query vacia' };

  const like = `%${q.toLowerCase()}%`;
  const caseNumberMatch = q.match(/SC-\d{4}-\d{3,6}/i);

  const { rows } = await db.query(
    `SELECT c.id, c.case_number, c.title, c.service_type, c.status,
            c.next_action, c.next_action_date, c.response_deadline,
            cl.full_name AS client_name
     FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE
       ($1::text IS NOT NULL AND UPPER(c.case_number) = UPPER($1))
       OR LOWER(c.title) LIKE $2
       OR LOWER(c.case_number) LIKE $2
       OR LOWER(COALESCE(cl.full_name, '')) LIKE $2
       OR LOWER(COALESCE(c.entity, '')) LIKE $2
     ORDER BY c.updated_at DESC
     LIMIT $3`,
    [caseNumberMatch ? caseNumberMatch[0] : null, like, Math.min(limit, 20)]
  );

  return {
    count: rows.length,
    results: rows.map((r) => ({
      id: r.id,
      case_number: r.case_number,
      title: r.title,
      client: r.client_name,
      service_type: r.service_type,
      status: r.status,
      next_action: r.next_action,
      next_action_date: r.next_action_date,
    })),
  };
}

async function execGetCaseBrief({ case_id }, { user }) {
  const id = Number(case_id);
  if (!id) throw new Error('case_id invalido');

  const [caseRes, tasksRes, deadlinesRes, commsRes] = await Promise.all([
    db.query(
      `SELECT c.*, cl.full_name AS client_name, cl.document_number AS client_document
       FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
      [id]
    ),
    db.query(
      `SELECT id, title, priority, status, due_date, description
       FROM tareas WHERE case_id = $1 AND status NOT IN ('COMPLETADA', 'CANCELADA')
       ORDER BY due_date ASC NULLS LAST LIMIT 20`,
      [id]
    ),
    db.query(
      `SELECT id, title, due_date, urgency, resolved
       FROM vencimientos WHERE case_id = $1 AND resolved = FALSE
       ORDER BY due_date ASC LIMIT 20`,
      [id]
    ),
    db.query(
      `SELECT id, type, LEFT(content, 500) AS content, created_at
       FROM communications WHERE case_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [id]
    ),
  ]);

  if (!caseRes.rows.length) return { error: 'caso_no_encontrado', case_id: id };

  const c = caseRes.rows[0];
  return {
    case: {
      id: c.id,
      case_number: c.case_number,
      title: c.title,
      service_type: c.service_type,
      status: c.status,
      entity: c.entity,
      client_name: c.client_name,
      client_document: c.client_document,
      next_action: c.next_action,
      next_action_date: c.next_action_date,
      response_deadline: c.response_deadline,
      description: truncate(c.description, 600),
    },
    open_tasks: tasksRes.rows,
    pending_deadlines: deadlinesRes.rows,
    recent_communications: commsRes.rows,
  };
}

async function execListPendingTasks({ case_id, priority, limit = 15 }, { user }) {
  const params = [];
  const where = ["t.status NOT IN ('COMPLETADA', 'CANCELADA')"];

  if (case_id) {
    params.push(Number(case_id));
    where.push(`t.case_id = $${params.length}`);
  }
  if (priority) {
    params.push(String(priority).toUpperCase());
    where.push(`t.priority = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 15, 50));

  const { rows } = await db.query(
    `SELECT t.id, t.title, t.priority, t.status, t.due_date,
            c.id AS case_id, c.case_number, c.title AS case_title
     FROM tareas t LEFT JOIN cases c ON c.id = t.case_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE t.priority WHEN 'CRITICA' THEN 0 WHEN 'ALTA' THEN 1 WHEN 'MEDIA' THEN 2 ELSE 3 END,
              t.due_date ASC NULLS LAST
     LIMIT $${params.length}`,
    params
  );

  return { count: rows.length, tasks: rows };
}

async function execListUpcomingDeadlines({ days = 14, include_overdue = true, limit = 20 }, { user }) {
  const d = Math.min(Math.max(Number(days) || 14, 1), 90);
  const { rows } = await db.query(
    `SELECT v.id, v.title, v.due_date, v.urgency,
            c.id AS case_id, c.case_number, c.title AS case_title
     FROM vencimientos v JOIN cases c ON c.id = v.case_id
     WHERE v.resolved = FALSE
       AND v.due_date <= CURRENT_DATE + ($1 || ' days')::INTERVAL
       AND ($2 OR v.due_date >= CURRENT_DATE)
     ORDER BY v.due_date ASC
     LIMIT $3`,
    [String(d), Boolean(include_overdue), Math.min(Number(limit) || 20, 50)]
  );

  return { count: rows.length, deadlines: rows };
}

async function execListCaseCommunications({ case_id, limit = 15 }, { user }) {
  const id = Number(case_id);
  if (!id) throw new Error('case_id invalido');

  const { rows } = await db.query(
    `SELECT id, type, content, created_at, metadata
     FROM communications WHERE case_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [id, Math.min(Number(limit) || 15, 50)]
  );

  return {
    count: rows.length,
    communications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      preview: truncate(r.content, 300),
      created_at: r.created_at,
      source: r.metadata?.source || null,
    })),
  };
}

async function execAnalyzeText({ case_id, text, source_type = 'agent_tool' }, { user }) {
  const { analyzeCase } = require('./caseIntelligence.service');
  const id = Number(case_id);
  let caseData = { id: null, case_number: 'sin_caso', title: 'Analisis ad-hoc' };

  if (id) {
    const { rows } = await db.query(
      `SELECT c.*, cl.full_name AS client_name FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id WHERE c.id = $1`,
      [id]
    );
    if (rows.length) caseData = rows[0];
  }

  const result = await analyzeCase({ caseData, sourceText: text, sourceType: source_type });
  return {
    provider: result.provider,
    analysis: result.analysis,
    suggestions_count: result.suggestions?.length || 0,
  };
}

async function execAddCaseNote({ case_id, content }, { user }) {
  const id = Number(case_id);
  const body = String(content || '').trim();
  if (!id || !body) throw new Error('case_id y content son requeridos');
  if (body.length > 5000) throw new Error('content excede 5000 caracteres');

  const { rows } = await db.query(
    `INSERT INTO communications (case_id, type, content, created_by, created_at)
     VALUES ($1, 'note', $2, $3, NOW()) RETURNING id, created_at`,
    [id, `[Agente Phi] ${body}`, user?.id || null]
  );

  await logAgentAction({
    actionType: 'agent_note_added',
    caseId: id,
    userId: user?.id,
    params: { case_id: id, content: truncate(body, 200) },
    result: { communication_id: rows[0].id },
    reversible: true,
  });

  return { ok: true, communication_id: rows[0].id, created_at: rows[0].created_at };
}

// ============================================================================
// Executors - AUTONOMOUS (escritura interna: crean/actualizan dentro de la firma)
// ============================================================================

async function execCreateTask({ case_id, title, description, priority = 'MEDIA', due_date }, { user }) {
  const id = Number(case_id);
  const cleanTitle = String(title || '').trim();
  if (!id) throw new Error('case_id requerido');
  if (!cleanTitle) throw new Error('title requerido');

  // Validar caso
  const caseExists = await db.query('SELECT id FROM cases WHERE id = $1 LIMIT 1', [id]);
  if (!caseExists.rows.length) throw new Error(`Caso ${id} no encontrado`);

  const safePriority = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'].includes(String(priority).toUpperCase())
    ? String(priority).toUpperCase()
    : 'MEDIA';

  const { rows } = await db.query(
    `INSERT INTO tareas (case_id, title, description, assigned_to, priority, status, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', $6, $7)
     RETURNING id, title, priority, status, due_date, created_at`,
    [id, cleanTitle, description || null, user?.id || null, safePriority, due_date || null, user?.id || null]
  );

  const task = rows[0];

  // Si tiene fecha, crea vencimiento espejo (mismo patron que tareas.controller)
  if (due_date) {
    const daysUntil = Math.ceil((new Date(due_date) - new Date()) / (1000 * 60 * 60 * 24));
    const urgency = daysUntil <= 1 ? 'CRITICO' : daysUntil <= 3 ? 'ALTO' : daysUntil <= 7 ? 'MEDIO' : 'BAJO';
    await db.query(
      `INSERT INTO vencimientos (case_id, tarea_id, title, due_date, urgency, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, task.id, cleanTitle, due_date, urgency, user?.id || null]
    ).catch((err) => console.error('[agentTools] crear vencimiento fallo:', err.message));
  }

  // Nota de sistema en el timeline para que el abogado vea quien la creo
  await db.query(
    `INSERT INTO communications (case_id, type, content, created_by, created_at)
     VALUES ($1, 'system', $2, $3, NOW())`,
    [id, `[Phi] Tarea creada: ${cleanTitle}${due_date ? ` (vence ${due_date})` : ''} | prioridad ${safePriority}`, user?.id || null]
  ).catch(() => {});

  await logAgentAction({
    actionType: 'agent_task_created',
    caseId: id,
    userId: user?.id,
    params: { title: cleanTitle, priority: safePriority, due_date: due_date || null },
    result: { task_id: task.id },
    reversible: true,
  });

  return {
    ok: true,
    task_id: task.id,
    title: task.title,
    priority: task.priority,
    status: task.status,
    due_date: task.due_date,
    message: `Tarea #${task.id} creada en el caso ${id}.`,
  };
}

async function execUpdateCase({ case_id, next_action, next_action_date, status, rationale }, { user }) {
  const id = Number(case_id);
  if (!id) throw new Error('case_id requerido');

  // SAFEGUARDS: el agente NO puede cerrar/archivar casos. Eso es decision humana.
  const FORBIDDEN_STATUS = ['CERRADO', 'ARCHIVADO', 'ANULADO'];

  const setParts = [];
  const params = [];
  let paramIndex = 1;
  const changes = {};

  if (next_action !== undefined) {
    setParts.push(`next_action = $${paramIndex++}`);
    params.push(next_action);
    changes.next_action = next_action;
  }
  if (next_action_date !== undefined) {
    setParts.push(`next_action_date = $${paramIndex++}`);
    params.push(next_action_date || null);
    changes.next_action_date = next_action_date;
  }
  if (status !== undefined) {
    const upper = String(status).toUpperCase();
    if (FORBIDDEN_STATUS.includes(upper)) {
      throw new Error(`Phi no puede mover el caso a ${upper}. Eso requiere decision humana en la UI.`);
    }
    setParts.push(`status = $${paramIndex++}`);
    params.push(upper);
    changes.status = upper;
  }

  if (!setParts.length) throw new Error('Sin cambios para aplicar');

  setParts.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await db.query(
    `UPDATE cases SET ${setParts.join(', ')} WHERE id = $${paramIndex} RETURNING id, case_number, next_action, next_action_date, status`,
    params
  );

  if (!rows.length) throw new Error(`Caso ${id} no encontrado`);

  // Nota de sistema en el timeline
  const summary = Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(', ');
  await db.query(
    `INSERT INTO communications (case_id, type, content, created_by, created_at)
     VALUES ($1, 'system', $2, $3, NOW())`,
    [id, `[Phi] Caso actualizado: ${summary}${rationale ? ` | motivo: ${rationale}` : ''}`, user?.id || null]
  ).catch(() => {});

  await logAgentAction({
    actionType: 'agent_case_updated',
    caseId: id,
    userId: user?.id,
    params: { changes, rationale: rationale || null },
    result: rows[0],
    reversible: true,
  });

  return { ok: true, case: rows[0], applied_changes: changes };
}

async function execUpdateTaskStatus({ task_id, status, priority }, { user }) {
  const id = Number(task_id);
  if (!id) throw new Error('task_id requerido');

  const ALLOWED_STATUS = ['PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'CANCELADA', 'BLOQUEADA'];
  const ALLOWED_PRIORITY = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];

  const setParts = [];
  const params = [];
  let i = 1;
  const changes = {};

  if (status !== undefined) {
    const upper = String(status).toUpperCase();
    if (!ALLOWED_STATUS.includes(upper)) throw new Error(`status invalido: ${status}`);
    setParts.push(`status = $${i++}`);
    params.push(upper);
    changes.status = upper;
  }
  if (priority !== undefined) {
    const upper = String(priority).toUpperCase();
    if (!ALLOWED_PRIORITY.includes(upper)) throw new Error(`priority invalido: ${priority}`);
    setParts.push(`priority = $${i++}`);
    params.push(upper);
    changes.priority = upper;
  }

  if (!setParts.length) throw new Error('Sin cambios para aplicar');
  setParts.push(`updated_at = NOW()`);
  params.push(id);

  const { rows } = await db.query(
    `UPDATE tareas SET ${setParts.join(', ')} WHERE id = $${i} RETURNING id, case_id, title, status, priority`,
    params
  );

  if (!rows.length) throw new Error(`Tarea ${id} no encontrada`);

  await logAgentAction({
    actionType: 'agent_task_updated',
    caseId: rows[0].case_id,
    userId: user?.id,
    params: { task_id: id, changes },
    result: rows[0],
    reversible: true,
  });

  return { ok: true, task: rows[0], applied_changes: changes };
}

async function execCreateDeadline({ case_id, title, due_date, urgency }, { user }) {
  const id = Number(case_id);
  const cleanTitle = String(title || '').trim();
  if (!id) throw new Error('case_id requerido');
  if (!cleanTitle) throw new Error('title requerido');
  if (!due_date) throw new Error('due_date requerido (YYYY-MM-DD)');

  const daysUntil = Math.ceil((new Date(due_date) - new Date()) / (1000 * 60 * 60 * 24));
  const inferredUrgency = daysUntil <= 1 ? 'CRITICO' : daysUntil <= 3 ? 'ALTO' : daysUntil <= 7 ? 'MEDIO' : 'BAJO';
  const safeUrgency = ['CRITICO', 'ALTO', 'MEDIO', 'BAJO'].includes(String(urgency).toUpperCase())
    ? String(urgency).toUpperCase()
    : inferredUrgency;

  const { rows } = await db.query(
    `INSERT INTO vencimientos (case_id, title, due_date, urgency, created_by, resolved)
     VALUES ($1, $2, $3, $4, $5, FALSE)
     RETURNING id, title, due_date, urgency`,
    [id, cleanTitle, due_date, safeUrgency, user?.id || null]
  );

  await db.query(
    `INSERT INTO communications (case_id, type, content, created_by, created_at)
     VALUES ($1, 'system', $2, $3, NOW())`,
    [id, `[Phi] Vencimiento registrado: ${cleanTitle} (${due_date}, ${safeUrgency})`, user?.id || null]
  ).catch(() => {});

  await logAgentAction({
    actionType: 'agent_deadline_created',
    caseId: id,
    userId: user?.id,
    params: { title: cleanTitle, due_date, urgency: safeUrgency },
    result: rows[0],
    reversible: true,
  });

  return { ok: true, deadline: rows[0] };
}

// ============================================================================
// Executors - APPROVAL-GATED (proponen, no ejecutan)
// SOLO se usa para actos que salen a terceros (correos externos).
// ============================================================================

async function proposePlanStep({ title, description, steps, caseId, userId }) {
  const { rows } = await db.query(
    `INSERT INTO agent_plans (title, description, case_id, user_id, steps, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', NOW(), NOW())
     RETURNING id, uuid, status`,
    [title, description, caseId || null, userId || null, JSON.stringify(steps)]
  );
  return rows[0];
}

async function execProposeEmailSend({ case_id, to, subject, body, rationale }, { user }) {
  const id = Number(case_id);
  if (!to || !subject || !body) throw new Error('to, subject y body son requeridos');

  const plan = await proposePlanStep({
    title: `Propuesta: enviar correo a ${to}`,
    description: rationale || 'Envio de correo propuesto por el agente. Requiere aprobacion y revision del abogado.',
    caseId: id || null,
    userId: user?.id,
    steps: [{
      tool: 'gmail_send',
      params: { case_id: id || null, to, subject, body },
      description: `Enviar correo a ${to}: ${truncate(subject, 100)}`,
      requires_approval: true,
      status: 'pending',
    }],
  });

  return {
    requires_approval: true,
    plan_id: plan.id,
    message: `Borrador de correo registrado como plan #${plan.id}. Solo se enviara tras aprobacion humana.`,
  };
}

// ============================================================================
// Manifest - Declaraciones Gemini + permisos
// ============================================================================

const TOOLS = {
  search_cases: {
    permission: 'autonomous',
    executor: execSearchCases,
    declaration: {
      name: 'search_cases',
      description: 'Busca casos por numero SC-YYYY-NNN, titulo, cliente o entidad. Usa esto primero cuando el usuario mencione un caso.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING, description: 'Texto de busqueda' },
          limit: { type: SchemaType.NUMBER, description: 'Maximo de resultados (default 10)' },
        },
        required: ['query'],
      },
    },
  },
  get_case_brief: {
    permission: 'autonomous',
    executor: execGetCaseBrief,
    declaration: {
      name: 'get_case_brief',
      description: 'Obtiene la ficha operativa completa de un caso: datos, tareas abiertas, vencimientos, correos recientes. Usa esto para construir contexto antes de opinar o proponer acciones.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER, description: 'ID numerico del caso' },
        },
        required: ['case_id'],
      },
    },
  },
  list_pending_tasks: {
    permission: 'autonomous',
    executor: execListPendingTasks,
    declaration: {
      name: 'list_pending_tasks',
      description: 'Lista tareas pendientes ordenadas por prioridad y fecha. Filtrable por caso y prioridad.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER, description: 'Opcional: filtrar por caso' },
          priority: { type: SchemaType.STRING, description: 'Opcional: CRITICA | ALTA | MEDIA | BAJA' },
          limit: { type: SchemaType.NUMBER, description: 'Default 15' },
        },
      },
    },
  },
  list_upcoming_deadlines: {
    permission: 'autonomous',
    executor: execListUpcomingDeadlines,
    declaration: {
      name: 'list_upcoming_deadlines',
      description: 'Lista vencimientos proximos y vencidos en la ventana de dias indicada.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          days: { type: SchemaType.NUMBER, description: 'Ventana en dias (default 14, max 90)' },
          include_overdue: { type: SchemaType.BOOLEAN, description: 'Incluir vencidos (default true)' },
          limit: { type: SchemaType.NUMBER, description: 'Default 20' },
        },
      },
    },
  },
  list_case_communications: {
    permission: 'autonomous',
    executor: execListCaseCommunications,
    declaration: {
      name: 'list_case_communications',
      description: 'Lista comunicaciones (correos, notas) asociadas a un caso, ordenadas por fecha descendente. Usa esto para revisar correos recibidos sin enviar nada.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER },
          limit: { type: SchemaType.NUMBER, description: 'Default 15' },
        },
        required: ['case_id'],
      },
    },
  },
  analyze_text: {
    permission: 'autonomous',
    executor: execAnalyzeText,
    declaration: {
      name: 'analyze_text',
      description: 'Analiza un texto libre (correo, nota, documento corto) y lo convierte en estructura operativa: resumen, riesgos, tareas y siguiente accion sugerida. No modifica nada, solo analiza.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER, description: 'Caso asociado (opcional)' },
          text: { type: SchemaType.STRING, description: 'Texto a analizar' },
          source_type: { type: SchemaType.STRING, description: 'nota | email | oficio | otro' },
        },
        required: ['text'],
      },
    },
  },
  add_case_note: {
    permission: 'autonomous',
    executor: execAddCaseNote,
    declaration: {
      name: 'add_case_note',
      description: 'Registra una nota interna en el timeline del caso, marcada como generada por el agente. No es un correo, no sale a terceros. Util para dejar constancia de hallazgos.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER },
          content: { type: SchemaType.STRING, description: 'Contenido de la nota, maximo 5000 caracteres' },
        },
        required: ['case_id', 'content'],
      },
    },
  },
  create_task: {
    permission: 'autonomous',
    executor: execCreateTask,
    declaration: {
      name: 'create_task',
      description: 'CREA una tarea concreta en un caso. EJECUTA directo: la tarea aparece de inmediato en la bandeja del abogado. Si das due_date, tambien crea el vencimiento espejo. Usala cuando el usuario pida agregar/crear/anotar una tarea.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING, description: 'Titulo corto y operativo (ej: "Revisar respuesta SIUGG")' },
          description: { type: SchemaType.STRING, description: 'Detalle opcional con contexto suficiente para retomar' },
          priority: { type: SchemaType.STRING, description: 'CRITICA | ALTA | MEDIA | BAJA. Default MEDIA.' },
          due_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD opcional. Si la das, se crea vencimiento espejo.' },
        },
        required: ['case_id', 'title'],
      },
    },
  },
  update_case: {
    permission: 'autonomous',
    executor: execUpdateCase,
    declaration: {
      name: 'update_case',
      description: 'ACTUALIZA datos operativos del caso: siguiente accion, fecha de siguiente accion, o estado (excepto CERRADO/ARCHIVADO/ANULADO que requieren decision humana en la UI). Usala cuando el contexto justifique mover la siguiente actuacion.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER },
          next_action: { type: SchemaType.STRING, description: 'Nueva siguiente actuacion del expediente' },
          next_action_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          status: { type: SchemaType.STRING, description: 'Nuevo estado operativo (no permitido: CERRADO, ARCHIVADO, ANULADO)' },
          rationale: { type: SchemaType.STRING, description: 'Justificacion breve basada en el contexto del caso' },
        },
        required: ['case_id'],
      },
    },
  },
  update_task_status: {
    permission: 'autonomous',
    executor: execUpdateTaskStatus,
    declaration: {
      name: 'update_task_status',
      description: 'Cambia el estado o la prioridad de una tarea existente. Util para marcar como COMPLETADA, BLOQUEADA, o subir prioridad cuando el contexto lo justifique.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          task_id: { type: SchemaType.NUMBER },
          status: { type: SchemaType.STRING, description: 'PENDIENTE | EN_PROGRESO | COMPLETADA | CANCELADA | BLOQUEADA' },
          priority: { type: SchemaType.STRING, description: 'CRITICA | ALTA | MEDIA | BAJA' },
        },
        required: ['task_id'],
      },
    },
  },
  create_deadline: {
    permission: 'autonomous',
    executor: execCreateDeadline,
    declaration: {
      name: 'create_deadline',
      description: 'CREA un vencimiento (fecha clave) en un caso, sin asociarlo a una tarea concreta. Util para fechas procesales que no son tareas: audiencias, plazos de respuesta, citaciones.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER },
          title: { type: SchemaType.STRING },
          due_date: { type: SchemaType.STRING, description: 'YYYY-MM-DD' },
          urgency: { type: SchemaType.STRING, description: 'CRITICO | ALTO | MEDIO | BAJO. Si no la das se infiere de la fecha.' },
        },
        required: ['case_id', 'title', 'due_date'],
      },
    },
  },
  propose_email_send: {
    permission: 'approval',
    executor: execProposeEmailSend,
    declaration: {
      name: 'propose_email_send',
      description: 'PROPONE enviar un correo. NUNCA lo envia directamente. Crea un borrador como paso de plan que requiere aprobacion humana. Usa esto cuando el usuario pida redactar o mandar un correo.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          case_id: { type: SchemaType.NUMBER, description: 'Caso asociado' },
          to: { type: SchemaType.STRING, description: 'Destinatario' },
          subject: { type: SchemaType.STRING },
          body: { type: SchemaType.STRING, description: 'Cuerpo del correo propuesto' },
          rationale: { type: SchemaType.STRING, description: 'Por que se propone enviar' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
};

// ============================================================================
// API publica
// ============================================================================

function getToolDeclarations(subset = null) {
  const names = subset || Object.keys(TOOLS);
  return names.filter((n) => TOOLS[n]).map((n) => TOOLS[n].declaration);
}

function getToolManifest() {
  return Object.entries(TOOLS).map(([name, def]) => ({
    name,
    permission: def.permission,
    description: def.declaration.description,
  }));
}

async function executeTool(name, args, context = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Tool desconocida: ${name}`);

  const started = Date.now();
  try {
    const result = await tool.executor(args || {}, context);
    // Log ligero para observabilidad (no bloqueante)
    if (tool.permission === 'autonomous' && context.logReads !== false) {
      logAgentAction({
        actionType: `agent_tool_${name}`,
        caseId: args?.case_id || null,
        userId: context.user?.id,
        params: args,
        result: { latency_ms: Date.now() - started, ok: true },
        reversible: true,
      });
    }
    return result;
  } catch (err) {
    await logAgentAction({
      actionType: `agent_tool_${name}`,
      caseId: args?.case_id || null,
      userId: context.user?.id,
      params: args,
      result: { error: err.message, latency_ms: Date.now() - started },
      status: 'failed',
      reversible: true,
    });
    throw err;
  }
}

module.exports = {
  TOOLS,
  getToolDeclarations,
  getToolManifest,
  executeTool,
  logAgentAction,
};
