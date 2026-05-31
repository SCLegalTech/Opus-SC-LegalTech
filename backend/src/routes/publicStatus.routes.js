const express = require('express');
const db = require('../config/db');
const mcpClient = require('../services/mcpClient.service');

const router = express.Router();

const MCP_SERVER_URL = (process.env.MCP_SERVER_STATUS_URL || process.env.MCP_SERVER_URL || 'http://mcp-server:4001').replace(/\/$/, '');
let statusTableReady = false;

const STATUS_SEVERITY = {
  up: 1,
  degraded: 2,
  down: 3,
};

async function ensureStatusTable() {
  if (statusTableReady) return true;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS service_status_checks (
        id BIGSERIAL PRIMARY KEY,
        service_key TEXT NOT NULL,
        service_name TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        detail TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_service_status_checks_checked_at
      ON service_status_checks (checked_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_service_status_checks_service_key
      ON service_status_checks (service_key, checked_at DESC)
    `);
    statusTableReady = true;
    return true;
  } catch (err) {
    return false;
  }
}

async function checkDb() {
  const start = Date.now();
  try {
    await db.query('SELECT 1');
    return { status: 'up', latency_ms: Date.now() - start };
  } catch (err) {
    return { status: 'down', latency_ms: null, error: err.message };
  }
}

async function checkMcp() {
  const start = Date.now();
  const clientStatus = mcpClient.getStatus();

  try {
    const res = await fetch(`${MCP_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    const payload = await res.json().catch(() => ({}));

    return {
      status: res.ok ? 'up' : 'degraded',
      latency_ms: Date.now() - start,
      http_status: res.status,
      transport: payload.transport || null,
      sessions: payload.sessions ?? null,
      tools_count: clientStatus.tools_count,
      client_connected: clientStatus.connected,
      last_error: clientStatus.last_error,
    };
  } catch (err) {
    return {
      status: 'down',
      latency_ms: null,
      tools_count: clientStatus.tools_count,
      client_connected: clientStatus.connected,
      last_error: clientStatus.last_error || err.message,
    };
  }
}

async function recordSnapshot(services) {
  const ready = await ensureStatusTable();
  if (!ready) return;

  await Promise.all(services.map((service) => db.query(
    `INSERT INTO service_status_checks
      (service_key, service_name, status, latency_ms, detail, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      service.key,
      service.name,
      service.status,
      Number.isInteger(service.latency_ms) ? service.latency_ms : null,
      service.detail || '',
      JSON.stringify({ db: service.db || null, mcp: service.mcp || null }),
    ]
  ).catch(() => undefined)));
}

function severityToStatus(severity) {
  if (severity >= 3) return 'down';
  if (severity >= 2) return 'degraded';
  return 'up';
}

async function getHistory() {
  const ready = await ensureStatusTable();
  if (!ready) return [];

  const { rows } = await db.query(`
    WITH daily AS (
      SELECT
        checked_at::date AS day,
        service_key,
        COUNT(*)::int AS checks,
        MAX(CASE status
          WHEN 'down' THEN 3
          WHEN 'degraded' THEN 2
          ELSE 1
        END)::int AS severity
      FROM service_status_checks
      WHERE checked_at >= NOW() - INTERVAL '42 days'
      GROUP BY checked_at::date, service_key
    )
    SELECT day, service_key, checks, severity
    FROM daily
    ORDER BY day ASC, service_key ASC
  `);

  const byDay = new Map();
  rows.forEach((row) => {
    const date = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);
    if (!byDay.has(date)) {
      byDay.set(date, { date, status: 'up', checks: 0, services: {} });
    }
    const bucket = byDay.get(date);
    const status = severityToStatus(row.severity);
    bucket.services[row.service_key] = status;
    bucket.checks += row.checks;
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[bucket.status]) {
      bucket.status = status;
    }
  });

  return Array.from(byDay.values());
}

router.get('/services', async (req, res) => {
  const [dbStatus, mcpStatus] = await Promise.all([checkDb(), checkMcp()]);
  const apiUp = dbStatus.status === 'up';
  const mcpUp = mcpStatus.status === 'up';
  const timestamp = new Date().toISOString();
  const services = [
    {
      key: 'server',
      name: 'Servidor',
      status: 'up',
      detail: 'Proceso web respondiendo solicitudes publicas.',
      latency_ms: 0,
    },
    {
      key: 'api',
      name: 'API',
      status: apiUp ? 'up' : 'down',
      detail: apiUp ? 'API y base de datos operativas.' : 'API activa con falla en base de datos.',
      latency_ms: dbStatus.latency_ms,
      db: dbStatus,
    },
    {
      key: 'mcp',
      name: 'MCP',
      status: mcpStatus.status,
      detail: mcpUp ? 'Servidor MCP HTTP disponible.' : 'Servidor MCP no disponible o degradado.',
      latency_ms: mcpStatus.latency_ms,
      mcp: mcpStatus,
    },
  ];

  await recordSnapshot(services);
  const history = await getHistory();

  res.status(200).json({
    status: apiUp && mcpUp ? 'OK' : 'DEGRADED',
    timestamp,
    services,
    history,
  });
});

module.exports = router;
