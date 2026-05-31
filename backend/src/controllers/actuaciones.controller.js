const db = require('../config/db');

// ──────────────────────────────────────────────────────────
// GET /cases/:caseId/actuaciones
// ──────────────────────────────────────────────────────────
const getActuaciones = async (req, res) => {
  const { caseId } = req.params;
  try {
    const { rows } = await db.query(`
      SELECT a.*, u.name AS created_by_name
      FROM actuaciones a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.case_id = $1
      ORDER BY a.scheduled_at ASC NULLS LAST, a.created_at ASC
    `, [caseId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo actuaciones' });
  }
};

// ──────────────────────────────────────────────────────────
// POST /cases/:caseId/actuaciones
// ──────────────────────────────────────────────────────────
const createActuacion = async (req, res) => {
  const { caseId } = req.params;
  const { type, title, description, scheduled_at, radicado } = req.body;

  if (!title) return res.status(400).json({ error: 'El título es requerido' });

  try {
    // Verificar que el caso existe
    const { rows: caseRows } = await db.query('SELECT id FROM cases WHERE id = $1', [caseId]);
    if (!caseRows.length) return res.status(404).json({ error: 'Caso no encontrado' });

    const { rows } = await db.query(`
      INSERT INTO actuaciones (case_id, type, title, description, scheduled_at, radicado, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [caseId, type || 'SEGUIMIENTO', title, description || null,
        scheduled_at || null, radicado || null, req.user.id]);

    // Si tiene fecha, crear vencimiento automático
    if (scheduled_at) {
      const daysUntil = Math.ceil((new Date(scheduled_at) - new Date()) / (1000 * 60 * 60 * 24));
      const urgency = daysUntil <= 2 ? 'CRITICO' : daysUntil <= 5 ? 'ALTO' : daysUntil <= 10 ? 'MEDIO' : 'BAJO';
      await db.query(`
        INSERT INTO vencimientos (case_id, actuacion_id, title, due_date, urgency, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [caseId, rows[0].id, title, scheduled_at, urgency, req.user.id]);
    }

    // Log en communications del caso
    await db.query(`
      INSERT INTO communications (case_id, type, content, created_by)
      VALUES ($1, 'system', $2, $3)
    `, [caseId, `Actuación registrada: [${rows[0].type}] ${title}${scheduled_at ? ' · ' + new Date(scheduled_at).toLocaleDateString('es-CO') : ''}`, req.user.id]);

    // Emitir evento workflow
    await db.query(`
      INSERT INTO workflow_events (direction, event_type, source, case_id, payload)
      VALUES ('outbound', 'actuacion.created', 'api', $1, $2)
    `, [caseId, JSON.stringify({ actuacion_id: rows[0].id, type: rows[0].type, title, scheduled_at })]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando actuación' });
  }
};

// ──────────────────────────────────────────────────────────
// PUT /cases/:caseId/actuaciones/:id
// ──────────────────────────────────────────────────────────
const updateActuacion = async (req, res) => {
  const { caseId, id } = req.params;
  const { type, title, description, scheduled_at, completed_at, result, radicado } = req.body;

  try {
    const { rows: current } = await db.query(
      'SELECT * FROM actuaciones WHERE id = $1 AND case_id = $2', [id, caseId]
    );
    if (!current.length) return res.status(404).json({ error: 'Actuación no encontrada' });

    const prev = current[0];
    const wasCompleted = !prev.completed_at && completed_at;

    const { rows } = await db.query(`
      UPDATE actuaciones SET
        type         = COALESCE($1, type),
        title        = COALESCE($2, title),
        description  = COALESCE($3, description),
        scheduled_at = COALESCE($4, scheduled_at),
        completed_at = COALESCE($5, completed_at),
        result       = COALESCE($6, result),
        radicado     = COALESCE($7, radicado),
        updated_at   = NOW()
      WHERE id = $8 AND case_id = $9
      RETURNING *
    `, [type, title, description, scheduled_at, completed_at, result, radicado, id, caseId]);

    // Si se marcó como completada → resolver el vencimiento asociado
    if (wasCompleted) {
      await db.query(`
        UPDATE vencimientos
        SET resolved = TRUE, resolved_at = NOW()
        WHERE actuacion_id = $1 AND resolved = FALSE
      `, [id]);

      await db.query(`
        INSERT INTO communications (case_id, type, content, created_by)
        VALUES ($1, 'system', $2, $3)
      `, [caseId, `Actuación completada: ${rows[0].title}${result ? ' · ' + result : ''}`, req.user.id]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando actuación' });
  }
};

// ──────────────────────────────────────────────────────────
// DELETE /cases/:caseId/actuaciones/:id
// ──────────────────────────────────────────────────────────
const deleteActuacion = async (req, res) => {
  const { caseId, id } = req.params;
  try {
    const { rows } = await db.query(
      'SELECT * FROM actuaciones WHERE id = $1 AND case_id = $2', [id, caseId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Actuación no encontrada' });
    if (rows[0].completed_at)
      return res.status(400).json({ error: 'No se puede eliminar una actuación ya completada' });

    // Eliminar vencimientos asociados primero
    await db.query('DELETE FROM vencimientos WHERE actuacion_id = $1', [id]);
    await db.query('DELETE FROM actuaciones WHERE id = $1', [id]);

    res.json({ message: 'Actuación eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando actuación' });
  }
};

module.exports = { getActuaciones, createActuacion, updateActuacion, deleteActuacion };
