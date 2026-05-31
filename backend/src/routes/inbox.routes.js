/**
 * inbox.routes.js - intelligent reception inbox.
 * All routes require JWT authentication.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/inbox.controller');

const router = express.Router();

router.use(authenticate);

router.get('/',               ctrl.listInbox);
router.post('/refresh',       ctrl.refreshInbox);
router.get('/:id',            ctrl.getItem);
router.post('/:id/associate', ctrl.associate);
router.post('/:id/dismiss',   ctrl.dismiss);

module.exports = router;
