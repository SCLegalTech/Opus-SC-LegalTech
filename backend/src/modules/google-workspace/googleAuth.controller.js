/**
 * googleAuth.controller.js
 * ─────────────────────────────────────────────────────────────
 * Handlers HTTP del flujo OAuth 2.0 con Google.
 * Cubre Gmail + Drive en una sola autorización.
 */

const jwt     = require('jsonwebtoken');
const client  = require('./googleClient');
const service = require('./googleWorkspace.service');
const config  = require('./appConfig.repository');
const { JWT_SECRET } = require('../../config/secrets');

const STATE_TTL = 600;

function signState(userId) {
  return jwt.sign(
    { uid: userId, p: 'google-oauth' },
    JWT_SECRET,
    { expiresIn: STATE_TTL }
  );
}

function verifyState(state) {
  try {
    const d = jwt.verify(state, JWT_SECRET);
    return d.p === 'google-oauth' ? d.uid : null;
  } catch { return null; }
}

async function getAuthUrl(req, res) {
  try {
    const url = await client.getAuthUrl(signState(req.user.id));
    res.json({ url });
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    res.status(500).json({ error: err.message });
  }
}

async function oauthCallback(req, res) {
  const { code, state, error } = req.query;
  if (error)          return res.status(400).send(`Autorización denegada: ${error}`);
  if (!code || !state) return res.status(400).send('Faltan parámetros code/state');

  const userId = verifyState(state);
  if (!userId) return res.status(401).send('State inválido o expirado');

  try {
    const account  = await service.completeOAuth({ userId, code });
    const redirect = process.env.FRONTEND_URL || 'http://localhost:5173';
    const scopes   = (account.scopes_granted || []).join(',');
    res.redirect(
      `${redirect}/settings?google=connected&email=${encodeURIComponent(account.email)}&scopes=${scopes}`
    );
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(409).send(err.message);
    }
    console.error('[google-workspace] OAuth callback error:', err);
    res.status(500).send(`Error al completar OAuth: ${err.message}`);
  }
}

async function getStatus(req, res) {
  try {
    res.json(await service.getStatus(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function disconnect(req, res) {
  try {
    await service.disconnect(req.user.id);
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Configuración del sistema (solo admin) ────────────────────

async function getConfig(req, res) {
  try {
    const rows = await config.getAll();
    // Ocultar valores de claves secretas
    const safe = rows.map(r => ({
      ...r,
      value: r.is_secret && r.value ? '••••••••' : r.value,
    }));
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function saveConfig(req, res) {
  try {
    const entries = req.body; // [{ key, value }, ...]
    if (!Array.isArray(entries) || !entries.length) {
      return res.status(400).json({ error: 'Formato inválido. Envía un array de { key, value }.' });
    }
    const results = await config.setMany(entries, req.user.id);
    res.json({ saved: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getAuthUrl, oauthCallback, getStatus, disconnect, getConfig, saveConfig };
