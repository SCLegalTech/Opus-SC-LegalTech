// Onboarding routes — wizard Integra.

const express = require('express');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/onboarding.controller');

const router = express.Router();
router.use(authenticate);
router.get('/state', ctrl.getState);
router.post('/save', ctrl.save);

module.exports = router;
