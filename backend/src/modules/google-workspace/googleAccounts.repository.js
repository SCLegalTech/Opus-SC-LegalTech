/**
 * googleAccounts.repository.js
 * ─────────────────────────────────────────────────────────────
 * Persistencia de tokens OAuth por usuario.
 * Tabla: google_accounts (renombrada de gmail_accounts en v5→v6).
 * Cubre Gmail + Drive + futuros servicios Google en una sola fila.
 */

const db = require('../../config/db');

async function upsertAccount({
  userId, email, access_token, refresh_token,
  expiry_date, scope, scopes_granted = [],
}) {
  const { rows } = await db.query(
    `INSERT INTO google_accounts
       (user_id, email, access_token, refresh_token, token_expiry, scope, scopes_granted, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       email          = EXCLUDED.email,
       access_token   = EXCLUDED.access_token,
       refresh_token  = COALESCE(EXCLUDED.refresh_token, google_accounts.refresh_token),
       token_expiry   = EXCLUDED.token_expiry,
       scope          = EXCLUDED.scope,
       scopes_granted = EXCLUDED.scopes_granted,
       updated_at     = NOW()
     RETURNING id, user_id, email, scopes_granted, created_at, updated_at`,
    [userId, email, access_token, refresh_token, expiry_date, scope, scopes_granted]
  );
  return rows[0];
}

async function getAccountByUserId(userId) {
  const { rows } = await db.query(
    `SELECT id, user_id, email, access_token, refresh_token,
            token_expiry, scope, scopes_granted, created_at, updated_at
       FROM google_accounts
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function deleteAccountByUserId(userId) {
  await db.query(`DELETE FROM google_accounts WHERE user_id = $1`, [userId]);
}

module.exports = { upsertAccount, getAccountByUserId, deleteAccountByUserId };
