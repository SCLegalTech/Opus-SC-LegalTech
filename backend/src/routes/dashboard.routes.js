const router = require('express').Router();
const {
  getStats,
  getBandeja,
  getActuacionesPendientes,
  getCasosActivos,
  getCargaAbogados,
  getRecentCases,
} = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/stats',                   getStats);
router.get('/bandeja',                 getBandeja);
router.get('/actuaciones-pendientes',  getActuacionesPendientes);
router.get('/casos-activos',           getCasosActivos);
router.get('/carga-abogados',          getCargaAbogados);
router.get('/recent',                  getRecentCases);   // compat v1

module.exports = router;
