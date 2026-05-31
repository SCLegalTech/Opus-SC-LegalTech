const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/entities.controller');

router.use(authenticate);

router.get('/', controller.list);
router.get('/signals', controller.signals);
router.post('/resolve', controller.resolve);
router.post('/monitors/run', controller.runMonitors);
router.get('/:key', controller.get);
router.post('/:key/invoke', controller.invoke);

module.exports = router;
