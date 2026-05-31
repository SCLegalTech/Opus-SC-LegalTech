const db = require('../config/db');
const { isUUID } = require('../utils/db-utils');
const {
  buildClientsFilter,
  canAccessClient,
  hasInternalScope,
  hasOperationalScope,
} = require('../middleware/authz');

const getClients = async (req, res) => {
  const { search, limit = 50, offset = 0 } = req.query;
  try {
    const scope = buildClientsFilter(req.user);
    let query = `
      SELECT cl.*,
             COUNT(c.id) AS total_cases,
             COUNT(CASE WHEN c.status NOT IN ('CERRADO','ARCHIVADO') THEN 1 END) AS active_cases
      FROM clients cl
      LEFT JOIN cases c ON cl.id = c.client_id
      WHERE ${scope.clause || '1=1'}
    `;
    const params = [...scope.params];
    let i = scope.next;

    if (search) {
      query += ` AND (cl.full_name ILIKE $${i} OR cl.document_number ILIKE $${i} OR cl.email ILIKE $${i})`;
      params.push(`%${search}%`); i++;
    }

    query += ` GROUP BY cl.id ORDER BY cl.created_at DESC LIMIT $${i++} OFFSET $${i++}`;
    params.push(parseInt(limit), parseInt(offset));

    const { rows } = await db.query(query, params);

    let countQuery = `SELECT COUNT(*) FROM clients cl WHERE ${scope.clause || '1=1'}`;
    const countParams = [...scope.params];
    let countIndex = scope.next;
    if (search) {
      countQuery += ` AND (cl.full_name ILIKE $${countIndex} OR cl.document_number ILIKE $${countIndex} OR cl.email ILIKE $${countIndex})`;
      countParams.push(`%${search}%`);
    }
    const countResult = await db.query(countQuery, countParams);

    res.json({ clients: rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo clientes' });
  }
};

const getClientById = async (req, res) => {
  try {
    const allowed = await canAccessClient(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ error: 'No autorizado para acceder a este cliente' });

    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows } = await db.query(`SELECT * FROM clients WHERE ${field} = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo cliente' });
  }
};

const createClient = async (req, res) => {
  if (!hasInternalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo usuarios internos pueden crear clientes' });
  }

  const { full_name, document_type, document_number, email, phone, address, city, notes } = req.body;
  if (!full_name) return res.status(400).json({ error: 'El nombre completo es requerido' });

  try {
    const { rows } = await db.query(`
      INSERT INTO clients (full_name, document_type, document_number, email, phone, address, city, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [full_name, document_type || 'CC', document_number, email, phone, address, city, notes]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error creando cliente' });
  }
};

const updateClient = async (req, res) => {
  if (!hasInternalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo usuarios internos pueden actualizar clientes' });
  }

  const { full_name, document_type, document_number, email, phone, address, city, notes } = req.body;
  try {
    const allowed = await canAccessClient(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ error: 'No autorizado para actualizar este cliente' });

    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows } = await db.query(`
      UPDATE clients SET
        full_name = COALESCE($1, full_name),
        document_type = COALESCE($2, document_type),
        document_number = COALESCE($3, document_number),
        email = COALESCE($4, email),
        phone = COALESCE($5, phone),
        address = COALESCE($6, address),
        city = COALESCE($7, city),
        notes = COALESCE($8, notes),
        updated_at = NOW()
      WHERE ${field} = $9
      RETURNING *
    `, [full_name, document_type, document_number, email, phone, address, city, notes, req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error actualizando cliente' });
  }
};

const deleteClient = async (req, res) => {
  if (!hasOperationalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo administradores o socios pueden eliminar clientes' });
  }

  try {
    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows: clientRows } = await db.query(
      `SELECT id FROM clients WHERE ${field} = $1`, [req.params.id]
    );
    if (!clientRows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const clientId = clientRows[0].id;

    const { rows } = await db.query(
      'SELECT COUNT(*) FROM cases WHERE client_id = $1', [clientId]
    );
    if (parseInt(rows[0].count) > 0)
      return res.status(400).json({ error: 'No se puede eliminar un cliente con casos activos' });

    await db.query('DELETE FROM clients WHERE id = $1', [clientId]);
    res.json({ message: 'Cliente eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error eliminando cliente' });
  }
};

const getClientCases = async (req, res) => {
  try {
    const allowed = await canAccessClient(req.user, req.params.id);
    if (!allowed) return res.status(403).json({ error: 'No autorizado para acceder a los casos de este cliente' });

    const field = isUUID(req.params.id) ? 'uuid' : 'id';
    const { rows: clientRows } = await db.query(`SELECT id FROM clients WHERE ${field} = $1`, [req.params.id]);
    if (!clientRows.length) return res.status(404).json({ error: 'Cliente no encontrado' });

    const { rows } = await db.query(`
      SELECT c.*, u.name AS assigned_to_name
      FROM cases c
      LEFT JOIN users u ON c.assigned_to = u.id
      WHERE c.client_id = $1
      ORDER BY c.created_at DESC
    `, [clientRows[0].id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error obteniendo casos del cliente' });
  }
};

module.exports = { getClients, getClientById, createClient, updateClient, deleteClient, getClientCases };
