/**
 * macrocasos.controller.js
 * Φ SC LegalTech · Opus v3
 *
 * CRUD completo para Macrocasos/Proyectos.
 * Un macrocaso es un contenedor de múltiples casos bajo una causa común
 * (ej: Real Business — todos los clientes en un PQRS colectivo ante la SIC).
 *
 * Endpoints:
 *   GET    /api/macrocasos                    → lista con conteos
 *   GET    /api/macrocasos/:id                → detalle completo
 *   POST   /api/macrocasos                    → crear
 *   PATCH  /api/macrocasos/:id                → actualizar
 *   DELETE /api/macrocasos/:id                → archivar (soft delete)
 *
 *   GET    /api/macrocasos/:id/members        → casos miembros
 *   POST   /api/macrocasos/:id/members        → vincular caso
 *   DELETE /api/macrocasos/:id/members/:caseId → desvincular caso
 *
 *   GET    /api/macrocasos/:id/actuaciones    → actuaciones del proyecto
 *   POST   /api/macrocasos/:id/actuaciones    → crear actuación de proyecto
 *   PATCH  /api/macrocasos/:id/actuaciones/:actId/complete
 *
 *   GET    /api/macrocasos/:id/tareas         → tareas del proyecto
 *   POST   /api/macrocasos/:id/tareas         → crear tarea de proyecto
 *   PATCH  /api/macrocasos/:id/tareas/:tareaId
 *
 *   GET    /api/macrocasos/:id/vencimientos   → vencimientos del proyecto
 *   POST   /api/macrocasos/:id/vencimientos   → crear vencimiento de proyecto
 *   PATCH  /api/macrocasos/:id/vencimientos/:vencId/resolve
 */

const db = require('../config/db');
const { isUUID } = require('../utils/db-utils');

async function nextSequenceValue(prefix) {
  const year = new Date().getFullYear();
  const key = `${prefix}-${year}`;
  const { rows } = await db.query(`
    INSERT INTO number_sequences (key, value)
    VALUES ($1, 1)
    ON CONFLICT (key) DO UPDATE
      SET value = number_sequences.value + 1,
          updated_at = NOW()
    RETURNING value
  `, [key]);
  return { seq: rows[0].value, year };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcUrgency(dateStr) {
  if (!dateStr) return 'MEDIO';
  const days = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  if (days <= 2)  return 'CRITICO';
  if (days <= 5)  return 'ALTO';
  if (days <= 14) return 'MEDIO';
  return 'BAJO';
}

// ── LIST ──────────────────────────────────────────────────────────────────────

const getMacrocasos = async (req, res) => {
  try {
    const { status, service_type } = req.query;
    const { id: userId, role } = req.user;

    let where = "WHERE m.status != 'ARCHIVADO'";
    const params = [];

    if (role !== 'admin') {
      params.push(userId, userId, userId);
      where += ` AND (m.lead_lawyer = $1 OR m.created_by = $2 OR EXISTS (
        SELECT 1 FROM cases _c WHERE _c.macrocaso_id = m.id AND _c.assigned_to = $3
      ))`;
    }

    if (status) {
      params.push(status);
      where += ` AND m.status = $${params.length}`;
    }
    if (service_type) {
      params.push(service_type);
      where += ` AND m.service_type = $${params.length}`;
    }

    const { rows } = await db.query(`
      SELECT
        m.id, m.code, m.title, m.description, m.service_type, m.status,
        m.entity, m.next_action, m.next_action_date, m.jurisdiction,
        m.drive_folder_id, m.created_at, m.updated_at,
        u.name  AS lead_lawyer_name,
        u.id    AS lead_lawyer_id,
        COUNT(DISTINCT c.id)                                           AS cases_count,
        COUNT(DISTINCT t.id) FILTER (
          WHERE t.macrocaso_id = m.id
            AND t.status NOT IN ('COMPLETADA','CANCELADA'))            AS tareas_pendientes,
        COUNT(DISTINCT v.id) FILTER (
          WHERE v.macrocaso_id = m.id
            AND v.resolved = FALSE
            AND v.due_date <= CURRENT_DATE + 7)                        AS vencimientos_proximos,
        COUNT(DISTINCT v2.id) FILTER (
          WHERE v2.macrocaso_id = m.id
            AND v2.resolved = FALSE
            AND v2.due_date < CURRENT_DATE)                            AS vencimientos_vencidos
      FROM macrocasos m
      LEFT JOIN users u        ON m.lead_lawyer = u.id
      LEFT JOIN cases c        ON c.macrocaso_id = m.id
      LEFT JOIN tareas t       ON t.macrocaso_id = m.id
      LEFT JOIN vencimientos v  ON v.macrocaso_id = m.id
      LEFT JOIN vencimientos v2 ON v2.macrocaso_id = m.id
      ${where}
      GROUP BY m.id, u.name, u.id
      ORDER BY
        CASE m.status WHEN 'ACTIVO' THEN 1 WHEN 'EN_ESPERA' THEN 2 ELSE 3 END,
        m.updated_at DESC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('getMacrocasos:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── DETAIL ────────────────────────────────────────────────────────────────────

const getMacrocaso = async (req, res) => {
  try {
    const { id } = req.params;
    const field = isUUID(id) ? 'uuid' : 'id';

    const { rows: [macrocaso] } = await db.query(`
      SELECT m.*,
        u.name  AS lead_lawyer_name,
        u.email AS lead_lawyer_email,
        ub.name AS created_by_name
      FROM macrocasos m
      LEFT JOIN users u  ON m.lead_lawyer = u.id
      LEFT JOIN users ub ON m.created_by  = ub.id
      WHERE m.${field} = $1
    `, [id]);

    if (!macrocaso) return res.status(404).json({ error: 'Macrocaso no encontrado' });

    res.json(macrocaso);
  } catch (err) {
    console.error('getMacrocaso:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── CREATE ────────────────────────────────────────────────────────────────────

const createMacrocaso = async (req, res) => {
  try {
    const {
      title, description, service_type, jurisdiction = 'CO',
      entity, lead_lawyer, drive_folder_id, next_action, next_action_date,
    } = req.body;

    if (!title || !service_type) {
      return res.status(400).json({ error: 'title y service_type son obligatorios' });
    }

    const { seq, year } = await nextSequenceValue('MC');
    const code = `MC-${year}-${String(seq).padStart(4, '0')}`;

    const { rows: [created] } = await db.query(`
      INSERT INTO macrocasos
        (code, title, description, service_type, jurisdiction, entity,
         lead_lawyer, created_by, drive_folder_id, next_action, next_action_date)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [
      code, title, description || null, service_type, jurisdiction,
      entity || null, lead_lawyer || null, req.user.id, drive_folder_id || null,
      next_action || null, next_action_date || null,
    ]);

    res.status(201).json(created);
  } catch (err) {
    console.error('createMacrocaso:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────

const updateMacrocaso = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, service_type, jurisdiction, entity,
      status, lead_lawyer, drive_folder_id, next_action, next_action_date,
    } = req.body;

    const field = isUUID(id) ? 'uuid' : 'id';
    const { rows: [updated] } = await db.query(`
      UPDATE macrocasos SET
        title            = COALESCE($1, title),
        description      = COALESCE($2, description),
        service_type     = COALESCE($3, service_type),
        jurisdiction     = COALESCE($4, jurisdiction),
        entity           = COALESCE($5, entity),
        status           = COALESCE($6, status),
        lead_lawyer      = COALESCE($7, lead_lawyer),
        drive_folder_id  = COALESCE($8, drive_folder_id),
        next_action      = COALESCE($9, next_action),
        next_action_date = COALESCE($10, next_action_date),
        updated_at       = NOW()
      WHERE ${field} = $11
      RETURNING *
    `, [
      title, description, service_type, jurisdiction, entity,
      status, lead_lawyer, drive_folder_id, next_action, next_action_date,
      id,
    ]);

    if (!updated) return res.status(404).json({ error: 'Macrocaso no encontrado' });
    res.json(updated);
  } catch (err) {
    console.error('updateMacrocaso:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── ARCHIVE (soft delete) ─────────────────────────────────────────────────────

const archiveMacrocaso = async (req, res) => {
  try {
    const { id } = req.params;
    const field = isUUID(id) ? 'uuid' : 'id';
    await db.query(
      `UPDATE macrocasos SET status = 'ARCHIVADO', updated_at = NOW() WHERE ${field} = $1`,
      [id]
    );
    res.json({ message: 'Macrocaso archivado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── MEMBERS ───────────────────────────────────────────────────────────────────

const getMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(`
      SELECT
        c.id, c.case_number, c.title, c.status, c.service_type,
        c.fee, c.fee_paid, c.next_action, c.next_action_date,
        c.metadata,
        cl.full_name    AS client_name,
        cl.email        AS client_email,
        cl.phone        AS client_phone,
        cl.document_number,
        u.name          AS assigned_to_name,
        COUNT(DISTINCT t.id) FILTER (WHERE t.status NOT IN ('COMPLETADA','CANCELADA')) AS tareas_pendientes,
        COUNT(DISTINCT v.id) FILTER (WHERE v.resolved = FALSE AND v.due_date <= CURRENT_DATE + 7) AS vencimientos_proximos
      FROM cases c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u    ON c.assigned_to = u.id
      LEFT JOIN tareas t   ON t.case_id = c.id
      LEFT JOIN vencimientos v ON v.case_id = c.id
      WHERE c.macrocaso_id = $1
      GROUP BY c.id, cl.full_name, cl.email, cl.phone, cl.document_number, u.name
      ORDER BY cl.full_name
    `, [id]);

    res.json(rows);
  } catch (err) {
    console.error('getMembers:', err);
    res.status(500).json({ error: err.message });
  }
};

const addMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { case_id } = req.body;

    if (!case_id) return res.status(400).json({ error: 'case_id es obligatorio' });

    const { rows: [updated] } = await db.query(`
      UPDATE cases SET macrocaso_id = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, case_number, title
    `, [id, case_id]);

    if (!updated) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(updated);
  } catch (err) {
    console.error('addMember:', err);
    res.status(500).json({ error: err.message });
  }
};

const removeMember = async (req, res) => {
  try {
    const { id, caseId } = req.params;
    await db.query(`
      UPDATE cases SET macrocaso_id = NULL, updated_at = NOW()
      WHERE id = $1 AND macrocaso_id = $2
    `, [caseId, id]);
    res.json({ message: 'Caso desvinculado del macrocaso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateMemberDocumentGate = async (req, res) => {
  try {
    const { id, caseId } = req.params;
    const { gate, complete } = req.body;
    const completeValue = Boolean(complete);
    const states = {
      poder: completeValue ? 'ok' : 'requiere_actualizacion',
      contrato: completeValue ? 'ok' : 'requiere_firma_o_cierre',
      evidencia_dano: completeValue ? 'ok' : 'requiere_soportes',
      honorarios: completeValue ? 'pago_reportado' : 'requiere_conciliacion',
    };

    if (!Object.prototype.hasOwnProperty.call(states, gate)) {
      return res.status(400).json({ error: 'gate invalido' });
    }

    const path = ['rb_operacion', 'puertas_documentales', gate, 'estado'];
    const { rows: [updated] } = await db.query(`
      UPDATE cases
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            $1::text[],
            to_jsonb($2::text),
            true
          ),
          updated_at = NOW()
      WHERE id = $3 AND macrocaso_id = $4
      RETURNING id, metadata
    `, [path, states[gate], caseId, id]);

    if (!updated) return res.status(404).json({ error: 'Caso no encontrado en este macrocaso' });
    res.json(updated);
  } catch (err) {
    console.error('updateMemberDocumentGate:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── ACTUACIONES DEL PROYECTO ──────────────────────────────────────────────────

const getActuaciones = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(`
      SELECT a.*, u.name AS created_by_name
      FROM actuaciones a
      LEFT JOIN users u ON a.created_by = u.id
      WHERE a.macrocaso_id = $1 AND a.case_id IS NULL
      ORDER BY a.scheduled_at DESC NULLS LAST, a.created_at DESC
    `, [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createActuacion = async (req, res) => {
  try {
    const { id } = req.params;
    const { type = 'SEGUIMIENTO', title, description, scheduled_at, radicado } = req.body;

    if (!title) return res.status(400).json({ error: 'title es obligatorio' });

    const userId = req.user?.id;

    const { rows: [act] } = await db.query(`
      INSERT INTO actuaciones
        (macrocaso_id, case_id, type, title, description, scheduled_at, radicado, created_by)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [id, type, title, description || null, scheduled_at || null, radicado || null, userId || null]);

    // Auto-crear vencimiento de proyecto si tiene fecha
    if (scheduled_at) {
      const urgency = calcUrgency(scheduled_at);
      await db.query(`
        INSERT INTO vencimientos
          (macrocaso_id, case_id, actuacion_id, title, due_date, urgency, created_by)
        VALUES ($1, NULL, $2, $3, $4, $5, $6)
      `, [id, act.id, `Actuación: ${title}`, scheduled_at, urgency, userId || null]);
    }

    // Log workflow_event
    await db.query(`
      INSERT INTO workflow_events (direction, event_type, case_id, payload)
      VALUES ('outbound', 'actuacion.created.proyecto', NULL, $1)
    `, [JSON.stringify({ macrocaso_id: parseInt(id), actuacion_id: act.id, title })]);

    res.status(201).json(act);
  } catch (err) {
    console.error('createActuacion proyecto:', err);
    res.status(500).json({ error: err.message });
  }
};

const completeActuacion = async (req, res) => {
  try {
    const { id, actId } = req.params;
    const { result } = req.body;

    const { rows: [updated] } = await db.query(`
      UPDATE actuaciones
      SET completed_at = NOW(), result = $1, updated_at = NOW()
      WHERE id = $2 AND macrocaso_id = $3
      RETURNING *
    `, [result || null, actId, id]);

    if (!updated) return res.status(404).json({ error: 'Actuación no encontrada' });

    // Resolver vencimientos asociados
    await db.query(`
      UPDATE vencimientos SET resolved = TRUE, resolved_at = NOW()
      WHERE actuacion_id = $1 AND macrocaso_id = $2
    `, [actId, id]);

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── TAREAS DEL PROYECTO ───────────────────────────────────────────────────────

const getTareas = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority } = req.query;

    let where = 'WHERE t.macrocaso_id = $1 AND t.case_id IS NULL';
    const params = [id];

    if (status) { params.push(status); where += ` AND t.status = $${params.length}`; }
    if (priority) { params.push(priority); where += ` AND t.priority = $${params.length}`; }

    const { rows } = await db.query(`
      SELECT t.*, u.name AS assigned_to_name, ub.name AS created_by_name
      FROM tareas t
      LEFT JOIN users u  ON t.assigned_to = u.id
      LEFT JOIN users ub ON t.created_by  = ub.id
      ${where}
      ORDER BY
        CASE t.priority WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
        t.due_date ASC NULLS LAST
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createTarea = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, assigned_to, priority = 'MEDIA',
      due_date, actuacion_id,
    } = req.body;

    if (!title) return res.status(400).json({ error: 'title es obligatorio' });
    const userId = req.user?.id;

    const { rows: [tarea] } = await db.query(`
      INSERT INTO tareas
        (macrocaso_id, case_id, actuacion_id, title, description,
         assigned_to, priority, status, due_date, created_by)
      VALUES ($1, NULL, $2, $3, $4, $5, $6, 'PENDIENTE', $7, $8)
      RETURNING *
    `, [id, actuacion_id || null, title, description || null,
        assigned_to || null, priority, due_date || null, userId || null]);

    // Auto-crear vencimiento si tiene fecha
    if (due_date) {
      const urgency = calcUrgency(due_date);
      await db.query(`
        INSERT INTO vencimientos
          (macrocaso_id, case_id, tarea_id, title, due_date, urgency, created_by)
        VALUES ($1, NULL, $2, $3, $4, $5, $6)
      `, [id, tarea.id, title, due_date, urgency, userId || null]);
    }

    res.status(201).json(tarea);
  } catch (err) {
    console.error('createTarea proyecto:', err);
    res.status(500).json({ error: err.message });
  }
};

const updateTarea = async (req, res) => {
  try {
    const { id, tareaId } = req.params;
    const { title, status, priority, due_date, assigned_to, description } = req.body;

    const { rows: [updated] } = await db.query(`
      UPDATE tareas SET
        title        = COALESCE($1, title),
        status       = COALESCE($2, status),
        priority     = COALESCE($3, priority),
        due_date     = COALESCE($4, due_date),
        assigned_to  = COALESCE($5, assigned_to),
        description  = COALESCE($6, description),
        completed_at = CASE WHEN $2 = 'COMPLETADA' AND completed_at IS NULL
                            THEN NOW() ELSE completed_at END,
        updated_at   = NOW()
      WHERE id = $7 AND macrocaso_id = $8
      RETURNING *
    `, [title, status, priority, due_date, assigned_to, description, tareaId, id]);

    if (!updated) return res.status(404).json({ error: 'Tarea no encontrada' });

    // Resolver vencimiento si completada
    if (status === 'COMPLETADA') {
      await db.query(`
        UPDATE vencimientos SET resolved = TRUE, resolved_at = NOW()
        WHERE tarea_id = $1 AND macrocaso_id = $2
      `, [tareaId, id]);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── VENCIMIENTOS DEL PROYECTO ─────────────────────────────────────────────────

const getVencimientos = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(`
      SELECT v.*, u.name AS created_by_name
      FROM vencimientos v
      LEFT JOIN users u ON v.created_by = u.id
      WHERE v.macrocaso_id = $1 AND v.case_id IS NULL
      ORDER BY v.due_date ASC
    `, [id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createVencimiento = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, due_date, urgency } = req.body;

    if (!title || !due_date) {
      return res.status(400).json({ error: 'title y due_date son obligatorios' });
    }

    const finalUrgency = urgency || calcUrgency(due_date);
    const userId = req.user?.id;

    const { rows: [venc] } = await db.query(`
      INSERT INTO vencimientos
        (macrocaso_id, case_id, title, due_date, urgency, created_by)
      VALUES ($1, NULL, $2, $3, $4, $5)
      RETURNING *
    `, [id, title, due_date, finalUrgency, userId || null]);

    res.status(201).json(venc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const resolveVencimiento = async (req, res) => {
  try {
    const { id, vencId } = req.params;
    const { rows: [updated] } = await db.query(`
      UPDATE vencimientos
      SET resolved = TRUE, resolved_at = NOW()
      WHERE id = $1 AND macrocaso_id = $2
      RETURNING *
    `, [vencId, id]);

    if (!updated) return res.status(404).json({ error: 'Vencimiento no encontrado' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ── EXPORTS ───────────────────────────────────────────────────────────────────

module.exports = {
  getMacrocasos, getMacrocaso, createMacrocaso, updateMacrocaso, archiveMacrocaso,
  getMembers, addMember, removeMember, updateMemberDocumentGate,
  getActuaciones, createActuacion, completeActuacion,
  getTareas, createTarea, updateTarea,
  getVencimientos, createVencimiento, resolveVencimiento,
};
