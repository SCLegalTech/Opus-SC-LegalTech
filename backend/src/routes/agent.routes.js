/**
 * agent.routes.js - conversational agent.
 * POST /api/agent/chat -> SSE stream.
 */

const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { requireInternal } = require('../middleware/authz');
const { chat } = require('../controllers/agent.controller');
const { streamLive } = require('../controllers/liveStream.controller');
const { status, runProactive, toolsManifest } = require('../controllers/agentProactive.controller');

router.use(authenticate, requireInternal);

router.get('/status', status);
router.get('/tools', toolsManifest);
router.get('/stream', streamLive);
router.post('/chat', chat);
router.post('/proactive/run', runProactive);

module.exports = router;
