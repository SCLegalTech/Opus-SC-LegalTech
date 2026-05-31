const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../config/db');
const emailSvc = require('../services/email.service');
const { JWT_SECRET } = require('../config/secrets');

const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';
const FIRM_DOMAIN = process.env.FIRM_DOMAIN || 'example.com';

const googleClient = process.env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
  : null;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function listEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((item) => normalizeEmail(item)).filter(Boolean);
}

const ADMIN_EMAILS = listEnv('ADMIN_EMAILS', ['admin.demo@example.com']);
const PARTNER_EMAILS = listEnv('PARTNER_EMAILS', [
  'abogado.demo@example.com',
]);

const ALLOWED_SIGNUP_DOMAINS = listEnv('ALLOWED_SIGNUP_DOMAINS', [FIRM_DOMAIN])
  .map((d) => (d.startsWith('@') ? d.slice(1) : d))
  .filter(Boolean);
const SIGNUP_OPEN = ALLOWED_SIGNUP_DOMAINS.includes('*');

function isFirmEmail(email) {
  return normalizeEmail(email).endsWith(`@${FIRM_DOMAIN}`);
}

function isAllowedSignupEmail(email) {
  if (SIGNUP_OPEN) return true;
  const normalized = normalizeEmail(email);
  return ALLOWED_SIGNUP_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`));
}

function inferRole(email, requestedRole) {
  const normalized = normalizeEmail(email);
  if (ADMIN_EMAILS.includes(normalized)) {
    return { role: 'admin', category: 'admin' };
  }

  if (requestedRole === 'partner') {
    if (!isFirmEmail(normalized)) {
      throw new Error(`Los abogados socios deben usar correo institucional @${FIRM_DOMAIN}`);
    }
    return { role: 'partner', category: 'partner_lawyer' };
  }

  if (PARTNER_EMAILS.includes(normalized)) {
    return { role: 'partner', category: 'partner_lawyer' };
  }

  if (isFirmEmail(normalized) && !requestedRole) {
    return { role: 'partner', category: 'partner_lawyer' };
  }

  // Roles internos privilegiados (associate, assistant, lawyer) requieren
  // email institucional. Antes se aceptaba `requestedRole` sin verificar el
  // dominio: si ALLOWED_SIGNUP_DOMAINS estaba abierto o incluÃ­a otros
  // dominios, un externo podÃ­a auto-asignarse rol de abogado.
  const internalRoles = { associate: 'associate_lawyer', assistant: 'assistant', lawyer: 'associate_lawyer' };
  if (requestedRole && internalRoles[requestedRole]) {
    if (!isFirmEmail(normalized)) {
      // Defense-in-depth: el caller deberÃ­a haber filtrado por dominio. AquÃ­
      // ignoramos el role solicitado en lugar de lanzar para no bloquear el
      // flujo de signup pÃºblico (cliente externo) â€” termina como client.
      return { role: 'client', category: 'client' };
    }
    const role = requestedRole === 'lawyer' ? 'associate' : requestedRole;
    return { role, category: internalRoles[requestedRole] };
  }

  return { role: 'client', category: 'client' };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    account_category: user.account_category,
    auth_provider: user.auth_provider,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
  };
}

function signUser(user, organizationContext = null) {
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    account_category: user.account_category,
  };
  if (organizationContext) {
    payload.org_id = organizationContext.organization_id;
    payload.org_role = organizationContext.role;
    payload.org_slug = organizationContext.slug;
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// Resuelve la organizaciÃ³n default del usuario tras login. Si la migraciÃ³n
// v15â†’v16 todavÃ­a no se ha aplicado (tabla user_organizations no existe),
// retorna null silenciosamente â€” el sistema sigue operando en modo legacy
// single-tenant hasta que la DB estÃ© lista.
async function resolveDefaultOrganization(userId) {
  try {
    const { rows } = await db.query(
      `SELECT uo.organization_id, uo.role, o.slug, o.brand_name
       FROM user_organizations uo
       JOIN organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1 AND o.active = TRUE
       ORDER BY
         CASE uo.role
           WHEN 'owner'      THEN 1
           WHEN 'admin'      THEN 2
           WHEN 'lawyer'     THEN 3
           WHEN 'accountant' THEN 4
           WHEN 'viewer'     THEN 5
           ELSE 99
         END,
         uo.joined_at ASC
       LIMIT 1`,
      [userId]
    );
    return rows[0] || null;
  } catch (err) {
    if (err.code === '42P01') return null; // tabla no existe â€” pre-migraciÃ³n
    throw err;
  }
}

// Audit log de eventos de auth. Best-effort: nunca rompe la request.
// Habeas Data (Ley 1581) requiere trazabilidad de accesos a datos personales.
async function logAuthEvent({ req, email, userId, eventType, reason }) {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || null;
    const ua = req.headers['user-agent'] || null;
    await db.query(
      `INSERT INTO auth_audit (email, user_id, event_type, ip_address, user_agent, reason)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [email || '', userId || null, eventType, ip, ua, reason || null]
    );
  } catch (err) {
    console.warn('[auth_audit] no se pudo registrar evento:', err.message);
  }
}

async function findActiveUser(email) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, role, active, auth_provider,
            google_sub, avatar_url, account_category, created_at
     FROM users
     WHERE email = $1 AND active = true`,
    [normalizeEmail(email)]
  );
  return rows[0] || null;
}

async function finishLogin(user, res) {
  const orgContext = await resolveDefaultOrganization(user.id);
  const token = signUser(user, orgContext);
  await db.query('UPDATE users SET last_login = NOW(), updated_at = NOW() WHERE id = $1', [user.id]);
  return res.json({
    token,
    user: publicUser(user),
    organization: orgContext ? {
      id: orgContext.organization_id,
      slug: orgContext.slug,
      brand_name: orgContext.brand_name,
      role: orgContext.role,
    } : null,
  });
}

const login = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const { password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contrasena son requeridos' });
  }

  try {
    const user = await findActiveUser(email);
    if (!user || !user.password_hash) {
      await logAuthEvent({ req, email, eventType: 'login_failure', reason: 'user_not_found_or_no_password' });
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await logAuthEvent({ req, email, userId: user.id, eventType: 'login_failure', reason: 'wrong_password' });
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    await logAuthEvent({ req, email, userId: user.id, eventType: 'login_success' });
    return finishLogin(user, res);
  } catch (err) {
    console.error('[auth] login error:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

const register = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password || '');
  const requestedRole = req.body?.role;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nombre, email y contrasena son requeridos' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contrasena debe tener minimo 8 caracteres' });
  }
  if (!isAllowedSignupEmail(email)) {
    await logAuthEvent({ req, email, eventType: 'register_blocked_domain', reason: 'domain_not_allowed' });
    return res.status(403).json({
      error: `El registro esta restringido. Solo se aceptan correos de los dominios autorizados: ${ALLOWED_SIGNUP_DOMAINS.join(', ')}`,
    });
  }

  try {
    const { role, category } = inferRole(email, requestedRole);
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO users (
         name, email, password_hash, role, active, auth_provider,
         account_category, accepted_terms_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, TRUE, 'password', $5, NOW(), NOW(), NOW())
       RETURNING id, name, email, role, auth_provider, account_category, avatar_url, created_at`,
      [name, email, hash, role, category]
    );
    await logAuthEvent({ req, email, userId: rows[0].id, eventType: 'register_success' });
    return finishLogin(rows[0], res);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
    }
    if (err.message?.includes('correo institucional')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[auth] register error:', err);
    return res.status(500).json({ error: 'Error registrando usuario' });
  }
};

async function verifyGoogleCredential(credential) {
  if (!googleClient) {
    throw new Error('GOOGLE_CLIENT_ID no esta configurado en backend');
  }
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload?.email_verified) {
    throw new Error('Google no confirmo el correo de la cuenta');
  }
  return payload;
}

const googleLogin = async (req, res) => {
  const { credential, requested_role } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Credential de Google requerida' });
  }

  try {
    const payload = await verifyGoogleCredential(credential);
    const email = normalizeEmail(payload.email);
    const existing = await findActiveUser(email);

    if (existing) {
      await db.query(
        `UPDATE users
         SET google_sub = COALESCE(google_sub, $1),
             avatar_url = COALESCE($2, avatar_url),
             auth_provider = CASE
               WHEN auth_provider = 'password' THEN 'password_google'
               ELSE auth_provider
             END,
             updated_at = NOW()
         WHERE id = $3`,
        [payload.sub, payload.picture || null, existing.id]
      );
      await logAuthEvent({ req, email, userId: existing.id, eventType: 'google_login_success' });
      return finishLogin({ ...existing, google_sub: payload.sub, avatar_url: payload.picture || existing.avatar_url }, res);
    }

    if (!isAllowedSignupEmail(email)) {
      await logAuthEvent({ req, email, eventType: 'google_login_blocked_domain', reason: 'domain_not_allowed' });
      return res.status(403).json({
        error: `El registro esta restringido. Solo se aceptan correos de los dominios autorizados: ${ALLOWED_SIGNUP_DOMAINS.join(', ')}`,
      });
    }

    const { role, category } = inferRole(email, requested_role);
    const randomHash = await bcrypt.hash(`google:${payload.sub}:${Date.now()}`, 10);
    const { rows } = await db.query(
      `INSERT INTO users (
         name, email, password_hash, role, active, auth_provider,
         google_sub, avatar_url, account_category, accepted_terms_at,
         created_at, updated_at
       ) VALUES ($1, $2, $3, $4, TRUE, 'google', $5, $6, $7, NOW(), NOW(), NOW())
       RETURNING id, name, email, role, auth_provider, google_sub, avatar_url, account_category, created_at`,
      [
        payload.name || email.split('@')[0],
        email,
        randomHash,
        role,
        payload.sub,
        payload.picture || null,
        category,
      ]
    );
    await logAuthEvent({ req, email, userId: rows[0].id, eventType: 'google_login_success', reason: 'new_user_created' });
    return finishLogin(rows[0], res);
  } catch (err) {
    console.error('[auth] google error:', err.message);
    return res.status(401).json({ error: err.message || 'No se pudo autenticar con Google' });
  }
};

const authConfig = (req, res) => {
  res.json({
    google_enabled: Boolean(process.env.GOOGLE_CLIENT_ID),
    firm_domain: FIRM_DOMAIN,
    signup_open: SIGNUP_OPEN,
    allowed_signup_domains: SIGNUP_OPEN ? [] : ALLOWED_SIGNUP_DOMAINS,
    role_options: [
      { value: 'client', label: 'Cliente' },
      { value: 'assistant', label: 'Auxiliar' },
      { value: 'associate', label: 'Abogado asociado' },
      { value: 'partner', label: 'Abogado socio' },
    ],
  });
};

const me = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, email, role, auth_provider, account_category,
              avatar_url, created_at
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(publicUser(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Contrasenas requeridas' });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Contrasena actual incorrecta' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [hash, req.user.id]);

    res.json({ message: 'Contrasena actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error en el servidor' });
  }
};


// â”€â”€ POST /api/auth/forgot-password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Solicitud de restablecimiento de contraseÃ±a. Reutiliza la infraestructura de
// magic_links + /activate (set-password): crea un magic_link de un solo uso y
// envÃ­a un correo con el enlace a /activate?token=...  Responde SIEMPRE de forma
// genÃ©rica para no revelar si el correo existe (anti-enumeraciÃ³n). El envÃ­o del
// correo es best-effort y no bloquea la respuesta (evita filtrar por timing).
const forgotPassword = async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const generic = {
    message: 'Si existe una cuenta con ese correo, te enviaremos un enlace para restablecer tu contraseÃ±a.',
  };
  if (!email || !email.includes('@')) return res.json(generic);

  try {
    const user = await findActiveUser(email);
    if (user) {
      const tokenPlain = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(tokenPlain).digest('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await db.query(
        `INSERT INTO magic_links (token_hash, user_id, purpose, expires_at)
         VALUES ($1, $2, 'set_password', $3)`,
        [tokenHash, user.id, expires]
      );
      const baseUrl = process.env.FRONTEND_URL || 'https://sclegaltech.com';
      const resetUrl = `${baseUrl}/activate?token=${tokenPlain}`;
      const tpl = emailSvc.passwordResetEmail({ resetUrl });
      emailSvc.send({ to: user.email, ...tpl }).catch((e) => console.warn('[auth] reset email error:', e.message));
      await logAuthEvent({ req, email, userId: user.id, eventType: 'password_reset_requested' });
    } else {
      await logAuthEvent({ req, email, eventType: 'password_reset_requested', reason: 'user_not_found' });
    }
  } catch (err) {
    console.error('[auth] forgotPassword error:', err.message);
  }
  return res.json(generic);
};

module.exports = {
  login,
  register,
  googleLogin,
  authConfig,
  me,
  changePassword,
  forgotPassword,
};
