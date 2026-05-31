/**
 * modules/gmail-sync · index.js
 * ─────────────────────────────────────────────────────────────
 * Superficie pública del módulo. Expone dos routers Express:
 *
 *  - accountRouter → se monta en /api/gmail
 *      GET  /auth/url       (JWT)
 *      GET  /auth/callback  (sin JWT; valida state)
 *      GET  /status         (JWT)
 *      POST /disconnect     (JWT)
 *
 *  - caseRouter → se monta en /api/cases/:caseId/gmail (mergeParams)
 *      POST /sync     (JWT)
 *      GET  /messages (JWT)
 *
 * Contrato externo del módulo:
 *   - Lee/escribe su propia tabla `gmail_accounts`.
 *   - Escribe en `communications` ÚNICAMENTE vía
 *     adapters/communications.port.js.
 *   - No importa controllers/services del core.
 */

const express = require('express');
const { authenticate } = require('../../middleware/auth');

const authCtrl = require('./gmailAuth.controller');
const syncCtrl = require('./gmailSync.controller');

const accountRouter = express.Router();
accountRouter.get ('/auth/url',      authenticate, authCtrl.getAuthUrl);
accountRouter.get ('/auth/callback',               authCtrl.oauthCallback); // sin JWT: valida state
accountRouter.get ('/status',        authenticate, authCtrl.getStatus);
accountRouter.post('/disconnect',    authenticate, authCtrl.disconnect);

const caseRouter = express.Router({ mergeParams: true });
caseRouter.post('/sync',     syncCtrl.syncToCase);
caseRouter.get ('/messages', syncCtrl.listCaseMessages);

module.exports = { accountRouter, caseRouter };
