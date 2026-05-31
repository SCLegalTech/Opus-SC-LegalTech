/**
 * whatsapp.routes.js
 *
 * WhatsApp inbox routes for authenticated internal users.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireInternal } = require('../middleware/authz');
const ctrl = require('../controllers/whatsapp.controller');

const router = express.Router();
router.use(authenticate, requireInternal);

router.get ('/conversations',                        ctrl.listConversations);
router.get ('/conversations/:id',                    ctrl.getConversation);
router.get ('/conversations/:id/messages',           ctrl.listMessages);
router.post('/conversations/:id/read',               ctrl.markRead);
router.post('/conversations/:id/assign',             ctrl.assignConversation);
router.post('/conversations/:id/link-case',          ctrl.linkCase);
router.post('/conversations/:id/link-client',        ctrl.linkClient);
router.post('/conversations/:id/send-text',          ctrl.sendText);
router.post('/conversations/:id/send-template',      ctrl.sendTemplate);

router.get ('/templates',                            ctrl.listTemplates);
router.post('/templates/sync',                       ctrl.syncTemplatesFromMeta);

router.get ('/numbers',                              ctrl.listNumbers);
router.get ('/numbers/status',                       ctrl.getNumberStatus);

module.exports = router;
