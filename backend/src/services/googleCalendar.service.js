/**
 * googleCalendar.service.js
 * ─────────────────────────────────────────────────────────────
 * Sincroniza vencimientos, tareas (con due_date) y actuaciones
 * (con scheduled_at) al Google Calendar del abogado.
 *
 * Diseño:
 *   - Cada item local guarda su google_event_id y last_sync_at.
 *   - sync se hace por item: si ya tiene event_id → patch; si no → insert.
 *   - Vencimientos = eventos all-day (solo fecha).
 *   - Actuaciones con hora = eventos timed (1h default).
 *   - Eliminación local → eliminación del evento (best effort).
 *   - sync_status: 'local_only' | 'synced' | 'error'.
 *
 * El abogado decide qué cuenta usa: por defecto su propia cuenta
 * google_accounts conectada. calendar_id en users.calendar_id
 * (default 'primary').
 */

const db = require('../config/db');
const googleClient = require('../modules/google-workspace/googleClient');
const accounts = require('../modules/google-workspace/googleAccounts.repository');

class CalendarNotConnectedError extends Error {
  constructor() {
    super('Google Calendar no conectado. Reconecta Google con scope calendar.events.');
    this.code = 'CALENDAR_NOT_CONNECTED';
  }
}

async function getAccount(userId) {
  const acc = await accounts.getAccountByUserId(userId);
  if (!acc || !acc.refresh_token) throw new CalendarNotConnectedError();
  const scope = String(acc.scope || '');
  if (!scope.includes('calendar.events') && !scope.includes('calendar')) {
    const err = new Error('Reconecta Google con permisos de Calendar.');
    err.code = 'CALENDAR_SCOPE_REQUIRED';
    throw err;
  }
  return acc;
}

async function getUserCalendarId(userId) {
  const { rows } = await db.query(`SELECT calendar_id FROM users WHERE id = $1`, [userId]);
  return rows[0]?.calendar_id || 'primary';
}

// ─────────────────────────────────────────────────────────────
// Sync vencimientos
// ─────────────────────────────────────────────────────────────

async function syncVencimiento({ userId, vencimientoId }) {
  const { rows } = await db.query(
    `SELECT v.*, c.case_number, c.title AS case_title
       FROM vencimientos v
       LEFT JOIN cases c ON c.id = v.case_id
      WHERE v.id = $1`,
    [vencimientoId]
  );
  if (!rows.length) throw new Error('Vencimiento no encontrado');
  const v = rows[0];

  const account = await getAccount(userId);
  const calendarId = await getUserCalendarId(userId);
  const start = formatDateOnly(v.due_date);

  const summary = `⏰ ${v.title}${v.case_number ? ` · ${v.case_number}` : ''}`;
  const description = buildDescription({
    type: 'Vencimiento procesal',
    caso: v.case_number ? `${v.case_number} · ${v.case_title || ''}` : null,
    urgencia: v.urgency,
    nota: v.description,
  });

  let event;
  let action = 'created';
  try {
    if (v.google_event_id) {
      event = await googleClient.updateCalendarEvent(account, v.google_event_id, {
        calendarId: v.google_calendar_id || calendarId,
        summary, description, start, end: start, allDay: true,
      });
      action = 'updated';
    } else {
      event = await googleClient.createCalendarEvent(account, {
        calendarId, summary, description, start, end: start, allDay: true,
      });
    }
  } catch (err) {
    await db.query(
      `UPDATE vencimientos SET sync_status = 'error', sync_error = $1, last_sync_at = NOW() WHERE id = $2`,
      [err.message?.slice(0, 200), vencimientoId]
    );
    throw err;
  }

  await db.query(
    `UPDATE vencimientos
        SET google_event_id = $1, google_calendar_id = $2,
            sync_status = 'synced', sync_error = NULL, last_sync_at = NOW()
      WHERE id = $3`,
    [event.id, calendarId, vencimientoId]
  );

  await audit('calendar.sync_vencimiento', {
    user_id: userId, vencimiento_id: vencimientoId, case_id: v.case_id,
  }, { event_id: event.id, action });

  return { event_id: event.id, action };
}

async function unsyncVencimiento({ userId, vencimientoId }) {
  const { rows } = await db.query(
    `SELECT * FROM vencimientos WHERE id = $1`,
    [vencimientoId]
  );
  if (!rows.length || !rows[0].google_event_id) return false;
  const v = rows[0];

  try {
    const account = await getAccount(userId);
    await googleClient.deleteCalendarEvent(account, v.google_event_id, {
      calendarId: v.google_calendar_id || 'primary',
    });
  } catch (err) {
    console.warn('[calendar] delete failed:', err.message);
  }

  await db.query(
    `UPDATE vencimientos SET google_event_id = NULL, sync_status = 'local_only', last_sync_at = NOW() WHERE id = $1`,
    [vencimientoId]
  );
  return true;
}

// ─────────────────────────────────────────────────────────────
// Sync actuaciones (audiencias con scheduled_at)
// ─────────────────────────────────────────────────────────────

async function syncActuacion({ userId, actuacionId, durationMinutes = 60 }) {
  const { rows } = await db.query(
    `SELECT a.*, c.case_number, c.title AS case_title
       FROM actuaciones a
       LEFT JOIN cases c ON c.id = a.case_id
      WHERE a.id = $1`,
    [actuacionId]
  );
  if (!rows.length) throw new Error('Actuación no encontrada');
  const a = rows[0];
  if (!a.scheduled_at) throw new Error('La actuación no tiene fecha agendada (scheduled_at)');

  const account = await getAccount(userId);
  const calendarId = await getUserCalendarId(userId);

  // scheduled_at es DATE en schema → tratar como timed con hora 09:00 por defecto
  const startTime = `${formatDateOnly(a.scheduled_at)}T09:00:00`;
  const endTime = addMinutes(startTime, durationMinutes);

  const summary = `${actuacionEmoji(a.type)} ${a.title}${a.case_number ? ` · ${a.case_number}` : ''}`;
  const description = buildDescription({
    type: `Actuación · ${a.type || 'SEGUIMIENTO'}`,
    caso: a.case_number ? `${a.case_number} · ${a.case_title || ''}` : null,
    radicado: a.radicado,
    nota: a.description,
  });

  let event;
  let action = 'created';
  try {
    if (a.google_event_id) {
      event = await googleClient.updateCalendarEvent(account, a.google_event_id, {
        calendarId: a.google_calendar_id || calendarId,
        summary, description, start: startTime, end: endTime, allDay: false,
      });
      action = 'updated';
    } else {
      event = await googleClient.createCalendarEvent(account, {
        calendarId, summary, description, start: startTime, end: endTime, allDay: false,
      });
    }
  } catch (err) {
    await db.query(
      `UPDATE actuaciones SET sync_status = 'error', last_sync_at = NOW() WHERE id = $1`,
      [actuacionId]
    );
    throw err;
  }

  await db.query(
    `UPDATE actuaciones
        SET google_event_id = $1, google_calendar_id = $2,
            sync_status = 'synced', last_sync_at = NOW()
      WHERE id = $3`,
    [event.id, calendarId, actuacionId]
  );

  await audit('calendar.sync_actuacion', {
    user_id: userId, actuacion_id: actuacionId, case_id: a.case_id,
  }, { event_id: event.id, action });

  return { event_id: event.id, action };
}

// ─────────────────────────────────────────────────────────────
// Sync caso completo
// ─────────────────────────────────────────────────────────────

async function syncCase({ userId, caseId }) {
  const results = { vencimientos: 0, actuaciones: 0, errors: [] };

  const { rows: vencs } = await db.query(
    `SELECT id FROM vencimientos WHERE case_id = $1 AND resolved = FALSE AND due_date >= CURRENT_DATE - INTERVAL '7 days'`,
    [caseId]
  );
  for (const { id } of vencs) {
    try {
      await syncVencimiento({ userId, vencimientoId: id });
      results.vencimientos += 1;
    } catch (e) {
      results.errors.push({ type: 'vencimiento', id, error: e.message });
    }
  }

  const { rows: acts } = await db.query(
    `SELECT id FROM actuaciones WHERE case_id = $1 AND completed_at IS NULL AND scheduled_at IS NOT NULL`,
    [caseId]
  );
  for (const { id } of acts) {
    try {
      await syncActuacion({ userId, actuacionId: id });
      results.actuaciones += 1;
    } catch (e) {
      results.errors.push({ type: 'actuacion', id, error: e.message });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────

async function setUserCalendarPrefs({ userId, autoSync, calendarId }) {
  await db.query(
    `UPDATE users
        SET calendar_auto_sync = COALESCE($1, calendar_auto_sync),
            calendar_id = COALESCE($2, calendar_id),
            updated_at = NOW()
      WHERE id = $3`,
    [autoSync, calendarId, userId]
  );
}

async function getUserCalendarPrefs(userId) {
  const { rows } = await db.query(
    `SELECT calendar_auto_sync, calendar_id FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || { calendar_auto_sync: false, calendar_id: 'primary' };
}

async function listAvailableCalendars(userId) {
  const account = await getAccount(userId);
  return googleClient.listCalendars(account);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function formatDateOnly(d) {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  return new Date(d).toISOString().slice(0, 10);
}

function addMinutes(isoString, minutes) {
  const d = new Date(isoString);
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString().slice(0, 19);
}

function buildDescription({ type, caso, urgencia, radicado, nota }) {
  const lines = [`Tipo: ${type}`];
  if (caso) lines.push(`Caso: ${caso}`);
  if (urgencia) lines.push(`Urgencia: ${urgencia}`);
  if (radicado) lines.push(`Radicado: ${radicado}`);
  if (nota) lines.push('', nota);
  lines.push('', '— Sincronizado desde Opus · SC LegalTech');
  return lines.join('\n');
}

function actuacionEmoji(type) {
  const map = {
    AUDIENCIA: '⚖',
    RADICACION: '📨',
    NOTIFICACION: '🔔',
    SEGUIMIENTO: '📌',
    OTRO: '•',
  };
  return map[type] || '•';
}

async function audit(actionType, params, result) {
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible, user_id, case_id)
       VALUES ($1, $2::jsonb, $3::jsonb, 'executed', true, $4, $5)`,
      [actionType, JSON.stringify(params), JSON.stringify(result), params.user_id || null, params.case_id || null]
    );
  } catch (e) {
    console.warn('[calendar] audit failed:', e.message);
  }
}

module.exports = {
  CalendarNotConnectedError,
  syncVencimiento,
  unsyncVencimiento,
  syncActuacion,
  syncCase,
  setUserCalendarPrefs,
  getUserCalendarPrefs,
  listAvailableCalendars,
};
