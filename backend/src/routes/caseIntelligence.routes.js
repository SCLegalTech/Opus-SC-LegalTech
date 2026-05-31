const router = require('express').Router({ mergeParams: true });
const {
  getAnalyses,
  createAnalysis,
  applySuggestions,
} = require('../controllers/caseIntelligence.controller');

router.get('/analyses', getAnalyses);
router.post('/analyze', createAnalysis);
router.post('/analyses/:analysisId/apply', applySuggestions);

module.exports = router;
