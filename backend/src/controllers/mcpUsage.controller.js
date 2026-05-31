// MCP usage controller for the self-hosted edition.
// Users can inspect only their own local organization context.

const tracker = require('../services/mcpUsageTracker.service');

function parseDateRange(req) {
  const startDate = req.query.start_date || null;
  const endDate = req.query.end_date || null;
  return { startDate, endDate };
}

// GET /api/mcp/usage
const myUsage = async (req, res) => {
  const orgId = req.user?.org_id || req.user?.organization_id || req.organization_id;
  if (!orgId) {
    return res.status(401).json({ error: 'No autenticado o sin organizacion asignada' });
  }
  try {
    const { startDate, endDate } = parseDateRange(req);
    const months = Math.min(Math.max(parseInt(req.query.months, 10) || 3, 1), 12);
    const [byConnector, monthly] = await Promise.all([
      tracker.getUsageByOrg({ orgId, startDate, endDate }),
      tracker.getMonthlyByOrg({ orgId, months }),
    ]);
    res.json({
      organization_id: orgId,
      period: { start_date: startDate, end_date: endDate },
      by_connector_method: byConnector,
      monthly,
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Migracion de uso MCP pendiente' });
    }
    console.error('[mcp-usage:myUsage]', err.message);
    res.status(500).json({ error: 'Error consultando uso MCP' });
  }
};

module.exports = {
  myUsage,
};
