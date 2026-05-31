/**
 * macrocasos.routes.js
 * Î¦ SC LegalTech Â· Opus v3
 */

const router = require('express').Router();
const { authenticate: auth } = require('../middleware/auth');
const { authorizeMacrocaso } = require('../middleware/authz');
const ctrl   = require('../controllers/macrocasos.controller');

const authMacro = authorizeMacrocaso('id');
router.use(auth);

// â”€â”€ Macrocaso CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get   ('/',    auth, ctrl.getMacrocasos);
router.get   ('/:id', auth, authMacro, ctrl.getMacrocaso);
router.post  ('/',    auth, ctrl.createMacrocaso);
router.patch ('/:id', auth, authMacro, ctrl.updateMacrocaso);
router.delete('/:id', auth, authMacro, ctrl.archiveMacrocaso);

// â”€â”€ Miembros (casos vinculados) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get   ('/:id/members',           auth, authMacro, ctrl.getMembers);
router.post  ('/:id/members',           auth, authMacro, ctrl.addMember);
router.patch ('/:id/members/:caseId/document-gate', auth, authMacro, ctrl.updateMemberDocumentGate);
router.delete('/:id/members/:caseId',   auth, authMacro, ctrl.removeMember);

// â”€â”€ Actuaciones del proyecto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get  ('/:id/actuaciones',                    auth, authMacro, ctrl.getActuaciones);
router.post ('/:id/actuaciones',                    auth, authMacro, ctrl.createActuacion);
router.patch('/:id/actuaciones/:actId/complete',    auth, authMacro, ctrl.completeActuacion);

// â”€â”€ Tareas del proyecto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get   ('/:id/tareas',           auth, authMacro, ctrl.getTareas);
router.post  ('/:id/tareas',           auth, authMacro, ctrl.createTarea);
router.patch ('/:id/tareas/:tareaId',  auth, authMacro, ctrl.updateTarea);

// â”€â”€ Vencimientos del proyecto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get  ('/:id/vencimientos',                 auth, authMacro, ctrl.getVencimientos);
router.post ('/:id/vencimientos',                 auth, authMacro, ctrl.createVencimiento);
router.patch('/:id/vencimientos/:vencId/resolve', auth, authMacro, ctrl.resolveVencimiento);

module.exports = router;
