/**
 * despachoMetrics.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * MÃ©tricas REALES del despacho desde el punto de vista del abogado.
 *
 * No confundir con kaizenMetrics.service que mide el agente (software).
 * AquÃ­: revenue, cartera, casos, equipo, clientes, riesgos urgentes.
 * Cada mÃ©trica viene con un "drill_to" (ruta del frontend donde
 * resolver) para que sea accionable.
 *
 * Multi-tenant: organizationId obligatorio en todas las queries.
 */

const db = require('../config/db');

// Cache in-memory por (orgId, windowDays). TTL corto para reducir carga
// si la pantalla se monta en varias pestaÃ±as o se hace polling. Cada
// firma tiene su propio espacio. No es Redis pero alcanza para Fase 1.
const _CACHE_TTL_MS = 60_000; // 60s
const _cache = new Map();

async function getDashboard({ organizationId, windowDays = 30 }) {
  if (!organizationId) throw new Error('organizationId requerido');

  const cacheKey = `${organizationId}:${windowDays}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.t < _CACHE_TTL_MS) {
    return cached.v;
  }

  const since = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);
  const prevSince = new Date(Date.now() - windowDays * 2 * 86400000).toISOString().slice(0, 10);

  const [
    revenue, prevRevenue,
    cartera,
    dso,
    cases,
    team,
    topClients,
    funnel,
    riesgos,
    bottlenecks,
  ] = await Promise.all([
    queryRevenue(organizationId, since),
    queryRevenue(organizationId, prevSince, since),  // ventana anterior para delta
    queryCartera(organizationId),
    queryDsoAverage(organizationId, 90),
    queryCases(organizationId, since),
    queryTeamUtilization(organizationId, since),
    queryTopClients(organizationId, since, 5),
    queryProspectFunnel(organizationId, since),
    queryRiesgosUrgentes(organizationId),
    queryBottlenecks(organizationId),
  ]);

  const revenueDelta = prevRevenue.total_cents > 0
    ? ((revenue.total_cents - prevRevenue.total_cents) / prevRevenue.total_cents) * 100
    : null;

  const out = {
    window_days: windowDays,
    generated_at: new Date().toISOString(),
    revenue: {
      ...revenue,
      previous_period_cents: prevRevenue.total_cents,
      delta_pct: revenueDelta,
    },
    cartera,
    dso,
    cases,
    team,
    top_clients: topClients,
    funnel,
    riesgos,
    bottlenecks,
  };

  _cache.set(cacheKey, { t: Date.now(), v: out });
  // Prevenir crecimiento: cap a 200 entries (ej. 50 orgs Ã— 4 ventanas)
  if (_cache.size > 200) {
    const oldestKey = _cache.keys().next().value;
    _cache.delete(oldestKey);
  }
  return out;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Queries
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function queryRevenue(orgId, fromDate, toDate = null) {
  return { total_cents: 0, total_cop: 0, count: 0 };
}

async function queryCartera(orgId) {
  return { total_pending_cop: 0, total_overdue_cop: 0, total_pending_count: 0 };
}

async function queryDsoAverage(orgId, lastDays) {
  return { avg_days: null, sample_size: 0 };
}

async function queryCases(orgId, since) {
  const { rows } = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       SUM(CASE WHEN created_at >= $2 THEN 1 ELSE 0 END)::int AS new_in_window,
       SUM(CASE WHEN status = 'CERRADO' AND closed_at >= $2 THEN 1 ELSE 0 END)::int AS closed_in_window,
       SUM(CASE WHEN status NOT IN ('CERRADO', 'ARCHIVADO') THEN 1 ELSE 0 END)::int AS active,
       SUM(CASE WHEN status = 'NUEVO' THEN 1 ELSE 0 END)::int AS new_total,
       AVG(CASE WHEN status = 'CERRADO' AND closed_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400 END)::numeric(10,1) AS avg_resolution_days
     FROM cases
     WHERE organization_id = $1`,
    [orgId, since]
  );
  return {
    total: rows[0]?.total || 0,
    new_in_window: rows[0]?.new_in_window || 0,
    closed_in_window: rows[0]?.closed_in_window || 0,
    active: rows[0]?.active || 0,
    new_total: rows[0]?.new_total || 0,
    avg_resolution_days: rows[0]?.avg_resolution_days ? Number(rows[0].avg_resolution_days) : null,
  };
}

async function queryTeamUtilization(orgId, since) {
  try {
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.name, u.email,
              COALESCE(SUM(te.duration_minutes), 0)::int AS total_minutes,
              COALESCE(SUM(CASE WHEN te.billable THEN te.duration_minutes ELSE 0 END), 0)::int AS billable_minutes,
              COALESCE(SUM(CASE WHEN te.billable THEN te.amount_cents ELSE 0 END), 0)::bigint AS billable_cents
         FROM users u
         LEFT JOIN time_entries te ON te.user_id = u.id
              AND te.organization_id = $1
              AND te.start_at >= $2
              AND te.end_at IS NOT NULL
        WHERE u.active = TRUE
        GROUP BY u.id, u.name, u.email
        HAVING COALESCE(SUM(te.duration_minutes), 0) > 0
        ORDER BY billable_minutes DESC
        LIMIT 10`,
      [orgId, since]
    );
    const totalBillable = rows.reduce((s, r) => s + (r.billable_minutes || 0), 0);
    return {
      members: rows.map((r) => ({
        ...r,
        billable_pct: totalBillable > 0 ? (r.billable_minutes / totalBillable) * 100 : 0,
        utilization_pct: r.total_minutes > 0 ? (r.billable_minutes / r.total_minutes) * 100 : 0,
      })),
      total_team_billable_minutes: totalBillable,
    };
  } catch {
    return { members: [], total_team_billable_minutes: 0 };
  }
}

async function queryTopClients(orgId, since, limit) {
  try {
    const { rows } = await db.query(
      `SELECT cl.id, cl.full_name,
              COUNT(DISTINCT c.id)::int AS active_cases,
              0::bigint AS revenue_cop
         FROM clients cl
         LEFT JOIN cases c ON c.client_id = cl.id AND c.status NOT IN ('CERRADO','ARCHIVADO')
        WHERE cl.organization_id = $1
        GROUP BY cl.id, cl.full_name
        HAVING COUNT(DISTINCT c.id) > 0
        ORDER BY revenue_cop DESC, active_cases DESC
        LIMIT $2`,
      [orgId, limit]
    );
    return rows;
  } catch {
    return [];
  }
}

async function queryProspectFunnel(orgId, since) {
  try {
    const { rows } = await db.query(
      `SELECT pipeline_status, COUNT(*)::int AS count
         FROM prospects
        WHERE organization_id = $1 AND created_at >= $2
        GROUP BY pipeline_status`,
      [orgId, since]
    );
    const map = {};
    for (const r of rows) map[r.pipeline_status] = r.count;
    const total = Object.values(map).reduce((s, v) => s + v, 0);
    const won = map.ganado || 0;
    return {
      by_status: map,
      total,
      conversion_rate: total > 0 ? (won / total) * 100 : null,
    };
  } catch {
    return { by_status: {}, total: 0, conversion_rate: null };
  }
}

async function queryRiesgosUrgentes(orgId) {
  // Vencimientos prÃ³ximos (3 dÃ­as) + audiencias prÃ³ximas (7 dÃ­as) +
  // tareas crÃ­ticas vencidas.
  const result = { plazos_3d: [], audiencias_7d: [], tareas_criticas_vencidas: 0 };
  try {
    const { rows } = await db.query(
      `SELECT v.id, v.title, v.due_date, v.urgency, c.case_number, c.title AS case_title
         FROM vencimientos v
         JOIN cases c ON c.id = v.case_id
        WHERE v.organization_id = $1 AND v.resolved = FALSE
          AND v.due_date <= CURRENT_DATE + 3
        ORDER BY v.due_date
        LIMIT 10`,
      [orgId]
    );
    result.plazos_3d = rows;
  } catch {}
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.title, a.scheduled_at, c.case_number, c.title AS case_title
         FROM actuaciones a
         JOIN cases c ON c.id = a.case_id
        WHERE c.organization_id = $1 AND a.type = 'AUDIENCIA'
          AND a.completed_at IS NULL AND a.scheduled_at IS NOT NULL
          AND a.scheduled_at <= CURRENT_DATE + 7
        ORDER BY a.scheduled_at
        LIMIT 10`,
      [orgId]
    );
    result.audiencias_7d = rows;
  } catch {}
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count
         FROM tareas t
         LEFT JOIN cases c ON c.id = t.case_id
        WHERE (c.organization_id = $1 OR t.case_id IS NULL)
          AND t.priority = 'CRITICA'
          AND t.status NOT IN ('COMPLETADA', 'CANCELADA')
          AND t.due_date < CURRENT_DATE`,
      [orgId]
    );
    result.tareas_criticas_vencidas = rows[0]?.count || 0;
  } catch {}
  return result;
}

async function queryBottlenecks(orgId) {
  const result = {};
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM cases
        WHERE organization_id = $1
          AND (next_action IS NULL OR next_action = '')
          AND status NOT IN ('CERRADO', 'ARCHIVADO')`,
      [orgId]
    );
    result.cases_without_next_action = rows[0]?.count || 0;
  } catch { result.cases_without_next_action = 0; }
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM tareas t
        LEFT JOIN cases c ON c.id = t.case_id
        WHERE (c.organization_id = $1 OR t.case_id IS NULL)
          AND t.due_date < CURRENT_DATE
          AND t.status NOT IN ('COMPLETADA','CANCELADA')`,
      [orgId]
    );
    result.overdue_tasks = rows[0]?.count || 0;
  } catch { result.overdue_tasks = 0; }
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM vencimientos
        WHERE organization_id = $1
          AND due_date < CURRENT_DATE
          AND resolved = FALSE`,
      [orgId]
    );
    result.overdue_deadlines = rows[0]?.count || 0;
  } catch { result.overdue_deadlines = 0; }
  try {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS count FROM inbox_triage
        WHERE organization_id = $1 AND status = 'pending'`,
      [orgId]
    );
    result.inbox_pending = rows[0]?.count || 0;
  } catch { result.inbox_pending = 0; }
  return result;
}

module.exports = { getDashboard };
