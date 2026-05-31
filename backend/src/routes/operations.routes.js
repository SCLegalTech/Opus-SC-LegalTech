const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
  getPriorityScore,
  runPriorityScoreNow,
} = require('../controllers/operations.controller');

router.use(authenticate);

router.get('/priority-score', getPriorityScore);
router.post('/priority-score/run', runPriorityScoreNow);

module.exports = router;
