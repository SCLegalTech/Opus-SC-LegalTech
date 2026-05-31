// Telemetría frontend — POST /api/events.
//
// Recibe batches de eventos UI desde el hook useTracking() del frontend.
// Sin eventos del backend (esos van directo a las tablas correspondientes:
// auth_audit, agent_actions, mcp_call_log).
//
// Whitelist estricta de event_type para evitar inserción arbitraria. Si el
// frontend intenta enviar un tipo desconocido, lo descartamos en silencio
// (no rechazamos el batch entero — preservamos los eventos válidos).
//
// Best-effort: si la tabla user_events no existe (migración pendiente),
// devolvemos 200 con accepted=0 sin romper la UX del frontend.

const db = require('../config/db');

const TABLE_NOT_FOUND = '42P01';
const MAX_BATCH = 50;
const MAX_METADATA_KEYS = 30;
const MAX_VALUE_LEN = 1000;

// Tipos de evento permitidos. Cualquier otro se descarta. Ampliar acá
// cuando se agreguen nuevos puntos de instrumentación.
const ALLOWED_EVENT_TYPES = new Set([
  'page_view',
  'feature_clicked',
  'onboarding_step',
  'onboarding_completed',
  'integration_connected',
  'first_case_created',
  'first_agent_chat',
  'signup_completed',
]);

// Sanitiza metadata: máximo MAX_METADATA_KEYS llaves, valores recortados
// a MAX_VALUE_LEN. Acepta solo primitivos y null en valores (sin objetos
// anidados profundos — evita guardar payloads enormes).
function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  let keys = 0;
  for (const [k, v] of Object.entries(input)) {
    if (keys >= MAX_METADATA_KEYS) break;
    if (typeof k !== 'string' || k.length > 60) continue;
    if (v === null || v === undefined) { out[k] = null; keys++; continue; }
    if (typeof v === 'string') { out[k] = v.slice(0, MAX_VALUE_LEN); keys++; continue; }
    if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; keys++; continue; }
    // Objetos/arrays se serializan y recortan.
    try {
      out[k] = JSON.stringify(v).slice(0, MAX_VALUE_LEN);
      keys++;
    } catch { /* ignore */ }
  }
  return out;
}

// ── POST /api/events ──────────────────────────────────────────────────────
// Body: { events: [{ event_type, page?, metadata? }, ...] }
// Auth: requerido (middleware authenticate ya lo aplicó).
const ingest = async (req, res) => {
  if (!req.user?.id) return res.status(401).json({ error: 'No autenticado' });

  const events = Array.isArray(req.body?.events) ? req.body.events : null;
  if (!events || events.length === 0) {
    return res.status(400).json({ error: 'body.events debe ser un array no vacío' });
  }
  if (events.length > MAX_BATCH) {
    return res.status(413).json({ error: `Máximo ${MAX_BATCH} eventos por batch` });
  }

  const userId = req.user.id;
  const orgId = req.user.org_id || req.organization_id || null;
  const ip = (req.ip || '').slice(0, 64);
  const ua = (req.headers['user-agent'] || '').slice(0, 255);

  // Filtrar a tipos permitidos. Los descartados no rompen el batch.
  const valid = [];
  let discarded = 0;
  for (const ev of events) {
    const type = String(ev?.event_type || '').trim();
    if (!ALLOWED_EVENT_TYPES.has(type)) { discarded++; continue; }
    const page = ev.page ? String(ev.page).slice(0, 120) : null;
    valid.push({
      event_type: type,
      page,
      metadata: sanitizeMetadata(ev.metadata),
    });
  }

  if (valid.length === 0) {
    return res.json({ accepted: 0, discarded });
  }

  try {
    // Insert masivo con UNNEST: una sola query para todo el batch.
    const types    = valid.map((e) => e.event_type);
    const pages    = valid.map((e) => e.page);
    const metadata = valid.map((e) => JSON.stringify(e.metadata));

    await db.query(
      `INSERT INTO user_events
          (organization_id, user_id, event_type, page, metadata, ip_address, user_agent)
        SELECT $1, $2, t, p, m::jsonb, $3, $4
          FROM UNNEST($5::text[], $6::text[], $7::text[]) AS x(t, p, m)`,
      [orgId, userId, ip, ua, types, pages, metadata]
    );

    res.json({ accepted: valid.length, discarded });
  } catch (err) {
    if (err.code === TABLE_NOT_FOUND) {
      // Migración pendiente: aceptamos pero no almacenamos. Frontend no
      // necesita saber — los eventos perdidos en este caso son aceptables.
      return res.json({ accepted: 0, discarded, warning: 'telemetry_disabled' });
    }
    console.error('[events:ingest]', err.message);
    res.status(500).json({ error: 'Error registrando eventos' });
  }
};

module.exports = { ingest, ALLOWED_EVENT_TYPES };
