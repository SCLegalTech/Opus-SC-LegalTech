const jwt = require('jsonwebtoken');
const { timingSafeEqual } = require('crypto');
const { JWT_SECRET } = require('../config/secrets');
const db = require('../config/db');
const { pool, enterTenantScope } = require('../config/db');

// Identidad del usuario de servicio que usa mcp-server para llamar al backend.
// Cuando el JWT entrante pertenece a este usuario Y la petición trae el header
// X-On-Behalf-Of, el middleware sustituye req.user por el usuario impersonado
// para que la RBAC del resto del sistema (canAccessCase, buildCasesFilter, etc.)
// se aplique con la identidad real de quien le habla al agente, no con la del
// servicio. Si MCP_SERVICE_USER_ID no está configurado, el header se ignora —
// retrocompatible con instalaciones que aún no han migrado.
const MCP_SERVICE_USER_ID = (() => {
  const raw = process.env.MCP_SERVICE_USER_ID;
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();

const MCP_API_TOKEN = process.env.MCP_API_TOKEN || '';

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

async function loadUserById(id) {
  const { rows } = await db.query(
    `SELECT id, name, email, role, account_category, active
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// Resuelve la organización default del usuario impersonado, con la misma
// lógica de prelación que el login (resolveDefaultOrganization en
// auth.controller). Está acotado al userId: jamás puede devolver una
// organización a la que el usuario no pertenezca. Pre-migración (sin tabla
// user_organizations) → null, y el path cae a modo legacy single-tenant.
async function loadOrgContextById(userId) {
  try {
    const { rows } = await db.query(
      `SELECT uo.organization_id, uo.role AS org_role, o.slug AS org_slug
       FROM user_organizations uo
       JOIN organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1 AND o.active = TRUE
       ORDER BY
         CASE uo.role
           WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'lawyer' THEN 3
           WHEN 'accountant' THEN 4 WHEN 'viewer' THEN 5 ELSE 99 END,
         uo.joined_at ASC
       LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null; // tabla no existe — pre-migración
    throw err;
  }
}

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }

  const token = header.split(' ')[1];
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    if (!MCP_API_TOKEN || !MCP_SERVICE_USER_ID || !safeEqual(token, MCP_API_TOKEN)) {
      return res.status(401).json({ error: 'Token invalido o expirado' });
    }

    try {
      const serviceUser = await loadUserById(MCP_SERVICE_USER_ID);
      if (!serviceUser || serviceUser.active === false) {
        return res.status(403).json({ error: 'Servicio MCP no disponible' });
      }
      decoded = {
        id: serviceUser.id,
        name: serviceUser.name,
        email: serviceUser.email,
        role: serviceUser.role,
        account_category: serviceUser.account_category,
      };
      const orgCtx = await loadOrgContextById(serviceUser.id);
      if (orgCtx) {
        decoded.org_id = orgCtx.organization_id;
        decoded.org_role = orgCtx.org_role;
        decoded.org_slug = orgCtx.org_slug;
      }
      req.viaMcp = true;
      req.mcpServiceId = serviceUser.id;
      req.mcpServiceToken = true;
    } catch (serviceErr) {
      return next(serviceErr);
    }
  }

  req.user = decoded;

  // Impersonación controlada para el path agéntico (mcp-server → backend).
  // Solo el JWT del usuario de servicio MCP puede emitir X-On-Behalf-Of.
  // Cualquier otro origen que envíe el header recibe 403, para que la
  // posibilidad de impersonar quede acotada exclusivamente a la cadena MCP.
  const onBehalfHeader = req.headers['x-on-behalf-of'];
  if (req.mcpServiceToken && !onBehalfHeader) {
    return res.status(403).json({
      error: 'El token de servicio MCP requiere X-On-Behalf-Of',
    });
  }
  if (onBehalfHeader) {
    if (!MCP_SERVICE_USER_ID || decoded.id !== MCP_SERVICE_USER_ID) {
      return res.status(403).json({
        error: 'X-On-Behalf-Of solo está permitido para el servicio MCP',
      });
    }
    const targetId = parseInt(String(onBehalfHeader), 10);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      return res.status(400).json({ error: 'X-On-Behalf-Of inválido' });
    }
    try {
      const target = await loadUserById(targetId);
      if (!target || target.active === false) {
        return res.status(403).json({ error: 'Usuario X-On-Behalf-Of no disponible' });
      }
      req.user = {
        id: target.id,
        name: target.name,
        email: target.email,
        role: target.role,
        account_category: target.account_category,
      };
      // Propaga el contexto de organización del usuario impersonado para que
      // el tenant scope (abajo) y el bus en vivo del Puente de Mando apliquen
      // al tenant del actor real, no a ninguno. Sin esto, las mutaciones por
      // MCP externo quedaban fuera de scope. Acotado al userId: no cruza orgs.
      const orgCtx = await loadOrgContextById(target.id);
      if (orgCtx) {
        req.user.org_id = orgCtx.organization_id;
        req.user.org_role = orgCtx.org_role;
        req.user.org_slug = orgCtx.org_slug;
      }
      req.viaMcp = true;
      req.mcpServiceId = decoded.id;
    } catch (err) {
      return next(err);
    }
  }

  // Tenant scope: si el JWT (o el usuario impersonado vía MCP) tiene org_id,
  // adquirimos un cliente PG dedicado con `app.organization_id` seteado y lo
  // dejamos en AsyncLocalStorage para que `db.query(...)` lo use sin que los
  // controladores tengan que cambiar.
  //
  // Pre-migración v15→v16 (sin tabla user_organizations), org_id es null y
  // todo cae al pool global como hasta ahora — compat completa.
  const orgId = req.user && req.user.org_id;
  if (orgId) {
    let client;
    try {
      client = await pool.connect();
      await client.query("SELECT set_config('app.organization_id', $1, false)", [String(orgId)]);
      enterTenantScope({ orgId, client });
      req.organization_id = orgId;
      let released = false;
      const release = () => {
        if (released || !client) return;
        released = true;
        try { client.release(); } catch (_) { /* ignore */ }
        client = null;
      };
      res.on('finish', release);
      res.on('close', release);
    } catch (err) {
      if (client) { try { client.release(); } catch (_) {} }
      console.error('[auth/tenant-scope] error adquiriendo cliente PG:', err.message);
      // Sin romper la request: cae a pool global. RLS no aplica, controladores
      // que filtran por organization_id explícito siguen funcionando.
    }
  }

  next();
};

module.exports = { authenticate };
