const db = require('../config/db');

// ──────────────────────────────────────────────────────────
// GET /cases/:caseId/vencimientos
// ──────────────────────────────────────────────────────────
const getVencimientosByCaso = async (req, res) => {
  const { caseId } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT v.*,
             CASE
               WHEN v.resolved = FALSE AND v.due_date < CURRENT_DATE THEN 'CRITICO'
               WHEN v.resolved = FALSE AND v.due_date <= CURRENT_DATE + INTERVAL '3 days'
                    AND v.urgency IN ('BAJO', 'MEDIO') THEN 'ALTO'
               ELSE v.urgency
             END AS effective_urgency,
             CASE
               WHEN v.resolved = FALSE AND v.due_date < CURRENT_DATE THEN 'overdue'
               WHEN v.resolved = FALSE AND v.due_date <= CURRENT_DATE + INTERVAL '3 days'
                    AND v.urgency IN ('BAJO', 'MEDIO') THEN 'upcoming_soon'
               ELSE 'stored'
             END AS urgency_reason,
             t.title AS tarea_title,
             a.title AS actuacion_title
      FROM vencimientos v
      LEFT JOIN tareas t     ON v.tarea_id = t.id
      LEFT JOIN actuaciones a ON v.actuacion_id = a.id
      WHERE v.case_id = $1
      ORDER BY v.due_date ASC, v.urgency DESC
    `, [caseId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo vencimientos' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /vencimientos  (próximos N días, por usuario)
// ──────────────────────────────────────────────────────────
const getVencimientosProximos = async (req, res) => {
  const { days = 14 } = req.query;
  const { id: userId, role } = req.user;
  try {
    const conditions = [
      `v.resolved = FALSE`,
      `v.due_date <= CURRENT_DATE + INTERVAL '${parseInt(days)} days'`,
    ];
    const params = [];
    let i = 1;

    if (role !== 'admin') {
      conditions.push(`(c.assigned_to = $${i} OR c.created_by = $${i + 1} OR EXISTS (
        SELECT 1 FROM macrocasos _m WHERE _m.id = c.macrocaso_id AND _m.lead_lawyer = $${i + 2}
      ))`);
      params.push(userId, userId, userId);
      i += 3;
    }

    const { rows } = await db.query(`
      SELECT
        v.*,
        c.case_number, c.title AS case_title, c.assigned_to,
        u.name AS assigned_to_name,
        CURRENT_DATE - v.due_date AS days_overdue,
        CASE
          WHEN v.due_date < CURRENT_DATE THEN 'CRITICO'
          WHEN v.due_date <= CURRENT_DATE + INTERVAL '3 days'
               AND v.urgency IN ('BAJO', 'MEDIO') THEN 'ALTO'
          ELSE v.urgency
        END AS effective_urgency,
        CASE
          WHEN v.due_date < CURRENT_DATE THEN 'overdue'
          WHEN v.due_date <= CURRENT_DATE + INTERVAL '3 days'
               AND v.urgency IN ('BAJO', 'MEDIO') THEN 'upcoming_soon'
          ELSE 'stored'
        END AS urgency_reason
      FROM vencimientos v
      JOIN cases c ON v.case_id = c.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY v.due_date ASC, v.urgency DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo vencimientos próximos' });
  }
};

// ──────────────────────────────────────────────────────────
// POST /cases/:caseId/vencimientos
// ──────────────────────────────────────────────────────────
const createVencimiento = async (req, res) => {
  const { caseId } = req.params;
  const { title, due_date, urgency, tarea_id, actuacion_id } = req.body;

  if (!title || !due_date) return res.status(400).json({ error: 'Título y fecha son requeridos' });

  try {
    const { rows } = await db.query(`
      INSERT INTO vencimientos (case_id, tarea_id, actuacion_id, title, due_date, urgency, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [caseId, tarea_id || null, actuacion_id || null,
        title, due_date, urgency || 'MEDIO', req.user.id]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando vencimiento' });
  }
};

// ──────────────────────────────────────────────────────────
// PUT /vencimientos/:id/resolve
// ──────────────────────────────────────────────────────────
const resolveVencimiento = async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await db.query(`
      UPDATE vencimientos
      SET resolved = TRUE, resolved_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [id]);

    if (!rows.length) return res.status(404).json({ error: 'Vencimiento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error resolviendo vencimiento' });
  }
};

module.exports = {
  getVencimientosByCaso,
  getVencimientosProximos,
  createVencimiento,
  resolveVencimiento
};
