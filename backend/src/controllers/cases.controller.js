const db = require('../config/db');
const { buildCasesFilter } = require('../middleware/authz');
const { isUUID } = require('../utils/db-utils');

// Incremento atómico de secuencia — sin race condition
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

const SERVICE_TYPES = [
  { type: 'PQRS', label: 'PQRS', description: 'Peticion, Queja, Reclamo o Sugerencia' },
  { type: 'TUTELA', label: 'Tutela', description: 'Accion de Tutela' },
  { type: 'PENAL', label: 'Penal', description: 'Proceso penal o defensa penal' },
  { type: 'CIVIL', label: 'Civil', description: 'Proceso civil, familia o comercial' },
  { type: 'ADMINISTRATIVO', label: 'Administrativo', description: 'Proceso contencioso o administrativo' },
  { type: 'LABORAL', label: 'Laboral', description: 'Proceso laboral o seguridad social' },
  { type: 'CONTRATO', label: 'Contrato', description: 'Asunto contractual' },
  { type: 'SOCIETARIO', label: 'Societario', description: 'Asunto societario' },
  { type: 'REGULATORIO', label: 'Regulatorio', description: 'Asunto regulatorio' },
  { type: 'OTRO', label: 'Otro', description: 'Otro tipo de caso' },
];

const getServiceTypes = (req, res) => {
  res.json(SERVICE_TYPES);
};

const getCaseOptions = async (req, res) => {
  try {
    const [channels, users] = await Promise.all([
      db.query(`
        SELECT code, label
        FROM intake_channels
        WHERE active = TRUE
        ORDER BY label ASC
      `),
      db.query(`
        SELECT id, name, email, role
        FROM users
        WHERE active = TRUE
          AND role::text <> 'client'
        ORDER BY name ASC
      `),
    ]);

    res.json({
      service_types: SERVICE_TYPES,
      intake_channels: channels.rows,
      users: users.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo opciones de expediente' });
  }
};

const getCases = async (req, res) => {
  const { status, service_type, search, limit = 50, offset = 0 } = req.query;
  const { id: userId, role } = req.user;
  try {
    const scope = buildCasesFilter(userId, role);
    const conditions = scope.clause ? [scope.clause] : [];
    const params = [...scope.params];
    let i = scope.next;

    if (status)       { conditions.push(`c.status = $${i++}`);       params.push(status); }
    if (service_type) { conditions.push(`c.service_type = $${i++}`); params.push(service_type); }
    if (search) {
      conditions.push(`(c.case_number ILIKE $${i} OR c.title ILIKE $${i} OR cl.full_name ILIKE $${i})`);
      params.push(`%${search}%`); i++;
    }

    const where = conditions.length ? conditions.join(' AND ') : '1=1';
    const limitOffset = [parseInt(limit), parseInt(offset)];

    const [{ rows }, countResult] = await Promise.all([
      db.query(`
        SELECT c.*, cl.full_name AS client_name, cl.document_number AS client_document,
               u.name AS assigned_to_name
        FROM cases c
        LEFT JOIN clients cl ON c.client_id = cl.id
        LEFT JOIN users u ON c.assigned_to = u.id
        WHERE ${where}
        ORDER BY c.created_at DESC LIMIT $${i} OFFSET $${i + 1}
      `, [...params, ...limitOffset]),
      db.query(`
        SELECT COUNT(*) FROM cases c
        LEFT JOIN clients cl ON c.client_id = cl.id
        WHERE ${where}
      `, params),
    ]);

    res.json({ cases: rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo casos' });
  }
};

const getCaseById = async (req, res) => {
  try {
    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows } = await db.query(`
      SELECT c.*,
             cl.full_name AS client_name, cl.document_number AS client_document,
             cl.email AS client_email, cl.phone AS client_phone,
             u.name AS assigned_to_name
      FROM cases c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.${field} = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Caso no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo caso' });
  }
};

const preallocate = async (req, res) => {
  try {
    const { seq, year } = await nextSequenceValue('SC');
    const case_number = `SC-${year}-${String(seq).padStart(4, '0')}`;
    const { rows } = await db.query('SELECT gen_random_uuid() AS uuid');
    res.json({ case_number, uuid: rows[0].uuid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error preasignando número de caso' });
  }
};

const createCase = async (req, res) => {
  const {
    client_id, service_type, title, description, entity,
    assigned_to, filing_date, response_deadline,
    case_number: prealloc_number, intake_channel, legal_area,
    process_type, drive_folder_id,
  } = req.body;

  if (!client_id || !service_type || !title)
    return res.status(400).json({ error: 'Cliente, tipo de servicio y título son requeridos' });

  const svc = SERVICE_TYPES.find(s => s.type === service_type);
  if (!svc) return res.status(400).json({ error: 'Tipo de servicio inválido' });

  try {
    let case_number = prealloc_number;
    if (!case_number) {
      const { seq, year } = await nextSequenceValue('SC');
      case_number = `SC-${year}-${String(seq).padStart(4, '0')}`;
    }

    const { rows } = await db.query(`
      INSERT INTO cases (case_number, client_id, service_type, title, description, entity,
                         assigned_to, filing_date, response_deadline, created_by,
                         intake_channel, legal_area, process_type, drive_folder_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *
    `, [case_number, client_id, service_type, title, description, entity,
        assigned_to || req.user.id, filing_date || null,
        response_deadline || null, req.user.id, intake_channel || null,
        legal_area || null, process_type || null, drive_folder_id || null]);

    // Registro inicial en comunicaciones
    await db.query(`
      INSERT INTO communications (case_id, type, content, created_by)
      VALUES ($1, 'note', $2, $3)
    `, [rows[0].id, `Caso creado. Servicio: ${svc.label}`, req.user.id]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando caso' });
  }
};

const updateCase = async (req, res) => {
  const { id } = req.params;
  const {
    title, description, entity, status,
    assigned_to, filing_date, response_deadline, closed_at,
    next_action, next_action_date
  } = req.body;

  try {
    const field = isUUID(id) ? 'uuid' : 'id';
    const { rows: current } = await db.query(`SELECT * FROM cases WHERE ${field} = $1`, [id]);
    if (!current.length) return res.status(404).json({ error: 'Caso no encontrado' });

    const { rows } = await db.query(`
      UPDATE cases SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        entity = COALESCE($3, entity),
        status = COALESCE($4, status),
        assigned_to = COALESCE($5, assigned_to),
        filing_date = COALESCE($6, filing_date),
        response_deadline = COALESCE($7, response_deadline),
        closed_at = COALESCE($8, closed_at),
        next_action = COALESCE($9, next_action),
        next_action_date = COALESCE($10, next_action_date),
        updated_at = NOW()
      WHERE id = $11
      RETURNING *
    `, [title, description, entity, status,
        assigned_to, filing_date, response_deadline,
        closed_at, next_action, next_action_date, current[0].id]);

    // Log de cambio de estado
    if (status && status !== current[0].status) {
      await db.query(`
        INSERT INTO communications (case_id, type, content, created_by)
        VALUES ($1, 'note', $2, $3)
      `, [id, `Estado actualizado: ${current[0].status} → ${status}`, req.user.id]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error actualizando caso' });
  }
};

const updateCaseEditable = async (req, res) => {
  const { id } = req.params;

  try {
    const field = isUUID(id) ? 'uuid' : 'id';
    const { rows: current } = await db.query(`SELECT * FROM cases WHERE ${field} = $1`, [id]);
    if (!current.length) return res.status(404).json({ error: 'Caso no encontrado' });

    const writable = [
      'case_number',
      'service_type',
      'legal_area',
      'process_type',
      'title',
      'description',
      'entity',
      'status',
      'intake_channel',
      'assigned_to',
      'filing_date',
      'response_deadline',
      'drive_folder_id',
      'closed_at',
      'next_action',
      'next_action_date',
    ];

    if (req.body.service_type && !SERVICE_TYPES.some((svc) => svc.type === req.body.service_type)) {
      return res.status(400).json({ error: 'Tipo de caso invalido' });
    }

    const sets = [];
    const params = [];
    let i = 1;

    for (const fieldName of writable) {
      if (!Object.prototype.hasOwnProperty.call(req.body, fieldName)) continue;
      let value = req.body[fieldName];
      if (value === '') value = null;
      sets.push(`${fieldName} = $${i++}`);
      params.push(value);
    }

    if (!sets.length) return res.json(current[0]);

    const { rows } = await db.query(`
      UPDATE cases SET
        ${sets.join(',\n        ')},
        updated_at = NOW()
      WHERE id = $${i}
      RETURNING *
    `, [...params, current[0].id]);

    if (req.body.status && req.body.status !== current[0].status) {
      await db.query(`
        INSERT INTO communications (case_id, type, content, created_by)
        VALUES ($1, 'note', $2, $3)
      `, [current[0].id, `Estado actualizado: ${current[0].status} -> ${req.body.status}`, req.user.id]);
    }

    const { rows: enriched } = await db.query(`
      SELECT c.*,
             cl.full_name AS client_name, cl.document_number AS client_document,
             cl.email AS client_email, cl.phone AS client_phone,
             u.name AS assigned_to_name
      FROM cases c
      LEFT JOIN clients cl ON c.client_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.id = $1
    `, [rows[0].id]);

    res.json(enriched[0] || rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un caso con ese numero' });
    }
    res.status(500).json({ error: 'Error actualizando caso' });
  }
};

const deleteCase = async (req, res) => {
  try {
    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows } = await db.query(`SELECT * FROM cases WHERE ${field} = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Caso no encontrado' });

    await db.query('DELETE FROM communications WHERE case_id = $1', [rows[0].id]);
    await db.query('DELETE FROM cases WHERE id = $1', [rows[0].id]);
    res.json({ message: 'Caso eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando caso' });
  }
};

const getCommunications = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT cm.*, u.name AS author_name
      FROM communications cm
      LEFT JOIN users u ON cm.created_by = u.id
      WHERE cm.case_id = $1
      ORDER BY cm.created_at ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo comunicaciones' });
  }
};

const addCommunication = async (req, res) => {
  const { type, content } = req.body;
  if (!content) return res.status(400).json({ error: 'El contenido es requerido' });

  try {
    const { rows } = await db.query(`
      INSERT INTO communications (case_id, type, content, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *, (SELECT name FROM users WHERE id = $4) AS author_name
    `, [req.params.id, type || 'note', content, req.user.id]);

    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error agregando comunicación' });
  }
};

const deleteCommunication = async (req, res) => {
  const { id, communicationId } = req.params;

  try {
    const { rows } = await db.query(`
      DELETE FROM communications
      WHERE id = $1 AND case_id = $2
      RETURNING id, case_id, type, metadata
    `, [communicationId, id]);

    if (!rows.length) {
      return res.status(404).json({ error: 'Comunicacion no encontrada' });
    }

    res.json({ message: 'Comunicacion eliminada correctamente', communication: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error eliminando comunicacion' });
  }
};

module.exports = {
  getCases, getCaseById, createCase, updateCase: updateCaseEditable, deleteCase,
  addCommunication, deleteCommunication, getCommunications, getServiceTypes, getCaseOptions,
  preallocate,
};
