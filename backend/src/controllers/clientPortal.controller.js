/**
 * clientPortal.controller.js
 *
 * Endpoints públicos (sin JWT, validan token en URL) y autenticados
 * (admin/lawyer crea/revoca tokens desde el caso).
 */

const portal = require('../services/clientPortal.service');

// ─────────────────────────────────────────────────────────────
// Públicos (validan token en URL)
// ─────────────────────────────────────────────────────────────

async function publicDashboard(req, res) {
  const token = req.params.token || req.headers['x-portal-token'];
  if (!token) return res.status(401).json({ error: 'Token requerido' });

  try {
    const tokenRow = await portal.validateToken(token);
    if (!tokenRow) return res.status(401).json({ error: 'Token inválido o expirado' });

    const data = await portal.getDashboard(tokenRow);
    return res.json(data);
  } catch (err) {
    console.error('[portal] dashboard error:', err);
    return res.status(500).json({ error: 'Error cargando portal' });
  }
}

// ─────────────────────────────────────────────────────────────
// Autenticados (gestión desde el caso)
// ─────────────────────────────────────────────────────────────

async function createCaseToken(req, res) {
  const caseId = Number.parseInt(req.params.id || req.params.caseId, 10);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });

  try {
    const orgId = req.organization_id || req.user.org_id || null;
    const result = await portal.createToken({
      caseId,
      organizationId: orgId,
      createdBy: req.user.id,
      label: req.body?.label || `Acceso del cliente al caso #${caseId}`,
      scopes: req.body?.scopes || null,
      ttlDays: req.body?.ttl_days || 30,
    });

    const portalBase = process.env.FRONTEND_URL || 'http://localhost:5173';
    const url = `${portalBase}/portal/${result.token_plain}`;

    return res.status(201).json({
      url,
      token: {
        id: result.token.id,
        uuid: result.token.uuid,
        label: result.token.label,
        scopes: result.token.scopes,
        expires_at: result.token.expires_at,
      },
    });
  } catch (err) {
    console.error('[portal] createCaseToken error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function listCaseTokens(req, res) {
  const caseId = Number.parseInt(req.params.id || req.params.caseId, 10);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });

  try {
    const tokens = await portal.listCaseTokens(caseId);
    return res.json({ tokens });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function revokeCaseToken(req, res) {
  const tokenId = Number.parseInt(req.params.tokenId, 10);
  if (!Number.isFinite(tokenId)) return res.status(400).json({ error: 'tokenId inválido' });

  try {
    const ok = await portal.revokeToken({ tokenId, revokedBy: req.user.id });
    if (!ok) return res.status(404).json({ error: 'Token no encontrado o ya revocado' });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  publicDashboard,
  createCaseToken,
  listCaseTokens,
  revokeCaseToken,
};
