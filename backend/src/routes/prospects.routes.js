/**
 * prospects.routes.js
 * ─────────────────────────────────────────────────────────────
 * Pipeline comercial pre-cliente. Capturado automáticamente
 * desde WhatsApp por waOnboarding.service.js, y editable por humanos.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireInternal } = require('../middleware/authz');
const ctrl = require('../controllers/prospects.controller');

const router = express.Router();
router.use(authenticate, requireInternal);

router.get   ('/',              ctrl.list);
router.get   ('/:id',           ctrl.getById);
router.post  ('/',              ctrl.create);
router.patch ('/:id',           ctrl.update);
router.post  ('/:id/convert',   ctrl.convertToClient);
router.delete('/:id',           ctrl.remove);

module.exports = router;
