const db = require('../config/db');
const { analyzeCase } = require('./caseIntelligence.service');
const { boolEnv, getAiRuntimeSummary } = require('../config/aiRuntime');
const geminiService = require('./gemini.service');
const agentTools = require('./agentTools.service');

let timer = null;
let running = false;

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function buildSignalText(row) {
  const lines = [
    `Caso ${row.case_number}: ${row.title}`,
    `Cliente: ${row.client_name || 'sin cliente registrado'}`,
    `Estado: ${row.status || 'sin estado'}`,
    `Tipo: ${row.service_type || 'sin tipo'}`,
    `Entidad: ${row.entity || 'sin entidad'}`,
    `Siguiente accion actual: ${row.next_action || 'sin siguiente accion'}`,
    `Fecha siguiente accion: ${compactDate(row.next_action_date) || 'sin fecha'}`,
    `Vencimiento de respuesta: ${compactDate(row.response_deadline) || 'sin vencimiento'}`,
    `Tareas abiertas: ${row.open_tasks || 0}`,
    `Tareas vencidas: ${row.overdue_tasks || 0}`,
    `Vencimientos vencidos: ${row.overdue_deadlines || 0}`,
    `Vencimientos proximos 7 dias: ${row.upcoming_deadlines || 0}`,
    `Archivos Drive sin clasificar: ${row.unclassified_drive_files || 0}`,
    `Correos Gmail recientes ingestados: ${row.recent_gmail_messages || 0}`,
  ];

  if (row.recent_notes) {
    lines.push(`Contexto reciente: ${row.recent_notes}`);
  }

  return lines.join('\n');
}

function shouldPlan(row, now = new Date()) {
  const hasRisk =
    Number(row.overdue_tasks || 0) > 0 ||
    Number(row.overdue_deadlines || 0) > 0 ||
    Number(row.upcoming_deadlines || 0) > 0 ||
    Number(row.unclassified_drive_files || 0) > 0 ||
    !row.next_action;

  if (!hasRisk) return false;
  if (!row.last_plan_at) return true;

  const minGapHours = intEnv('AGENT_AUTOPILOT_MIN_PLAN_GAP_HOURS', 18);
  const last = new Date(row.last_plan_at);
  const ageHours = (now - last) / (1000 * 60 * 60);
  return ageHours >= minGapHours;
}

function buildPlanSteps(row, analysis) {
  const caseId = String(row.id);
  const steps = [
    {
      tool: 'get_case',
      params: { id: caseId },
      description: `Revisar ficha completa del caso ${row.case_number}.`,
      requires_approval: false,
    },
    {
      tool: 'list_tasks',
      params: { case_id: row.id, limit: 100 },
      description: 'Revisar tareas abiertas y bloqueos operativos.',
      requires_approval: false,
    },
    {
      tool: 'list_deadlines',
      params: { days: 14, include_overdue: true },
      description: 'Cruzar vencimientos proximos y vencidos antes de cambiar prioridades.',
      requires_approval: false,
    },
  ];

  if (Number(row.unclassified_drive_files || 0) > 0 || row.drive_folder_id) {
    steps.push({
      tool: 'drive_list_case_files',
      params: { case_id: caseId },
      description: 'Listar archivos Drive vinculados al expediente.',
      requires_approval: false,
    });
  }

  if (Number(row.unclassified_drive_files || 0) > 0) {
    steps.push({
      tool: 'drive_organize_expediente',
      params: { case_id: caseId, dry_run: true, files: [] },
      description: 'Previsualizar organizacion de expediente sin mover archivos.',
      requires_approval: false,
    });
  }

  if (Number(row.recent_gmail_messages || 0) > 0) {
    steps.push({
      tool: 'gmail_list_case_messages',
      params: { case_id: caseId },
      description: 'Revisar correos ingestados recientemente antes de proponer respuesta.',
      requires_approval: false,
    });
  }

  const nextAction = analysis?.suggested_next_action;
  if (nextAction?.title) {
    steps.push({
      tool: 'update_case',
      params: {
        id: caseId,
        next_action: nextAction.title,
        next_action_date: nextAction.due_date || null,
      },
      description: `Actualizar siguiente accion propuesta: ${nextAction.title}`,
      requires_approval: true,
    });
  }

  (analysis?.suggested_tasks || []).slice(0, 3).forEach((task) => {
    if (!task?.title) return;
    steps.push({
      tool: 'create_task',
      params: {
        case_id: caseId,
        title: task.title,
        description: task.description || 'Tarea propuesta por Gemma local.',
        priority: task.priority || 'MEDIA',
        due_date: task.due_date || null,
      },
      description: `Crear tarea propuesta: ${task.title}`,
      requires_approval: true,
    });
  });

  return steps;
}

async function fetchCandidates(limit) {
  const { rows } = await db.query(
    `SELECT
       c.id, c.organization_id, c.case_number, c.title, c.service_type, c.status, c.entity,
       c.next_action, c.next_action_date, c.response_deadline, c.drive_folder_id,
       cl.full_name AS client_name,
       COUNT(DISTINCT t.id)
         FILTER (WHERE t.status NOT IN ('COMPLETADA','CANCELADA')) AS open_tasks,
       COUNT(DISTINCT t.id)
         FILTER (WHERE t.status NOT IN ('COMPLETADA','CANCELADA')
                 AND t.due_date IS NOT NULL
                 AND t.due_date < CURRENT_DATE) AS overdue_tasks,
       COUNT(DISTINCT v.id)
         FILTER (WHERE v.resolved = FALSE
                 AND v.due_date < CURRENT_DATE) AS overdue_deadlines,
       COUNT(DISTINCT v.id)
         FILTER (WHERE v.resolved = FALSE
                 AND v.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS upcoming_deadlines,
       COUNT(DISTINCT f.id)
         FILTER (WHERE COALESCE(f.category, 'sin_clasificar') = 'sin_clasificar') AS unclassified_drive_files,
       COUNT(DISTINCT comm.id)
         FILTER (WHERE comm.type = 'email'
                 AND comm.metadata->>'source' = 'gmail'
                 AND comm.created_at >= NOW() - INTERVAL '14 days') AS recent_gmail_messages,
       STRING_AGG(DISTINCT LEFT(comm.content, 180), ' | ')
         FILTER (WHERE comm.created_at >= NOW() - INTERVAL '14 days') AS recent_notes,
       (
         SELECT MAX(ap.created_at)
         FROM agent_plans ap
         WHERE ap.case_id = c.id
           AND ap.title LIKE 'Revision proactive local:%'
           AND ap.status IN ('draft', 'in_progress')
       ) AS last_plan_at
     FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN tareas t ON t.case_id = c.id
     LEFT JOIN vencimientos v ON v.case_id = c.id
     LEFT JOIN case_drive_files f ON f.case_id = c.id
     LEFT JOIN communications comm ON comm.case_id = c.id
     WHERE c.status NOT IN ('CERRADO', 'ARCHIVADO')
     GROUP BY c.id, cl.full_name
     ORDER BY
       COUNT(DISTINCT v.id)
         FILTER (WHERE v.resolved = FALSE AND v.due_date < CURRENT_DATE) DESC,
       COUNT(DISTINCT t.id)
         FILTER (WHERE t.status NOT IN ('COMPLETADA','CANCELADA')
                 AND t.due_date IS NOT NULL
                 AND t.due_date < CURRENT_DATE) DESC,
       c.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function createPlanForCandidate({ row, userId, dryRun }) {
  const sourceText = buildSignalText(row);
  const aiResult = await analyzeCase({
    caseData: {
      id: row.id,
      case_number: row.case_number,
      title: row.title,
      service_type: row.service_type,
      status: row.status,
      entity: row.entity,
      client_name: row.client_name,
      next_action: row.next_action,
      next_action_date: row.next_action_date,
      response_deadline: row.response_deadline,
    },
    sourceText,
    sourceType: 'proactive_sweep',
  });

  const title = `Revision proactive local: ${row.case_number}`;
  const steps = buildPlanSteps(row, aiResult.analysis);
  const plan = {
    title,
    description: [
      aiResult.analysis.executive_summary,
      `Proveedor: ${aiResult.provider} (${aiResult.model}).`,
      'Este plan fue creado por barrido proactivo local. Los pasos con efecto quedan pendientes de aprobacion humana.',
    ].filter(Boolean).join('\n'),
    case_id: row.id,
    client_id: null,
    user_id: userId || null,
    steps,
    status: 'draft',
  };

  if (dryRun) {
    return { case_id: row.id, case_number: row.case_number, plan, analysis: aiResult.analysis };
  }

  // Multi-tenant: el caso tiene organization_id; envolvemos los INSERTs con scope
  // para que los DEFAULTs hereden el org correcto en agent_plans y agent_actions.
  const orgId = row.organization_id || 1;
  const { rows } = await db.withTenantClient(orgId, async (scoped) => {
    const planInsert = await scoped.query(
      `INSERT INTO agent_plans (
         title, description, case_id, client_id, user_id, steps, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())
       RETURNING *`,
      [
        plan.title,
        plan.description,
        plan.case_id,
        plan.client_id,
        plan.user_id,
        JSON.stringify(plan.steps),
        plan.status,
      ]
    );

    await scoped.query(
      `INSERT INTO agent_actions (
         action_type, case_id, user_id, plan_id, params, result, status, reversible, created_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'executed', TRUE, NOW())`,
      [
        'proactive_plan_created',
        row.id,
        userId || null,
        planInsert.rows[0].id,
        JSON.stringify({ source: 'agent_autopilot', signal_text: sourceText }),
        JSON.stringify({ provider: aiResult.provider, model: aiResult.model, suggestions: aiResult.suggestions?.length || 0 }),
      ]
    );

    return planInsert;
  });

  // Accion autonoma: dejar nota interna en timeline del caso con hallazgos del barrido.
  // No sale a terceros, solo queda en el expediente como trazabilidad del agente.
  try {
    const summary = aiResult.analysis?.executive_summary || 'Barrido proactivo ejecutado.';
    const risks = (aiResult.analysis?.risks || []).slice(0, 3).join(' | ');
    const noteLines = [
      `Barrido proactivo (${aiResult.provider}/${aiResult.model})`,
      summary,
      risks ? `Riesgos detectados: ${risks}` : null,
      `Plan propuesto: #${rows[0].id} (requiere aprobacion humana).`,
    ].filter(Boolean);

    await agentTools.executeTool(
      'add_case_note',
      { case_id: row.id, content: noteLines.join('\n') },
      { user: { id: userId || null }, logReads: false }
    );
  } catch (err) {
    console.warn(`[proactive] no pude dejar nota en caso ${row.case_number}:`, err.message);
  }

  return { case_id: row.id, case_number: row.case_number, plan: rows[0], analysis: aiResult.analysis };
}

async function runProactiveSweep({ userId = null, dryRun = false, limit } = {}) {
  if (running) {
    return { skipped: true, reason: 'proactive_sweep_already_running' };
  }

  running = true;
  const maxCandidates = Math.min(Number(limit) || intEnv('AGENT_AUTOPILOT_BATCH_LIMIT', 5), 20);
  const startedAt = new Date().toISOString();
  const created = [];
  const skipped = [];
  const errors = [];

  try {
    const candidates = await fetchCandidates(maxCandidates);
    const now = new Date();

    for (const row of candidates) {
      if (!shouldPlan(row, now)) {
        skipped.push({ case_id: row.id, case_number: row.case_number, reason: 'sin_senal_nueva_o_plan_reciente' });
        continue;
      }

      try {
        const result = await createPlanForCandidate({ row, userId, dryRun });
        created.push(result);
      } catch (err) {
        errors.push({ case_id: row.id, case_number: row.case_number, error: err.message });
      }
    }

    return {
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      dry_run: Boolean(dryRun),
      runtime: getAiRuntimeSummary(),
      gemini_available: geminiService.isAvailable(),
      candidates: candidates.length,
      created_count: created.length,
      skipped,
      errors,
      created,
    };
  } finally {
    running = false;
  }
}

function startProactiveAgentLoop() {
  if (!boolEnv('AGENT_AUTOPILOT_ENABLED', false)) return null;
  if (timer) return timer;

  const intervalMinutes = Math.max(intEnv('AGENT_AUTOPILOT_INTERVAL_MINUTES', 60), 5);
  const userId = intEnv('AGENT_AUTOPILOT_USER_ID', null);

  timer = setInterval(() => {
    runProactiveSweep({ userId }).catch((err) => {
      console.error('[agent-autopilot] sweep error:', err);
    });
  }, intervalMinutes * 60 * 1000);

  timer.unref?.();
  console.log(`  Agent autopilot activo cada ${intervalMinutes} minutos`);
  return timer;
}

function stopProactiveAgentLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  runProactiveSweep,
  startProactiveAgentLoop,
  stopProactiveAgentLoop,
};
