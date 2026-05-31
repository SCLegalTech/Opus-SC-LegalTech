/**
 * prospects.controller.js
 * ─────────────────────────────────────────────────────────────
 * CRUD del pipeline comercial pre-cliente.
 *
 * Endpoints (todos bajo /api/prospects, requieren JWT + interno):
 *   GET    /                lista paginada con filtros
 *   GET    /:id             detalle + conversaciones WhatsApp vinculadas
 *   POST   /                crea (manual)
 *   PATCH  /:id             actualiza (status, asignación, notas, descripción)
 *   POST   /:id/convert     convierte a cliente (+ opcionalmente caso)
 *   DELETE /:id             borra (solo operacional)
 *
 * Visibilidad:
 *   - operacional (admin/partner): ve todo
 *   - interno: ve los suyos (assigned_to = user.id) o sin asignar
 */

const db = require('../config/db');
const { hasInternalScope, hasOperationalScope } = require('../middleware/authz');

const PIPELINE_STATUSES = ['nuevo', 'contactado', 'calificado', 'propuesta', 'ganado', 'perdido'];

// ─────────────────────────────────────────────────────────────
// GET /prospects
// ─────────────────────────────────────────────────────────────

const list = async (req, res) => {
  const {
    pipeline_status,
    assigned_to,             // 'me' | 'unassigned' | userId
    service_type,
    search,
    limit = 50,
    offset = 0,
  } = req.query;

  const where = ['1=1'];
  const params = [];

  if (pipeline_status && pipeline_status !== 'all') {
    params.push(pipeline_status);
    where.push(`p.pipeline_status = $${params.length}`);
  }

  if (assigned_to === 'me') {
    params.push(req.user.id);
    where.push(`p.assigned_to = $${params.length}`);
  } else if (assigned_to === 'unassigned') {
    where.push('p.assigned_to IS NULL');
  } else if (assigned_to) {
    params.push(parseInt(assigned_to, 10));
    where.push(`p.assigned_to = $${params.length}`);
  }

  if (service_type) {
    params.push(service_type);
    where.push(`p.service_type = $${params.length}`);
  }

  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    where.push(`(LOWER(p.full_name) LIKE $${params.length} OR p.phone LIKE $${params.length} OR LOWER(p.description) LIKE $${params.length})`);
  }

  // Visibilidad: operacionales ven todo; resto ven los suyos o sin asignar
  if (!hasOperationalScope(req.user?.role)) {
    params.push(req.user.id);
    where.push(`(p.assigned_to = $${params.length} OR p.assigned_to IS NULL)`);
  }

  params.push(Math.min(parseInt(limit, 10) || 50, 200));
  params.push(parseInt(offset, 10) || 0);

  const sql = `
    SELECT p.*,
           u.name AS assigned_name,
           cl.full_name AS converted_client_name,
           ca.case_number AS converted_case_number,
           (
             SELECT COUNT(*)::int
               FROM wa_conversations wc
              WHERE wc.prospect_id = p.id
           ) AS wa_conversations_count
      FROM prospects p
      LEFT JOIN users   u  ON u.id  = p.assigned_to
      LEFT JOIN clients cl ON cl.id = p.converted_client_id
      LEFT JOIN cases   ca ON ca.id = p.converted_case_id
     WHERE ${where.join(' AND ')}
     ORDER BY
       CASE p.pipeline_status
         WHEN 'nuevo'      THEN 1
         WHEN 'contactado' THEN 2
         WHEN 'calificado' THEN 3
         WHEN 'propuesta'  THEN 4
         WHEN 'ganado'     THEN 5
         WHEN 'perdido'    THEN 6
       END ASC,
       p.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  try {
    const { rows } = await db.query(sql, params);
    res.json({ prospects: rows, count: rows.length });
  } catch (err) {
    console.error('[prospects] list failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// GET /prospects/:id
// ─────────────────────────────────────────────────────────────

const getById = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'id invalido' });

  try {
    const { rows } = await db.query(
      `SELECT p.*, u.name AS assigned_name,
              cl.full_name AS converted_client_name,
              ca.case_number AS converted_case_number
         FROM prospects p
         LEFT JOIN users   u  ON u.id  = p.assigned_to
         LEFT JOIN clients cl ON cl.id = p.converted_client_id
         LEFT JOIN cases   ca ON ca.id = p.converted_case_id
        WHERE p.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'prospecto no encontrado' });

    // Conversaciones WA vinculadas
    const conv = await db.query(
      `SELECT id, contact_phone, contact_name, last_message_at, status, unread_count, consent_status
         FROM wa_conversations
        WHERE prospect_id = $1
        ORDER BY last_message_at DESC NULLS LAST`,
      [id]
    );

    res.json({ prospect: rows[0], conversations: conv.rows });
  } catch (err) {
    console.error('[prospects] getById failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /prospects
// ─────────────────────────────────────────────────────────────

const create = async (req, res) => {
  if (!hasInternalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo usuarios internos' });
  }
  const {
    full_name, document_type, document_number, phone, email,
    jurisdiction = 'CO', source = 'manual', service_type,
    description, assigned_to, notes,
  } = req.body || {};

  try {
    const { rows } = await db.query(
      `INSERT INTO prospects
         (full_name, document_type, document_number, phone, email,
          jurisdiction, source, service_type, description, assigned_to, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [full_name || null, document_type || null, document_number || null,
       phone || null, email || null, jurisdiction, source,
       service_type || null, description || null, assigned_to || null, notes || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[prospects] create failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH /prospects/:id
// ─────────────────────────────────────────────────────────────

const update = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'id invalido' });

  const allowedFields = [
    'full_name', 'document_type', 'document_number', 'phone', 'email',
    'jurisdiction', 'service_type', 'description', 'pipeline_status',
    'assigned_to', 'notes',
  ];
  const updates = {};
  for (const key of allowedFields) {
    if (key in (req.body || {})) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'sin campos a actualizar' });
  }
  if (updates.pipeline_status && !PIPELINE_STATUSES.includes(updates.pipeline_status)) {
    return res.status(400).json({ error: `pipeline_status invalido. Permitidos: ${PIPELINE_STATUSES.join(', ')}` });
  }

  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
  const values = [id, ...Object.values(updates)];

  try {
    const { rows } = await db.query(
      `UPDATE prospects SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      values
    );
    if (!rows.length) return res.status(404).json({ error: 'prospecto no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[prospects] update failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /prospects/:id/convert
// ─────────────────────────────────────────────────────────────

const convertToClient = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'id invalido' });

  if (!hasInternalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo usuarios internos' });
  }

  const client = await db.connect ? await db.connect() : null;   // soporte tx opcional

  try {
    const { rows: existing } = await db.query('SELECT * FROM prospects WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ error: 'prospecto no encontrado' });
    const prospect = existing[0];

    if (prospect.converted_client_id) {
      return res.status(409).json({ error: 'prospecto ya convertido', client_id: prospect.converted_client_id });
    }

    if (!prospect.full_name) {
      return res.status(400).json({ error: 'falta full_name. Actualiza el prospecto antes de convertir.' });
    }

    // 1. Crear cliente
    const { rows: cli } = await db.query(
      `INSERT INTO clients (full_name, document_type, document_number, email, phone, jurisdiction, source, notes)
       VALUES ($1, COALESCE($2, 'CC'), $3, $4, $5, $6, 'whatsapp', $7)
       ON CONFLICT (document_number) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [prospect.full_name, prospect.document_type, prospect.document_number,
       prospect.email, prospect.phone, prospect.jurisdiction || 'CO', prospect.notes]
    );
    const createdClient = cli[0];

    // 2. Crear caso opcional si vino case_data
    let createdCase = null;
    if (req.body?.create_case && req.body?.case_data) {
      const cd = req.body.case_data;
      const { rows: ca } = await db.query(
        `INSERT INTO cases (case_number, client_id, assigned_to, created_by,
                            service_type, jurisdiction, title, description, entity, status)
         VALUES (
           'SC-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(NEXTVAL('cases_id_seq')::text, 4, '0'),
           $1, $2, $3, $4, $5, $6, $7, $8, 'NUEVO'
         )
         RETURNING *`,
        [createdClient.id, cd.assigned_to || req.user.id, req.user.id,
         prospect.service_type || cd.service_type || 'OTRO',
         prospect.jurisdiction || 'CO',
         cd.title || prospect.description?.slice(0, 200) || 'Caso desde prospecto WhatsApp',
         cd.description || prospect.description, cd.entity || null]
      );
      createdCase = ca[0];
    }

    // 3. Marcar prospecto como ganado y vincular
    await db.query(
      `UPDATE prospects
          SET pipeline_status = 'ganado',
              converted_client_id = $1,
              converted_case_id = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [createdClient.id, createdCase?.id || null, id]
    );

    // 4. Migrar wa_conversations: prospect_id -> client_id (mantener prospect_id como referencia)
    await db.query(
      `UPDATE wa_conversations
          SET client_id = $1,
              case_id = COALESCE(case_id, $2),
              updated_at = NOW()
        WHERE prospect_id = $3`,
      [createdClient.id, createdCase?.id || null, id]
    );

    res.status(201).json({
      prospect_id: id,
      client: createdClient,
      case: createdCase,
    });
  } catch (err) {
    console.error('[prospects] convert failed:', err);
    res.status(500).json({ error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /prospects/:id
// ─────────────────────────────────────────────────────────────

const remove = async (req, res) => {
  if (!hasOperationalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo administradores o socios pueden borrar prospectos' });
  }
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'id invalido' });

  try {
    const { rowCount } = await db.query('DELETE FROM prospects WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'prospecto no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  list,
  getById,
  create,
  update,
  convertToClient,
  remove,
};
