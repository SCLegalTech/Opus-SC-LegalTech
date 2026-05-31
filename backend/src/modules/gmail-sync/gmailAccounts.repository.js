/**
 * gmailAccounts.repository.js
 * ─────────────────────────────────────────────────────────────
 * Persistencia de tokens OAuth por usuario. Tabla propia del
 * módulo (`gmail_accounts`), no toca tablas del core.
 */

const db = require('../../config/db');

async function upsertAccount({ userId, email, access_token, refresh_token, expiry_date, scope }) {
  const { rows } = await db.query(
    `INSERT INTO gmail_accounts (user_id, email, access_token, refresh_token, token_expiry, scope, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
          email         = EXCLUDED.email,
          access_token  = EXCLUDED.access_token,
          refresh_token = COALESCE(EXCLUDED.refresh_token, gmail_accounts.refresh_token),
          token_expiry  = EXCLUDED.token_expiry,
          scope         = EXCLUDED.scope,
          updated_at    = NOW()
       RETURNING id, user_id, email, created_at, updated_at`,
    [userId, email, access_token, refresh_token, expiry_date, scope]
  );
  return rows[0];
}

async function getAccountByUserId(userId) {
  const { rows } = await db.query(
    `SELECT id, user_id, email, access_token, refresh_token, token_expiry, scope, created_at, updated_at
       FROM gmail_accounts
      WHERE user_id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function deleteAccountByUserId(userId) {
  await db.query(`DELETE FROM gmail_accounts WHERE user_id = $1`, [userId]);
}

module.exports = {
  upsertAccount,
  getAccountByUserId,
  deleteAccountByUserId,
};
