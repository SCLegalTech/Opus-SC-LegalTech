/**
 * liveNotify.service.js — Puente entre Postgres NOTIFY y el liveBus (F2)
 *
 * Abre una conexión PG DEDICADA (no del pool, porque LISTEN la mantiene
 * ocupada de por vida) y escucha el canal 'opus_live'. Cada NOTIFY proviene
 * del trigger AFTER INSERT en agent_actions (ver migration_live_bus_notify.sql).
 * El payload se re-publica al liveBus, que lo entrega por SSE a los navegadores.
 *
 *   agent_actions INSERT → trigger pg_notify('opus_live') → [este servicio]
 *      → liveBus.publish() → SSE /api/agent/stream → navegador
 *
 * Reconecta solo si la conexión cae. Si nunca arranca, el sistema sigue
 * funcionando: simplemente no hay actualización en vivo (las páginas refrescan
 * por su cuenta como antes).
 */

const { Client } = require('pg');
const liveBus = require('./liveBus.service');

const CHANNEL = 'opus_live';
const RECONNECT_MS = 3000;

let client = null;
let reconnectTimer = null;
let stopped = false;

function buildClient() {
  const sslEnabled = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'opus',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: sslEnabled ? { rejectUnauthorized: false } : false,
  });
}

function scheduleReconnect() {
  if (reconnectTimer || stopped) return;
  if (client) {
    client.removeAllListeners();
    client.end().catch(() => {});
    client = null;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch((err) => {
      console.error('[liveNotify] reconexión falló:', err.message);
      scheduleReconnect();
    });
  }, RECONNECT_MS);
}

async function connect() {
  client = buildClient();

  client.on('notification', (msg) => {
    if (msg.channel !== CHANNEL || !msg.payload) return;
    try {
      const event = JSON.parse(msg.payload);
      liveBus.publish(event);
    } catch (_) {
      // payload inválido — ignorar sin tumbar el listener
    }
  });

  client.on('error', (err) => {
    console.error('[liveNotify] error en cliente LISTEN:', err.message);
    scheduleReconnect();
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  console.log(`  ✓ Live bus escuchando NOTIFY '${CHANNEL}'`);
}

/** Arranca el listener. No lanza: si falla, agenda reintento. */
async function startLiveNotify() {
  stopped = false;
  try {
    await connect();
  } catch (err) {
    console.error('[liveNotify] no pudo iniciar:', err.message);
    scheduleReconnect();
  }
}

async function stopLiveNotify() {
  stopped = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (client) {
    client.removeAllListeners();
    await client.end().catch(() => {});
    client = null;
  }
}

module.exports = { startLiveNotify, stopLiveNotify };
