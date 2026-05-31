const router = require('express').Router({ mergeParams: true });
const {
  getActuaciones, createActuacion, updateActuacion, deleteActuacion
} = require('../controllers/actuaciones.controller');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Todas estas rutas son sub-rutas de /api/cases/:caseId
router.get('/',         getActuaciones);
router.post('/',        createActuacion);
router.put('/:id',      updateActuacion);
router.delete('/:id',   deleteActuacion);

module.exports = router;
