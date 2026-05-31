/**
 * kaizenMetrics.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Kaizen â€” sistema de mejora continua (plan-estrategico Â§7.9).
 *
 * Convierte la operaciÃ³n diaria en seÃ±ales medibles:
 *   - acciones aceptadas vs rechazadas
 *   - correcciones humanas
 *   - cuellos de botella
 *   - workflows candidatos
 *   - casos sin siguiente acciÃ³n
 *
 * Todas las lecturas son agregaciones sobre tablas append-only o
 * estables (agent_actions, agent_plans, tareas, vencimientos, cases).
 */

const db = require('../config/db');

const DEFAULT_WINDOW_DAYS = 30;

/**
 * @param {object} args
 * @param {number} [args.windowDays]
 * @param {number} args.organizationId  REQUERIDO â€” sin esto las queries
 *   cruzan organizaciones. El controller debe pasarlo siempre.
 */
async function getMetrics({ windowDays = DEFAULT_WINDOW_DAYS, organizationId } = {}) {
  if (!organizationId) {
    throw new Error('kaizenMetrics.getMetrics requiere organizationId');
  }
  const since = new Date(Date.now() - windowDays * 86400000);

  const [
    actionsByStatus,
    actionsByType,
    plansByStatus,
    casesWithoutNextAction,
    overdueTasks,
    overdueDeadlines,
    inboxBacklog,
    topActionTypes,
    recentRejections,
  ] = await Promise.all([
    queryActionsByStatus(since, organizationId),
    queryActionsByType(since, organizationId),
    queryPlansByStatus(since, organizationId),
    queryCasesWithoutNextAction(organizationId),
    queryOverdueTasks(organizationId),
    queryOverdueDeadlines(organizationId),
    queryInboxBacklog(organizationId),
    queryTopActionTypes(since, organizationId),
    queryRecentRejections(since, organizationId),
  ]);

  const total = actionsByStatus.reduce((s, r) => s + r.count, 0);
  const executed = actionsByStatus.find((r) => r.status === 'executed')?.count || 0;
  const rejected = actionsByStatus.find((r) => r.status === 'rejected')?.count || 0;
  const failed   = actionsByStatus.find((r) => r.status === 'failed')?.count || 0;
  const pending  = actionsByStatus.find((r) => r.status === 'pending')?.count || 0;

  const acceptanceRate = total > 0 ? executed / total : null;
  const rejectionRate  = total > 0 ? rejected / total : null;
  const failureRate    = total > 0 ? failed / total : null;

  return {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    agent_health: {
      total_actions: total,
      executed,
      rejected,
      failed,
      pending,
      acceptance_rate: acceptanceRate,
      rejection_rate:  rejectionRate,
      failure_rate:    failureRate,
    },
    actions_by_type: actionsByType,
    plans_by_status: plansByStatus,
    top_action_types: topActionTypes,
    bottlenecks: {
      cases_without_next_action: casesWithoutNextAction,
      overdue_tasks: overdueTasks,
      overdue_deadlines: overdueDeadlines,
      inbox_pending_triage: inboxBacklog,
    },
    recent_rejections: recentRejections,
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Queries
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Todas las queries filtran por organization_id para evitar leak
// cross-organization. agent_actions/agent_plans no tienen organization_id propio
// â†’ se filtra a travÃ©s del case_id JOIN cases.organization_id, con
// fallback a registros globales (case_id IS NULL = del sistema).

async function queryActionsByStatus(since, orgId) {
  const { rows } = await db.query(
    `SELECT a.status, COUNT(*)::int AS count
       FROM agent_actions a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.created_at >= $1
        AND (c.organization_id = $2 OR a.case_id IS NULL)
      GROUP BY a.status
      ORDER BY count DESC`,
    [since, orgId]
  );
  return rows;
}

async function queryActionsByType(since, orgId) {
  const { rows } = await db.query(
    `SELECT a.action_type,
            COUNT(*)::int AS total,
            SUM(CASE WHEN a.status = 'executed' THEN 1 ELSE 0 END)::int AS executed,
            SUM(CASE WHEN a.status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected,
            SUM(CASE WHEN a.status = 'failed'   THEN 1 ELSE 0 END)::int AS failed
       FROM agent_actions a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.created_at >= $1
        AND (c.organization_id = $2 OR a.case_id IS NULL)
      GROUP BY a.action_type
      ORDER BY total DESC
      LIMIT 20`,
    [since, orgId]
  );
  return rows;
}

async function queryTopActionTypes(since, orgId) {
  const { rows } = await db.query(
    `SELECT a.action_type, COUNT(*)::int AS count
       FROM agent_actions a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.created_at >= $1
        AND (c.organization_id = $2 OR a.case_id IS NULL)
      GROUP BY a.action_type
      ORDER BY count DESC
      LIMIT 5`,
    [since, orgId]
  );
  return rows;
}

async function queryPlansByStatus(since, orgId) {
  try {
    const { rows } = await db.query(
      `SELECT p.status, COUNT(*)::int AS count
         FROM agent_plans p
         LEFT JOIN cases c ON c.id = p.case_id
        WHERE p.created_at >= $1
          AND (c.organization_id = $2 OR p.case_id IS NULL)
        GROUP BY p.status`,
      [since, orgId]
    );
    return rows;
  } catch {
    return [];
  }
}

async function queryCasesWithoutNextAction(orgId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM cases
      WHERE organization_id = $1
        AND (next_action IS NULL OR next_action = '')
        AND status NOT IN ('CERRADO', 'ARCHIVADO')`,
    [orgId]
  );
  return rows[0]?.count || 0;
}

async function queryOverdueTasks(orgId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM tareas t
         LEFT JOIN cases c ON c.id = t.case_id
        WHERE t.due_date < CURRENT_DATE
          AND t.status NOT IN ('COMPLETADA', 'CANCELADA')
          AND (c.organization_id = $1 OR t.case_id IS NULL)`,
      [orgId]
    );
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function queryOverdueDeadlines(orgId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM vencimientos
        WHERE organization_id = $1
          AND due_date < CURRENT_DATE
          AND resolved = FALSE`,
      [orgId]
    );
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function queryInboxBacklog(orgId) {
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM inbox_triage
        WHERE status = 'pending'
          AND organization_id = $1`,
      [orgId]
    );
    return rows[0]?.count || 0;
  } catch {
    return 0;
  }
}

async function queryRecentRejections(since, orgId) {
  const { rows } = await db.query(
    `SELECT a.action_type, a.created_at, a.params, a.result
       FROM agent_actions a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.status IN ('rejected', 'failed')
        AND a.created_at >= $1
        AND (c.organization_id = $2 OR a.case_id IS NULL)
      ORDER BY a.created_at DESC
      LIMIT 10`,
    [since, orgId]
  );
  return rows;
}

module.exports = { getMetrics };
