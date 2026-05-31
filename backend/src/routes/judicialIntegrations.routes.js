const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/judicialIntegrations.controller');

router.use(authenticate);

router.get('/platforms', controller.listPlatforms);
router.get('/platforms/:key', controller.getPlatform);
router.get('/cases/:caseId/links', controller.listCaseLinks);
router.get('/case-tracking/lookup', controller.lookup);

module.exports = router;
