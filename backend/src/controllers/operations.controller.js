const {
  calculatePriorityScore,
  runPriorityScore,
} = require('../services/operationsPriority.service');

async function getPriorityScore(req, res) {
  try {
    const result = await calculatePriorityScore({
      user: req.user,
      limit: req.query.limit,
      offset: req.query.offset,
      include_archived: req.query.include_archived,
    });
    res.json(result);
  } catch (err) {
    console.error('[operations] priority score error:', err);
    res.status(500).json({ error: 'Error calculando prioridad operacional' });
  }
}

async function runPriorityScoreNow(req, res) {
  try {
    const result = await runPriorityScore({
      user: req.user,
      limit: req.body?.limit ?? req.query.limit,
      offset: req.body?.offset ?? req.query.offset,
      include_archived: req.body?.include_archived ?? req.query.include_archived,
      source: req.body?.source || 'manual_button',
    });
    res.json(result);
  } catch (err) {
    console.error('[operations] priority score run error:', err);
    res.status(500).json({ error: 'Error ejecutando prioridad operacional' });
  }
}

module.exports = {
  getPriorityScore,
  runPriorityScoreNow,
};
