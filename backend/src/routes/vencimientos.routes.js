const router = require('express').Router({ mergeParams: true });
const {
  getVencimientosByCaso,
  getVencimientosProximos,
  createVencimiento,
  resolveVencimiento,
} = require('../controllers/vencimientos.controller');
const { authenticate } = require('../middleware/auth');
const { authorizeResource } = require('../middleware/authz');

router.use(authenticate);

// Sub-ruta de caso: /api/cases/:caseId/vencimientos
router.get('/',       getVencimientosByCaso);
router.post('/',      createVencimiento);

// Ruta directa: /api/vencimientos/proximos
router.get('/proximos', getVencimientosProximos);

// PUT /api/vencimientos/:id/resolve
router.put('/:id/resolve', authorizeResource('vencimientos'), resolveVencimiento);

module.exports = router;
