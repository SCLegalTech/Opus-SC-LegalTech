const router = require('express').Router({ mergeParams: true });
const {
  getTareas,
  createTarea,
  updateTarea,
  deleteTarea,
  getTaskColumns,
  createTaskColumn,
  updateTaskColumn,
  deleteTaskColumn,
  getTaskLinks,
  getTaskLinkSources,
  linkDriveToTask,
  linkEmailToTask,
  unlinkTaskLink,
} = require('../controllers/tareas.controller');
const { authenticate } = require('../middleware/auth');
const { authorizeResource } = require('../middleware/authz');

router.use(authenticate);

// Rutas globales: GET /api/tareas  (bandeja de trabajo)
// Rutas de caso:  montadas bajo /api/cases/:caseId/tareas
router.get('/columns', getTaskColumns);
router.post('/columns', createTaskColumn);
router.put('/columns/:columnId', updateTaskColumn);
router.delete('/columns/:columnId', deleteTaskColumn);

router.get('/:id/links', getTaskLinks);
router.get('/:id/link-sources', getTaskLinkSources);
router.post('/:id/links/drive', linkDriveToTask);
router.post('/:id/links/email', linkEmailToTask);
router.delete('/:id/links/:linkId', unlinkTaskLink);

router.get('/',       getTareas);
router.post('/',      createTarea);
router.put('/:id',    authorizeResource('tareas'), updateTarea);
router.delete('/:id', authorizeResource('tareas'), deleteTarea);

module.exports = router;
