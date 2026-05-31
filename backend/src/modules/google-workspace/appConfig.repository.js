/**
 * appConfig.repository.js
 * ─────────────────────────────────────────────────────────────
 * Lee y escribe configuración del sistema desde la tabla app_config.
 * Usado por google-workspace para obtener Client ID/Secret sin
 * depender exclusivamente de variables de entorno.
 *
 * Orden de resolución de un valor:
 *   1. Tabla app_config (configurado por admin desde la UI)
 *   2. Variable de entorno (fallback para desarrollo local)
 */

const db = require('../../config/db');

const CONFIG_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
];

async function getAll() {
  const { rows } = await db.query(
    `SELECT key, value, description, is_secret, updated_at
       FROM app_config
      WHERE key = ANY($1)
      ORDER BY key`,
    [CONFIG_KEYS]
  );
  return rows;
}

async function getValue(key) {
  const { rows } = await db.query(
    `SELECT value FROM app_config WHERE key = $1`, [key]
  );
  const dbValue = rows[0]?.value;
  // Fallback a variable de entorno si la DB no tiene valor
  return dbValue || process.env[key] || null;
}

async function setValue(key, value, userId) {
  if (!CONFIG_KEYS.includes(key)) {
    throw new Error(`Clave de configuración no permitida: ${key}`);
  }
  const { rows } = await db.query(
    `INSERT INTO app_config (key, value, updated_by, updated_at)
          VALUES ($1, $2, (SELECT id FROM users WHERE id = $3), NOW())
     ON CONFLICT (key) DO UPDATE SET
          value      = EXCLUDED.value,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW()
       RETURNING key, description, is_secret, updated_at`,
    [key, value || null, userId]
  );
  return rows[0];
}

async function setMany(entries, userId) {
  const results = [];
  for (const { key, value } of entries) {
    results.push(await setValue(key, value, userId));
  }
  return results;
}

async function getGoogleCredentials() {
  const [clientId, clientSecret, redirectUri] = await Promise.all([
    getValue('GOOGLE_CLIENT_ID'),
    getValue('GOOGLE_CLIENT_SECRET'),
    getValue('GOOGLE_REDIRECT_URI'),
  ]);
  return { clientId, clientSecret, redirectUri };
}

module.exports = {
  CONFIG_KEYS,
  getAll,
  getValue,
  setValue,
  setMany,
  getGoogleCredentials,
};
