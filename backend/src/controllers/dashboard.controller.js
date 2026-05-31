const db = require('../config/db');
const { buildCasesFilter, buildClientsFilter } = require('../middleware/authz');

// ──────────────────────────────────────────────────────────
// GET /dashboard/stats
// Métricas generales de la firma
// ──────────────────────────────────────────────────────────
const getStats = async (req, res) => {
  const { id: userId, role } = req.user;
  const admin = role === 'admin';
  const scope = buildCasesFilter(userId, role);
  const clientScope = buildClientsFilter(req.user, 'cl');

  // Fragmento WHERE para filtrar casos del usuario (con join a macrocasos ya incluido)
  const caseWhere = scope.clause
    ? `WHERE ${scope.clause}`
    : '';
  const caseAnd = scope.clause
    ? `AND ${scope.clause}`
    : '';
  const sp = scope.params; // [userId, userId, userId] or []

  try {
    const [cases, clients, revenue, byStatus, byType, openDeadlines, openTasks, activeResult] =
      await Promise.all([
        db.query(
          `SELECT COUNT(*) FROM cases c LEFT JOIN macrocasos _m ON c.macrocaso_id=_m.id ${caseWhere}`,
          sp
        ),
        db.query(
          `SELECT COUNT(*) FROM clients cl WHERE cl.active = TRUE ${clientScope.clause ? `AND ${clientScope.clause}` : ''}`,
          clientScope.params
        ),
        db.query(`
          SELECT
            COALESCE(SUM(fee), 0)                                        AS total,
            COALESCE(SUM(CASE WHEN fee_paid THEN fee ELSE 0 END), 0)     AS paid,
            COALESCE(SUM(CASE WHEN NOT fee_paid THEN fee ELSE 0 END), 0) AS pending
          FROM cases c LEFT JOIN macrocasos _m ON c.macrocaso_id=_m.id ${caseWhere}
        `, sp),
        db.query(`
          SELECT c.status, COUNT(*) AS count
          FROM cases c LEFT JOIN macrocasos _m ON c.macrocaso_id=_m.id
          ${caseWhere} GROUP BY c.status ORDER BY count DESC
        `, sp),
        db.query(`
          SELECT c.service_type, COUNT(*) AS count,
                 SUM(fee) AS total_fees,
                 SUM(CASE WHEN fee_paid THEN fee ELSE 0 END) AS paid_fees
          FROM cases c LEFT JOIN macrocasos _m ON c.macrocaso_id=_m.id
          ${caseWhere} GROUP BY c.service_type ORDER BY count DESC
        `, sp),
        db.query(`
          SELECT
            COUNT(*) AS count,
            COUNT(*) FILTER (WHERE v.urgency = 'CRITICO')     AS criticos,
            COUNT(*) FILTER (WHERE v.due_date < CURRENT_DATE) AS vencidos
          FROM vencimientos v
          JOIN cases c ON v.case_id = c.id
          LEFT JOIN macrocasos _m ON c.macrocaso_id = _m.id
          WHERE v.resolved = FALSE AND v.due_date <= CURRENT_DATE + INTERVAL '7 days'
          ${caseAnd}
        `, sp),
        db.query(`
          SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE t.status = 'EN_CURSO') AS en_curso,
            COUNT(*) FILTER (WHERE t.due_date < CURRENT_DATE AND t.status NOT IN ('COMPLETADA','CANCELADA')) AS vencidas
          FROM tareas t
          LEFT JOIN cases c ON t.case_id = c.id
          LEFT JOIN macrocasos _m ON c.macrocaso_id = _m.id
          WHERE t.status NOT IN ('COMPLETADA','CANCELADA')
          ${admin ? '' : `AND (t.assigned_to = $1 OR t.created_by = $2 OR (t.case_id IS NOT NULL AND (
            c.assigned_to = $3 OR c.created_by = $4 OR EXISTS (
              SELECT 1 FROM macrocasos _tm WHERE _tm.id = c.macrocaso_id AND _tm.lead_lawyer = $5
            )
          )))`}
        `, admin ? [] : [userId, userId, userId, userId, userId]),
        db.query(
          `SELECT COUNT(*) FROM cases c LEFT JOIN macrocasos _m ON c.macrocaso_id=_m.id
           WHERE c.status NOT IN ('CERRADO', 'ARCHIVADO') ${caseAnd}`,
          sp
        ),
      ]);

    const byStatusRows = byStatus.rows.map((row) => ({
      ...row,
      count: parseInt(row.count, 10),
    }));
    const byTypeRows = byType.rows.map((row) => ({
      ...row,
      count: parseInt(row.count, 10),
      total_fees: parseFloat(row.total_fees || 0),
      paid_fees: parseFloat(row.paid_fees || 0),
    }));

    res.json({
      total_cases:   parseInt(cases.rows[0].count),
      total_clients: parseInt(clients.rows[0].count),
      active_cases:  parseInt(activeResult.rows[0].count),
      revenue: {
        total:   parseFloat(revenue.rows[0].total),
        paid:    parseFloat(revenue.rows[0].paid),
        pending: parseFloat(revenue.rows[0].pending),
      },
      by_status:       byStatusRows,
      by_service_type: byTypeRows,
      deadlines: {
        open:     parseInt(openDeadlines.rows[0].count),
        criticos: parseInt(openDeadlines.rows[0].criticos),
        vencidos: parseInt(openDeadlines.rows[0].vencidos),
      },
      tasks: {
        open:     parseInt(openTasks.rows[0].total),
        en_curso: parseInt(openTasks.rows[0].en_curso),
        vencidas: parseInt(openTasks.rows[0].vencidas),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /dashboard/bandeja
// Bandeja del día: tareas + vencimientos proximos (3/7 dias)
// ──────────────────────────────────────────────────────────
const getBandeja = async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    // Admin puede ver bandeja global o filtrar; non-admin siempre ve la suya
    const targetId = role === 'admin' && req.query.user_id
      ? parseInt(req.query.user_id)
      : userId;
    const { rows } = await db.query(
      'SELECT * FROM v_bandeja_hoy WHERE user_id = $1',
      [targetId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo bandeja' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /dashboard/actuaciones-pendientes
// Proximas actuaciones sin completar
// ──────────────────────────────────────────────────────────
const getActuacionesPendientes = async (req, res) => {
  const { limit = 20 } = req.query;
  const { id: userId, role } = req.user;
  try {
    const targetId = role === 'admin' && req.query.user_id
      ? parseInt(req.query.user_id)
      : userId;
    const { rows } = await db.query(
      'SELECT * FROM v_actuaciones_pendientes WHERE user_id = $1 LIMIT $2',
      [targetId, parseInt(limit)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo actuaciones pendientes' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /dashboard/casos-activos
// Casos activos con contadores de tareas/vencimientos
// ──────────────────────────────────────────────────────────
const getCasosActivos = async (req, res) => {
  const { limit = 30 } = req.query;
  const { id: userId, role } = req.user;
  try {
    // Admin puede ver todos o filtrar; non-admin siempre ve su cartera
    const scope = buildCasesFilter(userId, role);
    const limitParam = scope.params.length + 1;
    const { rows } = await db.query(`
      SELECT v.* FROM v_casos_activos v
      JOIN cases c ON c.id = v.id
      LEFT JOIN macrocasos _m ON c.macrocaso_id = _m.id
      ${scope.clause ? `WHERE ${scope.clause}` : ''}
      LIMIT $${limitParam}
    `, [...scope.params, parseInt(limit)]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo casos activos' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /dashboard/carga-abogados
// Distribucion de carga por abogado (casos, tareas, vencimientos)
// ──────────────────────────────────────────────────────────
const getCargaAbogados = async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Solo disponible para administradores' });
  }
  try {
    const { rows } = await db.query(`
      SELECT
        u.id,
        u.name,
        u.role,
        COUNT(DISTINCT c.id)  FILTER (WHERE c.status NOT IN ('CERRADO','ARCHIVADO'))           AS casos_activos,
        COUNT(DISTINCT t.id)  FILTER (WHERE t.status NOT IN ('COMPLETADA','CANCELADA'))        AS tareas_pendientes,
        COUNT(DISTINCT v.id)  FILTER (
          WHERE v.resolved = FALSE AND v.due_date <= CURRENT_DATE + INTERVAL '7 days'
        ) AS vencimientos_proximos,
        COUNT(DISTINCT v2.id) FILTER (
          WHERE v2.resolved = FALSE AND v2.due_date < CURRENT_DATE
        ) AS vencimientos_vencidos
      FROM users u
      LEFT JOIN cases       c  ON c.assigned_to  = u.id
      LEFT JOIN tareas      t  ON t.assigned_to  = u.id
      LEFT JOIN vencimientos v  ON v.case_id = c.id
      LEFT JOIN vencimientos v2 ON v2.case_id = c.id
      WHERE u.active = TRUE AND u.role IN ('lawyer','admin')
      GROUP BY u.id, u.name, u.role
      ORDER BY casos_activos DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo carga de abogados' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /dashboard/recent  (compatibilidad v1)
// ──────────────────────────────────────────────────────────
const getRecentCases = async (req, res) => {
  const { id: userId, role } = req.user;
  try {
    const scope = buildCasesFilter(userId, role);
    const { rows } = await db.query(`
      SELECT c.id, c.case_number, c.title, c.service_type, c.status,
             c.fee, c.fee_paid, c.created_at,
             c.next_action, c.next_action_date,
             cl.full_name AS client_name
      FROM cases c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN macrocasos _m ON c.macrocaso_id = _m.id
      ${scope.clause ? `WHERE ${scope.clause}` : ''}
      ORDER BY c.created_at DESC
      LIMIT 10
    `, scope.params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo casos recientes' });
  }
};

module.exports = {
  getStats,
  getBandeja,
  getActuacionesPendientes,
  getCasosActivos,
  getCargaAbogados,
  getRecentCases,
};
