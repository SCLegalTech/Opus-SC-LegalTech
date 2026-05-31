const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/cpnu.controller');

const router = express.Router();
router.use(authenticate);

router.get('/lookup', ctrl.lookup);
router.get('/links', ctrl.listLinks);
router.post('/link', ctrl.linkCase);
router.post('/create-case', ctrl.createCaseFromCpnu);
router.post('/links/:linkId/sync', ctrl.syncLink);
router.get('/links/:linkId/actuaciones', ctrl.listActuaciones);
router.post('/links/:linkId/acknowledge', ctrl.acknowledge);
router.get('/cases/:caseId', ctrl.getCaseLink);

module.exports = router;
