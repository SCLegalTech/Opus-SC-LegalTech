/**
 * modules/google-workspace · index.js
 * ─────────────────────────────────────────────────────────────
 * Superficie pública del módulo. Expone tres routers Express:
 *
 *  accountRouter  → /api/google
 *    GET  /auth/url          (JWT) → URL de consentimiento OAuth
 *    GET  /auth/callback     (state token) → callback de Google
 *    GET  /status            (JWT) → estado de conexión + scopes
 *    POST /disconnect        (JWT) → desconectar cuenta
 *    GET  /config            (JWT admin) → leer credenciales guardadas
 *    POST /config            (JWT admin) → guardar credenciales
 *
 *  caseRouter     → /api/cases/:caseId/google  (mergeParams)
 *    POST /gmail/sync        (JWT) → importar correos al caso
 *    GET  /gmail/messages    (JWT) → listar correos importados
 *
 *  driveRouter    → /api/drive  (global, no acoplado a caso todavía)
 *    GET  /files             (JWT) → listar archivos Drive del usuario
 *
 * Contrato externo:
 *  - Lee/escribe su propia tabla google_accounts.
 *  - Lee/escribe app_config para las credenciales OAuth.
 *  - Escribe en communications ÚNICAMENTE vía adapters/communications.port.js.
 *  - No importa controllers/services del core.
 */

const express    = require('express');
const { authenticate } = require('../../middleware/auth');
const authCtrl   = require('./googleAuth.controller');
const syncCtrl   = require('./googleSync.controller');

// ── /api/google ───────────────────────────────────────────────
const accountRouter = express.Router();
accountRouter.get ('/auth/url',      authenticate, authCtrl.getAuthUrl);
accountRouter.get ('/auth/callback',               authCtrl.oauthCallback);
accountRouter.get ('/status',        authenticate, authCtrl.getStatus);
accountRouter.post('/disconnect',    authenticate, authCtrl.disconnect);
accountRouter.get ('/config',        authenticate, authCtrl.getConfig);
accountRouter.post('/config',        authenticate, authCtrl.saveConfig);
accountRouter.get ('/gmail/inbox',   authenticate, syncCtrl.listGmailInbox);
accountRouter.patch('/gmail/messages/:messageId/read', authenticate, syncCtrl.markGmailMessageRead);
accountRouter.post('/gmail/messages/:messageId/archive', authenticate, syncCtrl.archiveGmailMessage);
accountRouter.post('/gmail/messages/:messageId/trash', authenticate, syncCtrl.trashGmailMessage);
accountRouter.post('/gmail/send',     authenticate, syncCtrl.sendGmail);

// ── /api/cases/:caseId/google ─────────────────────────────────
const caseRouter = express.Router({ mergeParams: true });
caseRouter.post('/gmail/sync',     syncCtrl.syncGmail);
caseRouter.get ('/gmail/messages', syncCtrl.listGmailMessages);
caseRouter.post('/gmail/send',     syncCtrl.sendGmail);

// ── /api/drive ────────────────────────────────────────────────
const driveRouter = express.Router();
driveRouter.get('/files', authenticate, syncCtrl.listDriveFiles);

module.exports = { accountRouter, caseRouter, driveRouter };
