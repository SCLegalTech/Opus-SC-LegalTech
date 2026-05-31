/**
 * googleSync.controller.js
 * ─────────────────────────────────────────────────────────────
 * Handlers HTTP para sincronización Gmail y listado Drive
 * a nivel de caso. Rutas bajo /api/cases/:caseId/google
 */

const service = require('./googleWorkspace.service');

function getGoogleErrorCode(err) {
  return err.response?.data?.error || err.errors?.[0]?.reason || err.code;
}

function handleGoogleWorkspaceError(res, err, context) {
  const code = err.code;
  const isDriveContext = context === 'listDriveFiles';
  if (code === 'GOOGLE_NOT_CONNECTED' || code === 'GOOGLE_NOT_CONFIGURED') {
    return res.status(409).json({ error: err.message, code });
  }

  const googleCode = getGoogleErrorCode(err);
  if (googleCode === 'invalid_request' || googleCode === 'invalid_grant') {
    return res.status(409).json({
      error: 'Google rechazo la autorizacion actual. Reconecta la cuenta en Ajustes / Integraciones.',
      code: 'GOOGLE_RECONNECT_REQUIRED',
    });
  }
  if (err.response?.status === 400) {
    if (isDriveContext) {
      return res.status(400).json({
        error: 'Drive no acepto la busqueda. Ajusta el texto e intenta de nuevo.',
        code: 'DRIVE_QUERY_INVALID',
      });
    }
    return res.status(400).json({
      error: 'Gmail no acepto la solicitud. Ajusta la busqueda o vuelve a intentarlo.',
      code: 'GMAIL_QUERY_INVALID',
    });
  }
  if (err.response?.status === 403) {
    if (isDriveContext) {
      return res.status(409).json({
        error: 'La cuenta conectada no tiene permisos suficientes para leer Drive. Reconecta Google autorizando Drive.',
        code: 'DRIVE_SCOPE_REQUIRED',
      });
    }
    return res.status(409).json({
      error: 'La cuenta conectada no tiene permisos suficientes para esta accion de Gmail. Reconecta Google autorizando Gmail.',
      code: 'GMAIL_SCOPE_REQUIRED',
    });
  }

  console.error(`[google-workspace] ${context} error:`, err);
  return res.status(500).json({ error: err.message });
}

async function syncGmail(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });

  const { query, threadId, maxResults } = req.body || {};
  if (!query && !threadId) {
    return res.status(400).json({
      error: 'Proporciona `query` (búsqueda Gmail) o `threadId`.',
    });
  }

  try {
    const result = await service.syncGmailToCase({
      userId: req.user.id,
      caseId,
      query,
      threadId,
      maxResults: Math.min(Number(maxResults) || 20, 500),
    });
    res.json(result);
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'syncGmail');
  }
}

async function listGmailMessages(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });
  try {
    const messages = await service.listCaseGmailMessages(caseId);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listGmailInbox(req, res) {
  const { query, maxResults, pageToken } = req.query;
  try {
    const result = await service.listGmailInbox({
      userId: req.user.id,
      query: query || 'in:inbox',
      maxResults: Math.min(Number(maxResults) || 10, 25),
      pageToken,
    });
    res.json(result);
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'listGmailInbox');
  }
}

async function markGmailMessageRead(req, res) {
  const { messageId } = req.params;
  if (!messageId) return res.status(400).json({ error: 'messageId invalido' });
  try {
    const result = await service.markGmailMessageRead({ userId: req.user.id, messageId });
    res.json(result);
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'markGmailMessageRead');
  }
}

async function archiveGmailMessage(req, res) {
  const { messageId } = req.params;
  if (!messageId) return res.status(400).json({ error: 'messageId invalido' });
  try {
    const result = await service.archiveGmailMessage({ userId: req.user.id, messageId });
    res.json(result);
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'archiveGmailMessage');
  }
}

async function trashGmailMessage(req, res) {
  const { messageId } = req.params;
  if (!messageId) return res.status(400).json({ error: 'messageId invalido' });
  try {
    const result = await service.trashGmailMessage({ userId: req.user.id, messageId });
    res.json(result);
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'trashGmailMessage');
  }
}

async function listDriveFiles(req, res) {
  const { query, folderId, pageSize } = req.query;
  try {
    const files = await service.listDriveFiles({
      userId: req.user.id,
      query,
      folderId,
      pageSize: Math.min(Number(pageSize) || 20, 50),
    });
    res.json({ files });
  } catch (err) {
    return handleGoogleWorkspaceError(res, err, 'listDriveFiles');
  }
}

async function sendGmail(req, res) {
  const caseId = req.params.caseId ? Number(req.params.caseId) : null;
  if (req.params.caseId && !caseId) {
    return res.status(400).json({ error: 'caseId inválido' });
  }
  const { to, cc, bcc, subject, body, thread_id, in_reply_to, document_id, dry_run } = req.body || {};
  try {
    const result = await service.sendGmail({
      userId: req.user.id,
      caseId,
      documentId: document_id || null,
      to, cc, bcc, subject, body,
      threadId: thread_id,
      inReplyTo: in_reply_to,
      dryRun: dry_run === undefined ? true : Boolean(dry_run),
    });
    return res.json(result);
  } catch (err) {
    if (err.code === 'GMAIL_SEND_MISSING_FIELDS') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    return handleGoogleWorkspaceError(res, err, 'sendGmail');
  }
}

module.exports = {
  syncGmail,
  listGmailMessages,
  listGmailInbox,
  markGmailMessageRead,
  archiveGmailMessage,
  trashGmailMessage,
  listDriveFiles,
  sendGmail,
};
