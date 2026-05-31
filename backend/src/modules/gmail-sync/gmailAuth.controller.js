/**
 * gmailAuth.controller.js
 * ─────────────────────────────────────────────────────────────
 * Handlers HTTP para el flujo OAuth 2.0 con Google.
 *
 * Estrategia de state:
 * - /auth/url recibe el usuario autenticado por JWT y devuelve
 *   una URL de consentimiento cuyo `state` codifica el userId
 *   firmado brevemente con JWT_SECRET.
 * - /auth/callback valida ese state y completa el intercambio.
 *   Esto evita pasar la cookie/bearer de la app a Google.
 */

const jwt = require('jsonwebtoken');
const gmailClient = require('./gmailClient');
const service     = require('./gmailSync.service');
const { JWT_SECRET } = require('../../config/secrets');

const STATE_TTL_SECONDS = 600; // 10 minutos

function signState(userId) {
  return jwt.sign(
    { uid: userId, p: 'gmail-oauth' },
    JWT_SECRET,
    { expiresIn: STATE_TTL_SECONDS }
  );
}

function verifyState(state) {
  try {
    const decoded = jwt.verify(state, JWT_SECRET);
    if (decoded.p !== 'gmail-oauth') return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

async function getAuthUrl(req, res) {
  try {
    const state = signState(req.user.id);
    const url   = gmailClient.getAuthUrl(state);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function oauthCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    return res.status(400).send(`Autorización denegada por Google: ${error}`);
  }
  if (!code || !state) {
    return res.status(400).send('Faltan parámetros code/state');
  }

  const userId = verifyState(state);
  if (!userId) {
    return res.status(401).send('State inválido o expirado');
  }

  try {
    const account = await service.completeOAuth({ userId, code });
    const redirect = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${redirect}/settings/integrations?gmail=connected&email=${encodeURIComponent(account.email)}`);
  } catch (err) {
    console.error('[gmail-sync] OAuth callback error:', err);
    res.status(500).send(`Error al completar OAuth: ${err.message}`);
  }
}

async function getStatus(req, res) {
  try {
    const status = await service.getStatus(req.user.id);
    res.json(status);
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

module.exports = { getAuthUrl, oauthCallback, getStatus, disconnect };
