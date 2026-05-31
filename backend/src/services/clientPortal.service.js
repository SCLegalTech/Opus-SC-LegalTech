/**
 * clientPortal.service.js
 * ─────────────────────────────────────────────────────────────
 * Portal del cliente final — acceso público vía token sin cuenta.
 *
 * Diseño:
 *   - Token plano (64 chars hex) se entrega UNA vez en createToken().
 *   - En DB solo guardamos SHA-256 del token plano (token_hash).
 *   - Cliente accede vía URL /portal/:token → backend valida hash.
 *
 * Scope por defecto: { case: true, documents: true }.
 * El abogado puede crear tokens con scope reducido.
 *
 * Comparte documentos solo si documents.shared_with_client = TRUE.
 */

const crypto = require('crypto');
const db = require('../config/db');

const DEFAULT_SCOPES = { case: true, documents: true };
const DEFAULT_TTL_DAYS = 30;

function generateTokenPlain() {
  return crypto.randomBytes(32).toString('hex');     // 64 chars hex
}

function hashToken(plain) {
  return crypto.createHash('sha256').update(plain, 'utf8').digest('hex');
}

async function createToken({ caseId, clientId, organizationId, createdBy, label, scopes, ttlDays = DEFAULT_TTL_DAYS }) {
  if (!caseId && !clientId) throw new Error('createToken requiere caseId o clientId');

  const tokenPlain = generateTokenPlain();
  const tokenHash = hashToken(tokenPlain);
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);

  const finalScopes = { ...DEFAULT_SCOPES, ...(scopes || {}) };

  const { rows } = await db.query(
    `INSERT INTO client_portal_tokens
       (token_hash, case_id, client_id, organization_id, created_by, label, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     RETURNING id, uuid, case_id, client_id, label, scopes, expires_at, created_at`,
    [tokenHash, caseId || null, clientId || null, organizationId || null, createdBy || null,
     label || null, JSON.stringify(finalScopes), expiresAt]
  );

  // Audit
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible, case_id, user_id)
       VALUES ('portal.token_create', $1::jsonb, $2::jsonb, 'executed', true, $3, $4)`,
      [
        JSON.stringify({ case_id: caseId, client_id: clientId, label }),
        JSON.stringify({ token_id: rows[0].id, expires_at: expiresAt }),
        caseId || null, createdBy || null,
      ]
    );
  } catch (e) {
    console.warn('[portal] audit failed:', e.message);
  }

  return {
    token_plain: tokenPlain,                       // único momento donde se devuelve
    token: rows[0],
  };
}

async function validateToken(tokenPlain) {
  if (!tokenPlain || typeof tokenPlain !== 'string' || tokenPlain.length < 16) return null;

  const hash = hashToken(tokenPlain);
  const { rows } = await db.query(
    `SELECT * FROM client_portal_tokens
      WHERE token_hash = $1
        AND expires_at > NOW()
        AND revoked_at IS NULL
      LIMIT 1`,
    [hash]
  );
  if (!rows.length) return null;

  // Actualizar uso (best-effort)
  db.query(
    `UPDATE client_portal_tokens
        SET last_used_at = NOW(), use_count = use_count + 1
      WHERE id = $1`,
    [rows[0].id]
  ).catch(() => {});

  return rows[0];
}

async function getCaseView(token) {
  if (!token.case_id) return null;
  if (!token.scopes?.case) return { error: 'Sin permiso para ver el caso', code: 'SCOPE_DENIED' };

  const { rows } = await db.query(
    `SELECT c.id, c.case_number, c.title, c.status, c.service_type, c.jurisdiction,
            c.next_action, c.next_action_date, c.response_deadline,
            cl.full_name AS client_name, cl.email AS client_email
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1
      LIMIT 1`,
    [token.case_id]
  );
  return rows[0] || null;
}

async function listDocuments(token) {
  if (!token.case_id) return [];
  if (!token.scopes?.documents) return [];

  const { rows } = await db.query(
    `SELECT id, name, title, document_type, file_path, drive_file_id, created_at
       FROM documents
      WHERE case_id = $1 AND shared_with_client = TRUE
      ORDER BY created_at DESC
      LIMIT 100`,
    [token.case_id]
  );
  // Normalizar shape para el frontend
  return rows.map((r) => ({
    id: r.id,
    name: r.title || r.name,
    file_type: r.document_type,
    drive_file_url: r.drive_file_id ? `https://drive.google.com/file/d/${r.drive_file_id}/view` : null,
    created_at: r.created_at,
  }));
}

async function getDashboard(token) {
  const [caseView, documents] = await Promise.all([
    getCaseView(token),
    listDocuments(token),
  ]);
  return {
    token: {
      label: token.label,
      expires_at: token.expires_at,
      scopes: token.scopes,
    },
    case: caseView,
    documents,
  };
}

async function listCaseTokens(caseId) {
  const { rows } = await db.query(
    `SELECT id, uuid, label, scopes, expires_at, revoked_at, last_used_at, use_count, created_at
       FROM client_portal_tokens
      WHERE case_id = $1
      ORDER BY created_at DESC`,
    [caseId]
  );
  return rows;
}

async function revokeToken({ tokenId, revokedBy }) {
  const { rows } = await db.query(
    `UPDATE client_portal_tokens
        SET revoked_at = NOW(), revoked_by = $1
      WHERE id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [revokedBy, tokenId]
  );
  return rows.length > 0;
}

module.exports = {
  createToken,
  validateToken,
  getDashboard,
  getCaseView,
  listDocuments,
  listCaseTokens,
  revokeToken,
};
