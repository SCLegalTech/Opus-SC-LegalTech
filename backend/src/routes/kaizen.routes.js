const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/kaizen.controller');
const despachoCtrl = require('../controllers/despachoMetrics.controller');

const router = express.Router();
router.use(authenticate);

router.get('/metrics', ctrl.getMetrics);            // agente (software)
router.get('/despacho', despachoCtrl.getDashboard);  // negocio (despacho)

module.exports = router;
