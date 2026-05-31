const db = require('../config/db');
const { getEntity, listEntities, resolveEntities } = require('./entityCatalog.service');

function compact(value, max = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function priorityRank(priority) {
  return { alta: 0, media: 1, baja: 2 }[String(priority || '').toLowerCase()] ?? 3;
}

function pickMissingCapabilities(entity, instruction = '') {
  const text = String(instruction || '').toLowerCase();
  const all = entity.missingCapabilities || [];
  if (!text) return all.slice(0, 2);
  const matched = all.filter((gap) => (
    text.includes(String(gap.capability || '').replaceAll('_', ' ').toLowerCase())
    || text.includes('falta')
    || text.includes('no puedo')
    || text.includes('necesito')
    || text.includes('metadato')
    || text.includes('cadena')
    || text.includes('sla')
  ));
  return (matched.length ? matched : all).sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0, 2);
}

async function logAction({ actionType, userId, caseId, params, result, status = 'executed', reversible = true, planId = null }) {
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, case_id, user_id, plan_id, params, result, status, reversible, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, NOW())`,
      [
        actionType,
        caseId || null,
        userId || null,
        planId || null,
        JSON.stringify(params || {}),
        JSON.stringify(result || {}),
        status,
        reversible,
      ]
    );
  } catch (err) {
    console.error('[entityRuntime] logAction failed:', err.message);
  }
}

async function createPlan({ entity, instruction, caseId, userId, steps, description }) {
  if (!steps.length) return null;
  const { rows } = await db.query(
    `INSERT INTO agent_plans (
       title, description, case_id, user_id, steps, status, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', NOW(), NOW())
     RETURNING id, uuid, title, description, case_id, user_id, steps, status, created_at, updated_at`,
    [
      `Entidad ${entity.name}: ${compact(instruction || entity.purpose, 80)}`,
      description,
      caseId || null,
      userId || null,
      JSON.stringify(steps),
    ]
  );
  return rows[0];
}

async function fetchCaseContext(caseId, user) {
  if (!caseId) return null;
  try {
    const [caseRes, tasksRes, deadlinesRes, commsRes] = await Promise.all([
      db.query(
        `SELECT c.id, c.case_number, c.title, c.service_type, c.status,
                c.entity, c.next_action, c.next_action_date, c.response_deadline,
                cl.full_name AS client_name
         FROM cases c LEFT JOIN clients cl ON cl.id = c.client_id
         WHERE c.id = $1`,
        [Number(caseId)]
      ),
      db.query(
        `SELECT id, title, priority, status, due_date
         FROM tareas WHERE case_id = $1 AND status NOT IN ('COMPLETADA', 'CANCELADA')
         ORDER BY due_date ASC NULLS LAST LIMIT 15`,
        [Number(caseId)]
      ),
      db.query(
        `SELECT id, title, due_date, urgency, resolved
         FROM vencimientos WHERE case_id = $1 AND resolved = FALSE
         ORDER BY due_date ASC LIMIT 15`,
        [Number(caseId)]
      ),
      db.query(
        `SELECT id, type, LEFT(content, 300) AS preview, created_at
         FROM communications WHERE case_id = $1
         ORDER BY created_at DESC LIMIT 8`,
        [Number(caseId)]
      ),
    ]);
    if (!caseRes.rows[0]) return { error: 'caso_no_encontrado', case_id: Number(caseId) };
    return {
      case: caseRes.rows[0],
      open_tasks: tasksRes.rows,
      pending_deadlines: deadlinesRes.rows,
      recent_communications: commsRes.rows,
    };
  } catch (err) {
    return { error: err.message };
  }
}

function buildSteps(entity, { caseId, instruction, missingCapabilities }) {
  const steps = [];
  if (caseId) {
    steps.push({
      tool: 'get_case_brief',
      params: { case_id: Number(caseId) },
      description: `${entity.name} revisa contexto completo del caso antes de actuar.`,
      requires_approval: false,
    });
  }

  if (entity.key === 'marax') {
    steps.push({
      tool: 'list_upcoming_deadlines',
      params: { days: 14, include_overdue: true, limit: 20 },
      description: 'Revisar vencimientos proximos y vencidos.',
      requires_approval: false,
    });
  }

  if (['barbatos', 'foras', 'purson', 'ronove'].includes(entity.key) && caseId) {
    steps.push({
      tool: 'list_case_communications',
      params: { case_id: Number(caseId), limit: 15 },
      description: `${entity.name} revisa comunicaciones asociadas al caso.`,
      requires_approval: false,
    });
  }

  if (['belial', 'ronove'].includes(entity.key)) {
    steps.push({
      tool: 'agent_plan_update_step',
      params: { requires_human_review: true },
      description: 'Checkpoint humano obligatorio antes de cualquier accion sensible o externa.',
      requires_approval: true,
    });
  } else if (missingCapabilities.length) {
    steps.push({
      tool: 'agent_action_log',
      params: {
        action_type: 'entity_capability_gap_detected',
        entity: entity.key,
        missing_capabilities: missingCapabilities.map((gap) => gap.capability),
      },
      description: 'Registrar brecha de capacidad en Kaizen para desarrollo reusable.',
      requires_approval: false,
    });
  } else if (caseId) {
    steps.push({
      tool: 'add_case_note',
      params: { case_id: Number(caseId), content: `Lectura de ${entity.name}: ${instruction || entity.purpose}` },
      description: 'Dejar nota interna con hallazgos de la entidad.',
      requires_approval: false,
    });
  } else {
    steps.push({
      tool: 'agent_action_log',
      params: {
        action_type: 'entity_operational_reading',
        entity: entity.key,
        instruction: instruction || entity.purpose,
      },
      description: 'Registrar lectura operativa transversal sin asociarla a un caso especifico.',
      requires_approval: false,
    });
  }

  return steps.map((step, index) => ({
    index,
    tool: step.tool,
    params: step.params || {},
    description: step.description,
    requires_approval: Boolean(step.requires_approval),
    status: 'pending',
    result: null,
    executed_at: null,
    approved_by: null,
  }));
}

async function registerCapabilityGaps({ entity, instruction, missingCapabilities, userId, caseId }) {
  const registered = [];
  for (const gap of missingCapabilities) {
    const payload = {
      entity: entity.key,
      entity_name: entity.name,
      objective: instruction || entity.purpose,
      missing_capability: gap.capability,
      suggested_endpoint: gap.suggestedEndpoint,
      also_useful_for: gap.alsoUsefulFor || [],
      priority: gap.priority || 'media',
      evidence: {
        case_id: caseId || null,
        source: 'entity_runtime',
      },
    };
    await logAction({
      actionType: 'entity_capability_gap_detected',
      userId,
      caseId,
      params: payload,
      result: { kaizen_candidate: true },
      reversible: true,
    });
    registered.push(payload);
  }
  return registered;
}

async function invokeEntity({ key, instruction = '', case_id: caseId, artifacts = [], mode = 'plan', create_plan: createPlanFlag = true }, { user }) {
  const entity = getEntity(key);
  if (!entity) {
    const resolved = resolveEntities({ instruction: key || instruction });
    return invokeEntity({ key: resolved.lead_entity.key, instruction, case_id: caseId, artifacts, mode, create_plan: createPlanFlag }, { user });
  }

  const resolution = resolveEntities({ instruction: `${entity.name} ${instruction}` });
  const context = await fetchCaseContext(caseId, user);
  const missingCapabilities = pickMissingCapabilities(entity, instruction);
  const gapLog = await registerCapabilityGaps({
    entity,
    instruction,
    missingCapabilities,
    userId: user?.id,
    caseId,
  });

  const availableFunctions = entity.currentCapabilities || [];
  const sensitive = entity.key === 'belial' || /enviar|firmar|cerrar|radicar|extern/i.test(instruction);
  const actions = [
    {
      type: sensitive ? 'approval_plan' : 'operational_plan',
      title: sensitive
        ? 'Preparar accion sensible con aprobacion humana'
        : `Ejecutar lectura operativa de ${entity.name}`,
      requires_approval: sensitive,
    },
  ];

  const steps = buildSteps(entity, { caseId, instruction, missingCapabilities });
  const description = [
    `Entidad: ${entity.name} (${entity.domain})`,
    `Proposito: ${entity.purpose}`,
    `Ritual/requisitos: ${entity.ritual}`,
    missingCapabilities.length
      ? `Brechas detectadas: ${missingCapabilities.map((gap) => gap.capability).join(', ')}`
      : 'Sin brechas criticas detectadas en esta invocacion.',
  ].join('\n');

  const plan = createPlanFlag && mode !== 'diagnostic'
    ? await createPlan({ entity, instruction, caseId, userId: user?.id, steps, description })
    : null;

  await logAction({
    actionType: 'entity_invoked',
    userId: user?.id,
    caseId,
    planId: plan?.id || null,
    params: { entity: entity.key, instruction, mode, artifacts_count: artifacts.length },
    result: {
      lead_entity: entity.key,
      supporting_entities: resolution.supporting_entities.map((item) => item.key).filter((item) => item !== entity.key),
      missing_capabilities: missingCapabilities.map((gap) => gap.capability),
      plan_id: plan?.id || null,
    },
    reversible: true,
  });

  return {
    lead_entity: entity,
    supporting_entities: resolution.supporting_entities.filter((item) => item.key !== entity.key),
    reading: `${entity.name} puede operar como agente especializado en ${entity.domain} La lectura inicial es: ${compact(instruction || entity.purpose)}`,
    context,
    available_functions: availableFunctions,
    missing_functions: missingCapabilities,
    kaizen_gaps_registered: gapLog,
    suggested_actions: actions,
    plan,
    requires_approval: sensitive || steps.some((step) => step.requires_approval),
  };
}

async function listSignals({ entity, limit = 50 } = {}) {
  const params = [];
  const where = ["action_type IN ('entity_signal_created', 'entity_capability_gap_detected', 'entity_invoked')"];
  if (entity) {
    params.push(entity);
    where.push(`params->>'entity' = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 50, 200));
  const { rows } = await db.query(
    `SELECT id, action_type, case_id, user_id, params, result, status, created_at
     FROM agent_actions
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  );
  return { signals: rows };
}

async function recentSignalExists(entity, signalKey, caseId = null) {
  const { rows } = await db.query(
    `SELECT id FROM agent_actions
     WHERE action_type = 'entity_signal_created'
       AND params->>'entity' = $1
       AND params->>'signal_key' = $2
       AND ($3::int IS NULL OR case_id = $3)
       AND created_at >= NOW() - INTERVAL '18 hours'
     LIMIT 1`,
    [entity, signalKey, caseId || null]
  );
  return Boolean(rows[0]);
}

async function createSignal({ entity, signalKey, title, severity = 'media', caseId = null, userId = null, evidence = {} }) {
  if (await recentSignalExists(entity, signalKey, caseId)) return null;
  await logAction({
    actionType: 'entity_signal_created',
    userId,
    caseId,
    params: { entity, signal_key: signalKey, title, severity, evidence },
    result: { visible_in_kaizen: true, visible_in_bandeja: true },
    reversible: true,
  });
  return { entity, signal_key: signalKey, title, severity, case_id: caseId, evidence };
}

async function runEntityMonitors({ entity: entityKey, limit = 20 } = {}, { user }) {
  const selected = entityKey ? [getEntity(entityKey)].filter(Boolean) : listEntities();
  const created = [];

  for (const entity of selected) {
    if (entity.key === 'marax') {
      const { rows } = await db.query(
        `SELECT v.id, v.title, v.due_date, v.urgency, c.id AS case_id, c.case_number
         FROM vencimientos v JOIN cases c ON c.id = v.case_id
         WHERE v.resolved = FALSE AND v.due_date <= CURRENT_DATE + INTERVAL '7 days'
         ORDER BY v.due_date ASC LIMIT $1`,
        [limit]
      );
      for (const row of rows) {
        const signal = await createSignal({
          entity: 'marax',
          signalKey: `deadline:${row.id}`,
          title: `Vencimiento ${row.urgency || 'pendiente'}: ${row.title}`,
          severity: row.urgency === 'CRITICO' ? 'alta' : 'media',
          caseId: row.case_id,
          userId: user?.id,
          evidence: row,
        });
        if (signal) created.push(signal);
      }
    }

    if (entity.key === 'paimon') {
      const { rows } = await db.query(
        `SELECT id, case_number, title, status
         FROM cases
         WHERE status NOT IN ('CERRADO', 'ARCHIVADO')
           AND (next_action IS NULL OR TRIM(next_action) = '')
         ORDER BY updated_at DESC LIMIT $1`,
        [limit]
      );
      for (const row of rows) {
        const signal = await createSignal({
          entity: 'paimon',
          signalKey: `case_without_next_action:${row.id}`,
          title: `Caso sin siguiente accion: ${row.case_number}`,
          severity: 'alta',
          caseId: row.id,
          userId: user?.id,
          evidence: row,
        });
        if (signal) created.push(signal);
      }
    }

    if (entity.key === 'seere') {
      const { rows } = await db.query(
        `SELECT t.id, t.title, t.due_date, c.id AS case_id, c.case_number
         FROM tareas t LEFT JOIN cases c ON c.id = t.case_id
         WHERE t.status NOT IN ('COMPLETADA', 'CANCELADA')
           AND t.due_date IS NOT NULL
           AND t.due_date < CURRENT_DATE
         ORDER BY t.due_date ASC LIMIT $1`,
        [limit]
      );
      for (const row of rows) {
        const signal = await createSignal({
          entity: 'seere',
          signalKey: `overdue_task:${row.id}`,
          title: `Cuello de botella: tarea vencida ${row.title}`,
          severity: 'alta',
          caseId: row.case_id,
          userId: user?.id,
          evidence: row,
        });
        if (signal) created.push(signal);
      }
    }

    if (entity.key === 'belial') {
      const { rows } = await db.query(
        `SELECT id, title, case_id, steps
         FROM agent_plans
         WHERE status IN ('draft', 'in_progress')
           AND steps::text ILIKE '%"requires_approval":true%'
         ORDER BY updated_at DESC LIMIT $1`,
        [limit]
      );
      for (const row of rows) {
        const signal = await createSignal({
          entity: 'belial',
          signalKey: `approval_plan:${row.id}`,
          title: `Plan con aprobacion pendiente: ${row.title}`,
          severity: 'media',
          caseId: row.case_id,
          userId: user?.id,
          evidence: { plan_id: row.id },
        });
        if (signal) created.push(signal);
      }
    }
  }

  return { monitored: selected.map((item) => item.key), created_count: created.length, created };
}

module.exports = {
  invokeEntity,
  listSignals,
  runEntityMonitors,
};
