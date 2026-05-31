// Telemetría frontend — /api/events.
//
// Único endpoint expuesto: POST /api/events (batch). Rate limit aplicado
// en server.js para que comparta el mismo limiter que otras rutas
// autenticadas pero "frecuentes" (60 req/min por usuario).

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/events.controller');

const router = express.Router();
router.use(authenticate);
router.post('/', ctrl.ingest);

module.exports = router;
