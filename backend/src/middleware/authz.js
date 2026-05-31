const db = require('../config/db');
const { isUUID } = require('../utils/db-utils');

function hasOperationalScope(role) {
  return ['admin', 'partner'].includes(String(role || '').toLowerCase());
}

function hasInternalScope(role) {
  return ['admin', 'partner', 'associate', 'assistant', 'lawyer', 'paralegal', 'ia_agent']
    .includes(String(role || '').toLowerCase());
}

const requireInternal = (req, res, next) => {
  if (!hasInternalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo disponible para usuarios internos' });
  }
  next();
};

const requireOperational = (req, res, next) => {
  if (!hasOperationalScope(req.user?.role)) {
    return res.status(403).json({ error: 'Solo disponible para administradores o socios' });
  }
  next();
};

async function canAccessCase(userId, role, caseIdOrUuid) {
  if (hasOperationalScope(role)) return true;
  const field = isUUID(String(caseIdOrUuid ?? '')) ? 'uuid' : 'id';
  const { rows } = await db.query(`
    SELECT 1 FROM cases c
    LEFT JOIN macrocasos m ON c.macrocaso_id = m.id
    WHERE c.${field} = $1
      AND (c.assigned_to = $2 OR c.created_by = $2 OR m.lead_lawyer = $2)
    LIMIT 1
  `, [caseIdOrUuid, userId]);
  return rows.length > 0;
}

async function canAccessClient(user, clientIdOrUuid) {
  if (hasOperationalScope(user?.role)) return true;
  const field = isUUID(String(clientIdOrUuid ?? '')) ? 'uuid' : 'id';
  const normalizedRole = String(user?.role || '').toLowerCase();

  if (normalizedRole === 'client') {
    const { rows } = await db.query(
      `SELECT 1 FROM clients WHERE ${field} = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
      [clientIdOrUuid, user.email || '']
    );
    return rows.length > 0;
  }

  const { rows } = await db.query(`
    SELECT 1
    FROM clients cl
    JOIN cases c ON c.client_id = cl.id
    LEFT JOIN macrocasos m ON c.macrocaso_id = m.id
    WHERE cl.${field} = $1
      AND (c.assigned_to = $2 OR c.created_by = $2 OR m.lead_lawyer = $2)
    LIMIT 1
  `, [clientIdOrUuid, user.id]);
  return rows.length > 0;
}

async function canAccessMacrocaso(userId, role, macrocasoIdOrUuid) {
  if (hasOperationalScope(role)) return true;
  const field = isUUID(String(macrocasoIdOrUuid ?? '')) ? 'uuid' : 'id';
  const { rows } = await db.query(`
    SELECT 1 FROM macrocasos m
    LEFT JOIN cases c ON c.macrocaso_id = m.id
    WHERE m.${field} = $1
      AND (m.lead_lawyer = $2 OR m.created_by = $2 OR c.assigned_to = $2)
    LIMIT 1
  `, [macrocasoIdOrUuid, userId]);
  return rows.length > 0;
}

const authorizeCase = (paramName = 'id') => async (req, res, next) => {
  if (hasOperationalScope(req.user?.role)) return next();
  const caseId = req.params[paramName];
  if (!caseId) return next();
  try {
    const ok = await canAccessCase(req.user.id, req.user.role, caseId);
    if (!ok) return res.status(403).json({ error: 'No autorizado para acceder a este caso' });
    next();
  } catch (err) {
    next(err);
  }
};

const authorizeMacrocaso = (paramName = 'id') => async (req, res, next) => {
  if (hasOperationalScope(req.user?.role)) return next();
  const macrocasoId = req.params[paramName];
  if (!macrocasoId) return next();
  try {
    const ok = await canAccessMacrocaso(req.user.id, req.user.role, macrocasoId);
    if (!ok) return res.status(403).json({ error: 'No autorizado para acceder a este macrocaso' });
    next();
  } catch (err) {
    next(err);
  }
};

const authorizeResource = (table, idParam = 'id') => async (req, res, next) => {
  if (hasOperationalScope(req.user?.role)) return next();
  const resourceId = req.params[idParam];
  try {
    const { rows } = await db.query(
      `SELECT case_id, macrocaso_id, created_by,
              CASE WHEN EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = $2 AND column_name = 'assigned_to'
              ) THEN assigned_to ELSE NULL END AS assigned_to
       FROM ${table} WHERE id = $1`,
      [resourceId, table]
    );
    if (!rows.length) return res.status(404).json({ error: 'Recurso no encontrado' });
    const { case_id, macrocaso_id, created_by, assigned_to } = rows[0];

    if (case_id) {
      const ok = await canAccessCase(req.user.id, req.user.role, case_id);
      if (!ok) return res.status(403).json({ error: 'No autorizado' });
    } else if (macrocaso_id) {
      const ok = await canAccessMacrocaso(req.user.id, req.user.role, macrocaso_id);
      if (!ok) return res.status(403).json({ error: 'No autorizado' });
    } else {
      const isOwner = (created_by != null && created_by === req.user.id) ||
                      (assigned_to != null && assigned_to === req.user.id);
      if (!isOwner) return res.status(403).json({ error: 'No autorizado' });
    }
    next();
  } catch (err) {
    next(err);
  }
};

function buildCasesFilter(userId, role, offset = 1) {
  if (hasOperationalScope(role)) return { clause: '', params: [], next: offset };
  return {
    clause: `(c.assigned_to = $${offset} OR c.created_by = $${offset + 1} OR EXISTS (
      SELECT 1 FROM macrocasos _m
      WHERE _m.id = c.macrocaso_id AND _m.lead_lawyer = $${offset + 2}
    ))`,
    params: [userId, userId, userId],
    next: offset + 3,
  };
}

function buildClientsFilter(user, alias = 'cl', offset = 1) {
  if (hasOperationalScope(user?.role)) return { clause: '', params: [], next: offset };

  const role = String(user?.role || '').toLowerCase();
  if (role === 'client') {
    return {
      clause: `LOWER(${alias}.email) = LOWER($${offset})`,
      params: [user.email || ''],
      next: offset + 1,
    };
  }

  return {
    clause: `EXISTS (
      SELECT 1
      FROM cases _c
      LEFT JOIN macrocasos _m ON _c.macrocaso_id = _m.id
      WHERE _c.client_id = ${alias}.id
        AND (_c.assigned_to = $${offset} OR _c.created_by = $${offset + 1} OR _m.lead_lawyer = $${offset + 2})
    )`,
    params: [user.id, user.id, user.id],
    next: offset + 3,
  };
}

function buildMacrocasosFilter(userId, role, offset = 1) {
  if (hasOperationalScope(role)) return { clause: '', params: [], next: offset };
  return {
    clause: `(m.lead_lawyer = $${offset} OR m.created_by = $${offset + 1} OR EXISTS (
      SELECT 1 FROM cases _c
      WHERE _c.macrocaso_id = m.id AND _c.assigned_to = $${offset + 2}
    ))`,
    params: [userId, userId, userId],
    next: offset + 3,
  };
}

module.exports = {
  canAccessCase,
  canAccessClient,
  canAccessMacrocaso,
  authorizeCase,
  authorizeMacrocaso,
  authorizeResource,
  requireInternal,
  requireOperational,
  buildCasesFilter,
  buildClientsFilter,
  buildMacrocasosFilter,
  hasOperationalScope,
  hasInternalScope,
};
