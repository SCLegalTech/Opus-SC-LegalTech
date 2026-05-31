const kaizenMetrics = require('../services/kaizenMetrics.service');

async function getMetrics(req, res) {
  try {
    const orgId = req.organization_id || req.user?.org_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Usuario sin organización asignada' });
    }
    const windowDays = Math.min(Math.max(parseInt(req.query.window, 10) || 30, 1), 365);
    const data = await kaizenMetrics.getMetrics({ windowDays, organizationId: orgId });
    return res.json(data);
  } catch (err) {
    console.error('[kaizen] error:', err);
    return res.status(500).json({ error: 'Error agregando métricas Kaizen' });
  }
}

module.exports = { getMetrics };
