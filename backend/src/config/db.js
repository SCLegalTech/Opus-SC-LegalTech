const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');

// SSL es requerido para bases de datos gestionadas.
// En local Postgres en Docker no usa TLS, asi que DB_SSL=false por default.
// rejectUnauthorized:false acepta certificados firmados por la cadena del proveedor
// sin tener que distribuir el CA bundle en instalaciones simples.
const sslEnabled = String(process.env.DB_SSL || 'false').toLowerCase() === 'true';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'opus',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  ssl: sslEnabled ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('  âœ“ ConexiÃ³n PostgreSQL establecida');
});

pool.on('error', (err) => {
  console.error('Error en pool PostgreSQL:', err);
  process.exit(-1);
});

// AsyncLocalStorage para propagar el cliente PG scopeado a travÃ©s de toda
// la cadena async de un request. El middleware de auth llama
// `tenantStore.enterWith({client, orgId})` antes de `next()`; cualquier
// `db.query(...)` ejecutado downstream usa ese cliente automÃ¡ticamente,
// que ya tiene `app.organization_id` seteado. Sin refactor de controladores.
const tenantStore = new AsyncLocalStorage();

function getTenantContext() {
  return tenantStore.getStore() || null;
}

function enterTenantScope(ctx) {
  // ctx: { orgId, client }
  tenantStore.enterWith(ctx);
}

// Query que respeta el contexto del request si existe.
function scopedQuery(text, params) {
  const ctx = getTenantContext();
  if (ctx && ctx.client) {
    return ctx.client.query(text, params);
  }
  return pool.query(text, params);
}

// Adquiere un cliente del pool, le inyecta `app.organization_id` para RLS,
// ejecuta el callback y libera. Pensado para crons, jobs y scripts que no
// son request-scoped.
//
// Si organizationId es null/undefined, el callback corre con el pool global
// (sin scope). Util para tareas de mantenimiento controladas.
async function withTenantClient(organizationId, callback) {
  if (!organizationId) {
    return callback({
      query: (text, params) => pool.query(text, params),
      _client: null,
    });
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('app.organization_id', $1, false)", [String(organizationId)]);
    return await callback({
      query: (text, params) => client.query(text, params),
      _client: client,
    });
  } finally {
    client.release();
  }
}

module.exports = {
  query: scopedQuery,            // respeta el contexto local si esta activo
  pool,
  withTenantClient,
  enterTenantScope,
  getTenantContext,
};
