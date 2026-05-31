// MCP usage tracker.
//
// Records connector calls for local auditability. Tracking is best-effort and
// must never block the user-facing request path.

const db = require('../config/db');

async function trackCall({
  orgId,
  userId,
  connector,
  method,
  durationMs,
  success,
  errorCode = null,
  requestMeta = null,
  responseMeta = null,
}) {
  if (!connector || !method) {
    console.warn('[mcp-usage] trackCall without connector/method, skipped');
    return;
  }
  try {
    await db.query(
      `INSERT INTO mcp_call_log
          (organization_id, user_id, connector, method,
           duration_ms, success, error_code, request_meta, response_meta)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        orgId || null,
        userId || null,
        connector,
        method,
        Math.max(0, Math.round(durationMs || 0)),
        Boolean(success),
        errorCode ? String(errorCode).slice(0, 80) : null,
        requestMeta ? JSON.stringify(requestMeta) : null,
        responseMeta ? JSON.stringify(responseMeta) : null,
      ]
    );
  } catch (err) {
    if (err.code !== '42P01') {
      console.error('[mcp-usage] insert error:', err.message);
    }
  }
}

async function track(spec, fn) {
  const start = Date.now();
  let success = true;
  let errorCode = null;
  try {
    return await fn();
  } catch (err) {
    success = false;
    errorCode = err.code || err.name || (err.message ? err.message.slice(0, 80) : 'unknown');
    throw err;
  } finally {
    const durationMs = Date.now() - start;
    setImmediate(() => {
      trackCall({ ...spec, durationMs, success, errorCode }).catch((e) => {
        console.error('[mcp-usage] track finally:', e.message);
      });
    });
  }
}

async function getUsageByOrg({ orgId, startDate, endDate }) {
  const params = [orgId];
  let where = `WHERE organization_id = $1`;
  if (startDate) {
    params.push(startDate);
    where += ` AND called_at >= $${params.length}`;
  }
  if (endDate) {
    params.push(endDate);
    where += ` AND called_at < $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT connector,
            method,
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE success) AS successful_calls,
            COUNT(*) FILTER (WHERE NOT success) AS failed_calls,
            AVG(duration_ms)::INTEGER AS avg_duration_ms,
            MAX(called_at) AS last_call_at
       FROM mcp_call_log
       ${where}
      GROUP BY connector, method
      ORDER BY total_calls DESC`,
    params
  );
  return rows;
}

async function getMonthlyByOrg({ orgId, months = 6 }) {
  const { rows } = await db.query(
    `SELECT date_trunc('month', called_at) AS period_month,
            connector,
            COUNT(*) AS total_calls,
            COUNT(*) FILTER (WHERE success) AS successful_calls,
            COUNT(*) FILTER (WHERE NOT success) AS failed_calls,
            AVG(duration_ms)::INTEGER AS avg_duration_ms
       FROM mcp_call_log
      WHERE organization_id = $1
        AND called_at >= date_trunc('month', NOW()) - ($2::int * INTERVAL '1 month')
      GROUP BY date_trunc('month', called_at), connector
      ORDER BY period_month DESC, total_calls DESC`,
    [orgId, Math.min(Math.max(months, 1), 24)]
  );
  return rows;
}

module.exports = {
  track,
  trackCall,
  getUsageByOrg,
  getMonthlyByOrg,
};
