const express = require('express');
const router = express.Router();
const { receiveWorkflowEvent, getPendingEvents, getHealth } = require('../controllers/webhooks.controller');

// ── workflow ──────────────────────────────────────────────────────
// Sin middleware JWT — autenticación propia por X-Webhook-Secret
router.post('/workflow',          receiveWorkflowEvent);
router.get ('/workflow/pending',  getPendingEvents);
router.get ('/workflow/health',   getHealth);

// NOTA: el webhook de WhatsApp está montado directamente en server.js
// ANTES de app.use(express.json()) porque la verificación HMAC
// requiere acceso al body crudo (Buffer). Si lo montáramos aquí
// dentro de este router, express.json() ya habría consumido el stream.

module.exports = router;
