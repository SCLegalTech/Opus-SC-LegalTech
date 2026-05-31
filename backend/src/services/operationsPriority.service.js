const db = require('../config/db');
const { buildCasesFilter } = require('../middleware/authz');

const WEIGHTS = {
  overdue_deadline: 35,
  critical_upcoming_deadline: 28,
  upcoming_deadline: 16,
  overdue_task: 14,
  open_task: 3,
  missing_next_action: 22,
  next_action_overdue: 18,
  response_deadline_overdue: 24,
  response_deadline_soon: 12,
  unclassified_drive_file: 5,
  recent_gmail_message: 4,
};

let dailyTimer = null;
let dailyRunning = false;

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw));
}

function clamp(value, max) {
  return Math.min(Number(value || 0), max);
}

function daysUntil(value) {
  if (!value) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return Math.ceil((date - today) / (1000 * 60 * 60 * 24));
}

function scoreRow(row) {
  const reasons = [];
  let score = 0;

  const overdueDeadlines = Number(row.overdue_deadlines || 0);
  if (overdueDeadlines) {
    const points = clamp(overdueDeadlines, 3) * WEIGHTS.overdue_deadline;
    score += points;
    reasons.push({ code: 'overdue_deadlines', label: 'Vencimientos vencidos', count: overdueDeadlines, points });
  }

  const criticalUpcoming = Number(row.critical_upcoming_deadlines || 0);
  if (criticalUpcoming) {
    const points = clamp(criticalUpcoming, 3) * WEIGHTS.critical_upcoming_deadline;
    score += points;
    reasons.push({ code: 'critical_upcoming_deadlines', label: 'Vencimientos criticos proximos', count: criticalUpcoming, points });
  }

  const upcomingDeadlines = Number(row.upcoming_deadlines || 0);
  if (upcomingDeadlines) {
    const points = clamp(upcomingDeadlines, 4) * WEIGHTS.upcoming_deadline;
    score += points;
    reasons.push({ code: 'upcoming_deadlines', label: 'Vencimientos proximos', count: upcomingDeadlines, points });
  }

  const overdueTasks = Number(row.overdue_tasks || 0);
  if (overdueTasks) {
    const points = clamp(overdueTasks, 5) * WEIGHTS.overdue_task;
    score += points;
    reasons.push({ code: 'overdue_tasks', label: 'Tareas vencidas', count: overdueTasks, points });
  }

  const openTasks = Number(row.open_tasks || 0);
  if (openTasks) {
    const points = clamp(openTasks, 5) * WEIGHTS.open_task;
    score += points;
    reasons.push({ code: 'open_tasks', label: 'Carga pendiente abierta', count: openTasks, points });
  }

  if (!row.next_action || !String(row.next_action).trim()) {
    score += WEIGHTS.missing_next_action;
    reasons.push({ code: 'missing_next_action', label: 'Caso sin siguiente accion definida', count: 1, points: WEIGHTS.missing_next_action });
  }

  const nextActionDays = daysUntil(row.next_action_date);
  if (nextActionDays !== null && nextActionDays < 0) {
    score += WEIGHTS.next_action_overdue;
    reasons.push({ code: 'next_action_overdue', label: 'Siguiente accion vencida', count: 1, points: WEIGHTS.next_action_overdue });
  }

  const responseDays = daysUntil(row.response_deadline);
  if (responseDays !== null && responseDays < 0) {
    score += WEIGHTS.response_deadline_overdue;
    reasons.push({ code: 'response_deadline_overdue', label: 'Plazo de respuesta vencido', count: 1, points: WEIGHTS.response_deadline_overdue });
  } else if (responseDays !== null && responseDays <= 3) {
    score += WEIGHTS.response_deadline_soon;
    reasons.push({ code: 'response_deadline_soon', label: 'Plazo de respuesta cercano', count: 1, points: WEIGHTS.response_deadline_soon });
  }

  const unclassifiedDriveFiles = Number(row.unclassified_drive_files || 0);
  if (unclassifiedDriveFiles) {
    const points = clamp(unclassifiedDriveFiles, 6) * WEIGHTS.unclassified_drive_file;
    score += points;
    reasons.push({ code: 'unclassified_drive_files', label: 'Archivos Drive sin clasificar', count: unclassifiedDriveFiles, points });
  }

  const recentGmailMessages = Number(row.recent_gmail_messages || 0);
  if (recentGmailMessages) {
    const points = clamp(recentGmailMessages, 5) * WEIGHTS.recent_gmail_message;
    score += points;
    reasons.push({ code: 'recent_gmail_messages', label: 'Correos recientes asociados', count: recentGmailMessages, points });
  }

  const band = score >= 100 ? 'critica' : score >= 60 ? 'alta' : score >= 30 ? 'media' : 'baja';
  return { score, band, reasons: reasons.sort((a, b) => b.points - a.points) };
}

function toPositiveInt(value, fallback, max = null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  const integer = Math.trunc(parsed);
  return max ? Math.min(integer, max) : integer;
}

function toNonNegativeInt(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.trunc(parsed);
}

function buildPriorityPayload(rows, { limit = 100, offset = 0 } = {}) {
  const allItems = rows
    .map((row) => {
      const priority = scoreRow(row);
      return {
        case_id: row.id,
        uuid: row.uuid,
        case_number: row.case_number,
        title: row.title,
        client_name: row.client_name,
        assigned_to_name: row.assigned_to_name,
        service_type: row.service_type,
        status: row.status,
        next_action: row.next_action,
        next_action_date: row.next_action_date,
        response_deadline: row.response_deadline,
        updated_at: row.updated_at,
        priority_score: priority.score,
        priority_band: priority.band,
        reasons: priority.reasons,
        metrics: {
          open_tasks: Number(row.open_tasks || 0),
          overdue_tasks: Number(row.overdue_tasks || 0),
          overdue_deadlines: Number(row.overdue_deadlines || 0),
          upcoming_deadlines: Number(row.upcoming_deadlines || 0),
          critical_upcoming_deadlines: Number(row.critical_upcoming_deadlines || 0),
          unclassified_drive_files: Number(row.unclassified_drive_files || 0),
          recent_gmail_messages: Number(row.recent_gmail_messages || 0),
        },
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score || new Date(b.updated_at) - new Date(a.updated_at));

  const items = allItems.slice(offset, offset + limit);
  const summary = {
    total: allItems.length,
    returned: items.length,
    limit,
    offset,
    has_more: offset + items.length < allItems.length,
    critica: allItems.filter((item) => item.priority_band === 'critica').length,
    alta: allItems.filter((item) => item.priority_band === 'alta').length,
    media: allItems.filter((item) => item.priority_band === 'media').length,
    baja: allItems.filter((item) => item.priority_band === 'baja').length,
    top_case: allItems[0] || null,
    weights: WEIGHTS,
  };

  return { summary, items };
}

async function getLastPriorityRun() {
  const { rows } = await db.query(
    `SELECT id, user_id, params, result, created_at
     FROM agent_actions
     WHERE action_type = 'operations_priority_score_computed'
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  );
  return rows[0] || null;
}

async function calculatePriorityScore({ user = { id: null, role: 'admin' }, limit = 100, offset = 0, include_archived = false } = {}) {
  const { id: userId, role } = user || {};
  const pageLimit = toPositiveInt(limit, 100, 100);
  const pageOffset = toNonNegativeInt(offset, 0);
  const scope = buildCasesFilter(userId, role);
  const params = [...scope.params];
  const where = [];

  if (scope.clause) where.push(scope.clause);
  if (!String(include_archived).match(/^(true|1)$/i)) {
    where.push("c.status NOT IN ('CERRADO', 'ARCHIVADO')");
  }

  const { rows } = await db.query(
    `SELECT
       c.id, c.uuid, c.case_number, c.title, c.service_type, c.status,
       c.next_action, c.next_action_date, c.response_deadline, c.updated_at,
       cl.full_name AS client_name,
       u.name AS assigned_to_name,
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
       COUNT(DISTINCT v.id)
         FILTER (WHERE v.resolved = FALSE
                 AND v.urgency = 'CRITICO'
                 AND v.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days') AS critical_upcoming_deadlines,
       COUNT(DISTINCT f.id)
         FILTER (WHERE COALESCE(f.category, 'sin_clasificar') = 'sin_clasificar') AS unclassified_drive_files,
       COUNT(DISTINCT comm.id)
         FILTER (WHERE comm.type = 'email'
                 AND comm.metadata->>'source' = 'gmail'
                 AND comm.created_at >= NOW() - INTERVAL '14 days') AS recent_gmail_messages
     FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id
     LEFT JOIN users u ON u.id = c.assigned_to
     LEFT JOIN tareas t ON t.case_id = c.id
     LEFT JOIN vencimientos v ON v.case_id = c.id
     LEFT JOIN case_drive_files f ON f.case_id = c.id
     LEFT JOIN communications comm ON comm.case_id = c.id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     GROUP BY c.id, cl.full_name, u.name
     ORDER BY c.updated_at DESC`,
    params
  );

  const payload = buildPriorityPayload(rows, { limit: pageLimit, offset: pageOffset });
  payload.last_run = await getLastPriorityRun();
  return payload;
}

async function runPriorityScore({ user = { id: null, role: 'admin' }, limit = 100, offset = 0, include_archived = false, source = 'manual', organizationId = 1 } = {}) {
  const payload = await calculatePriorityScore({ user, limit, offset, include_archived });
  // Multi-tenant: cuando haya N orgs, este cron deberÃ¡ iterar por organizations
  // y registrar el score por cada una. Hoy single-tenant â†’ org #1.
  const { rows } = await db.withTenantClient(organizationId, async (scoped) => {
    return scoped.query(
      `INSERT INTO agent_actions (
         action_type, case_id, user_id, params, result, status, reversible, created_at
       ) VALUES ($1, NULL, $2, $3::jsonb, $4::jsonb, 'executed', TRUE, NOW())
       RETURNING id, user_id, params, result, created_at`,
      [
        'operations_priority_score_computed',
        user?.id || null,
        JSON.stringify({ source, entity: 'paimon', limit, offset, include_archived }),
        JSON.stringify({
          summary: payload.summary,
          top_cases: payload.items.slice(0, 20),
        }),
      ]
    );
  });
  payload.last_run = rows[0];
  return payload;
}

async function hasRunToday() {
  const { rows } = await db.query(
    `SELECT 1
     FROM agent_actions
     WHERE action_type = 'operations_priority_score_computed'
       AND created_at::date = CURRENT_DATE
     LIMIT 1`
  );
  return Boolean(rows[0]);
}

async function runDailyPriorityScoreIfNeeded() {
  if (dailyRunning) return { skipped: true, reason: 'priority_score_already_running' };
  dailyRunning = true;
  try {
    if (await hasRunToday()) return { skipped: true, reason: 'priority_score_already_ran_today' };
    return await runPriorityScore({
      user: { id: null, role: 'admin' },
      limit: intEnv('OPERATIONS_PRIORITY_SCORE_LIMIT', 100),
      include_archived: false,
      source: 'daily_loop',
    });
  } finally {
    dailyRunning = false;
  }
}

function startDailyPriorityScoreLoop() {
  if (!boolEnv('OPERATIONS_PRIORITY_SCORE_DAILY_ENABLED', true)) return null;
  if (dailyTimer) return dailyTimer;

  const intervalHours = Math.max(intEnv('OPERATIONS_PRIORITY_SCORE_INTERVAL_HOURS', 24), 1);
  setTimeout(() => {
    runDailyPriorityScoreIfNeeded().catch((err) => {
      console.error('[operations-priority] daily score error:', err);
    });
  }, 15000).unref?.();

  dailyTimer = setInterval(() => {
    runDailyPriorityScoreIfNeeded().catch((err) => {
      console.error('[operations-priority] daily score error:', err);
    });
  }, intervalHours * 60 * 60 * 1000);

  dailyTimer.unref?.();
  console.log(`  Paimon priority score diario activo cada ${intervalHours} horas`);
  return dailyTimer;
}

module.exports = {
  WEIGHTS,
  calculatePriorityScore,
  runPriorityScore,
  getLastPriorityRun,
  startDailyPriorityScoreLoop,
  runDailyPriorityScoreIfNeeded,
};
