/**
 * inbox.controller.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * RecepciÃ³n Inteligente â€” HTTP handlers.
 *
 * GET  /api/inbox                    â€” lista items pending (triage cache)
 * POST /api/inbox/refresh            â€” jala Gmail inbox y corre triage sobre los nuevos
 * POST /api/inbox/:id/associate      â€” { case_id } â†’ asocia el correo a un caso
 * POST /api/inbox/:id/dismiss        â€” { reason? } â†’ marca dismissed
 * GET  /api/inbox/:id                â€” detalle de un item
 */

const triageService = require('../services/gmailTriage.service');
const googleWorkspace = require('../modules/google-workspace/googleWorkspace.service');
const { canAccessCase } = require('../middleware/authz');

async function listInbox(req, res) {
  try {
    const limit  = clampInt(req.query.limit, 50, 1, 200);
    const offset = clampInt(req.query.offset, 0, 0, 5000);
    const items = await triageService.listPending({
      userId: req.user.id,
      organizationId: req.organization_id || req.user.org_id || null,
      limit,
      offset,
      fromDate: req.query.from || null,
      toDate: req.query.to || null,
      urgency: req.query.urgency || null,
      serviceType: req.query.service_type || null,
      search: req.query.search || req.query.q || null,
      sortBy: req.query.sort || 'confidence',
    });
    return res.json({ items, count: items.length });
  } catch (err) {
    console.error('[inbox] listInbox error:', err);
    return res.status(500).json({ error: 'No se pudo listar la bandeja' });
  }
}

async function getItem(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invÃ¡lido' });
    const item = await triageService.getById({
      userId: req.user.id,
      organizationId: req.organization_id || req.user.org_id || null,
      id,
    });
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    return res.json({ item });
  } catch (err) {
    console.error('[inbox] getItem error:', err);
    return res.status(500).json({ error: 'No se pudo obtener el item' });
  }
}

/**
 * Refresca la bandeja: pide los Ãºltimos N mensajes del inbox de Gmail
 * y corre triage sobre cada uno (idempotente: si ya estÃ¡ triaged y no
 * llegÃ³ force=1, devuelve el cache).
 */
async function refreshInbox(req, res) {
  try {
    const userId = req.user.id;
    const orgId = req.organization_id || req.user.org_id || null;
    const maxResults = clampInt(req.body?.maxResults || req.query?.maxResults, 10, 1, 25);
    const force = req.body?.force === true || req.query?.force === '1';

    const inbox = await googleWorkspace.listGmailInbox({
      userId,
      query: 'in:inbox -category:promotions -category:social',
      maxResults,
    });

    const results = [];
    for (const msg of inbox.messages || []) {
      try {
        const parsed = {
          gmail_message_id: msg.gmail_message_id,
          gmail_thread_id:  msg.thread_id,
          from:             msg.from,
          to:               msg.to,
          subject:          msg.subject,
          date:             msg.date,
          snippet:          msg.snippet,
          body:             msg.snippet,
        };
        const row = await triageService.triageMessage({
          userId,
          organizationId: orgId,
          parsed,
          force,
        });
        results.push({ id: row.id, external_id: row.external_id, status: row.status, service_type: row.service_type });
      } catch (e) {
        console.warn('[inbox] triage fallo en msg', msg.gmail_message_id, ':', e.message);
      }
    }

    return res.json({
      processed: results.length,
      results,
    });
  } catch (err) {
    if (err && (err.code === 'GOOGLE_NOT_CONNECTED' || err.code === 'GOOGLE_NOT_CONFIGURED')) {
      return res.status(409).json({ error: 'Google no conectado. ConÃ©ctalo desde /integrations.', code: err.code });
    }
    console.error('[inbox] refreshInbox error:', err);
    return res.status(500).json({ error: 'No se pudo refrescar la bandeja' });
  }
}

async function associate(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const caseId = Number.parseInt(req.body?.case_id, 10);
    if (!Number.isFinite(id) || !Number.isFinite(caseId)) {
      return res.status(400).json({ error: 'id y case_id son obligatorios' });
    }
    // Authz cross-tenant: el usuario debe poder acceder al caso destino
    if (!(await canAccessCase(req.user.id, req.user.role, caseId))) {
      return res.status(403).json({ error: 'Sin acceso al caso indicado' });
    }
    const item = await triageService.associateToCase({
      userId: req.user.id,
      organizationId: req.organization_id || req.user.org_id || null,
      id,
      caseId,
    });
    return res.json({ item });
  } catch (err) {
    console.error('[inbox] associate error:', err);
    return res.status(400).json({ error: err.message });
  }
}

async function dismiss(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id invÃ¡lido' });
    const item = await triageService.dismiss({
      userId: req.user.id,
      organizationId: req.organization_id || req.user.org_id || null,
      id,
      reason: req.body?.reason || null,
    });
    if (!item) return res.status(404).json({ error: 'No encontrado o ya no estÃ¡ pending' });
    return res.json({ item });
  } catch (err) {
    console.error('[inbox] dismiss error:', err);
    return res.status(500).json({ error: 'No se pudo descartar el item' });
  }
}

function clampInt(v, fallback, min, max) {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  listInbox,
  getItem,
  refreshInbox,
  associate,
  dismiss,
};
