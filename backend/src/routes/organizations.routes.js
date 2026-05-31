const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { listMine, getCurrent } = require('../controllers/organizations.controller');

router.get('/mine', authenticate, listMine);
router.get('/current', authenticate, getCurrent);

module.exports = router;
