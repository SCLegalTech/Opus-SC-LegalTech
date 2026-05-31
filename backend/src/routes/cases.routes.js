const router = require('express').Router();
const {
  getCases, getCaseById, createCase, updateCase, deleteCase,
  addCommunication, deleteCommunication, getCommunications, getServiceTypes,
  getCaseOptions, preallocate,
} = require('../controllers/cases.controller');
const { authenticate } = require('../middleware/auth');
const { authorizeCase } = require('../middleware/authz');
const salaController = require('../controllers/salaCase.controller');
const expedienteController = require('../controllers/expediente.controller');
const timeTrackingController = require('../controllers/timeTracking.controller');
const clientPortalController = require('../controllers/clientPortal.controller');
const calendarController = require('../controllers/googleCalendar.controller');

// Sub-routers (mergeParams para heredar :caseId)
const actuacionesRouter   = require('./actuaciones.routes');
const tareasRouter        = require('./tareas.routes');
const vencimientosRouter  = require('./vencimientos.routes');
const caseIntelligenceRouter = require('./caseIntelligence.routes');
const caseDriveRouter = require('./caseDrive.routes');
const { caseRouter: googleCaseRouter } = require('../modules/google-workspace');
const { caseDocumentsRouter } = require('./documents.routes');

router.use(authenticate);

router.get('/service-types', getServiceTypes);
router.get('/options', getCaseOptions);
router.post('/preallocate', preallocate);
router.get('/',    getCases);
router.get('/:id', authorizeCase('id'), getCaseById);
router.post('/',   createCase);
router.put('/:id', authorizeCase('id'), updateCase);
router.delete('/:id', authorizeCase('id'), deleteCase);

// Comunicaciones
router.get('/:id/sala', authorizeCase('id'), salaController.getSala);
router.get('/:id/expediente', authorizeCase('id'), expedienteController.getExpediente);
router.get('/:id/time-entries', authorizeCase('id'), timeTrackingController.listByCase);
router.get('/:id/time-totals',  authorizeCase('id'), timeTrackingController.caseTotals);

// Portal del cliente (gestión desde el caso, autenticado)
router.post('/:id/portal-tokens',                   authorizeCase('id'), clientPortalController.createCaseToken);
router.get('/:id/portal-tokens',                    authorizeCase('id'), clientPortalController.listCaseTokens);
router.delete('/:id/portal-tokens/:tokenId',        authorizeCase('id'), clientPortalController.revokeCaseToken);

router.post('/:id/calendar/sync', authorizeCase('id'), calendarController.syncCase);

router.get( '/:id/communications', authorizeCase('id'), getCommunications);
router.post('/:id/communications', authorizeCase('id'), addCommunication);
router.delete('/:id/communications/:communicationId', authorizeCase('id'), deleteCommunication);

// Sub-recursos del caso — authorizeCase corre antes de delegar al sub-router
router.use('/:caseId/actuaciones',  authorizeCase('caseId'), actuacionesRouter);
router.use('/:caseId/tareas',       authorizeCase('caseId'), tareasRouter);
router.use('/:caseId/vencimientos', authorizeCase('caseId'), vencimientosRouter);
router.use('/:caseId/ai',           authorizeCase('caseId'), caseIntelligenceRouter);
router.use('/:caseId/drive',        authorizeCase('caseId'), caseDriveRouter);
router.use('/:caseId/google',       authorizeCase('caseId'), googleCaseRouter);
router.use('/:caseId/documents',    authorizeCase('caseId'), caseDocumentsRouter);

module.exports = router;
