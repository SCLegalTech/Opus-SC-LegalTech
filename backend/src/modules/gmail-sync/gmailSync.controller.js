/**
 * gmailSync.controller.js
 * ─────────────────────────────────────────────────────────────
 * Handlers HTTP para sincronización a nivel de caso.
 * Rutas montadas bajo /api/cases/:caseId/gmail
 */

const service = require('./gmailSync.service');

async function syncToCase(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });

  const { query, threadId, maxResults } = req.body || {};
  if (!query && !threadId) {
    return res.status(400).json({
      error: 'Debe proporcionar `query` (búsqueda Gmail) o `threadId`',
    });
  }

  try {
    const result = await service.syncToCase({
      userId: req.user.id,
      caseId,
      query,
      threadId,
      maxResults: Math.min(Number(maxResults) || 20, 50),
    });
    res.json(result);
  } catch (err) {
    if (err.code === 'GMAIL_NOT_CONNECTED') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error('[gmail-sync] syncToCase error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listCaseMessages(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });

  try {
    const messages = await service.listCaseMessages(caseId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { syncToCase, listCaseMessages };
