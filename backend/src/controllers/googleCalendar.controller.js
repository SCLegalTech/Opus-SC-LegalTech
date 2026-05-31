/**
 * googleCalendar.controller.js — endpoints HTTP de Calendar sync.
 */

const service = require('../services/googleCalendar.service');

function respondError(res, err) {
  if (err?.code === 'CALENDAR_NOT_CONNECTED') return res.status(409).json({ error: err.message, code: err.code });
  if (err?.code === 'CALENDAR_SCOPE_REQUIRED') return res.status(409).json({ error: err.message, code: err.code });
  console.error('[calendar] error:', err);
  return res.status(500).json({ error: err.message || 'Error de Calendar' });
}

async function syncCase(req, res) {
  const caseId = Number.parseInt(req.params.id || req.params.caseId, 10);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });
  try {
    const result = await service.syncCase({ userId: req.user.id, caseId });
    return res.json(result);
  } catch (err) {
    return respondError(res, err);
  }
}

async function syncVencimiento(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const result = await service.syncVencimiento({ userId: req.user.id, vencimientoId: id });
    return res.json(result);
  } catch (err) {
    return respondError(res, err);
  }
}

async function unsyncVencimiento(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const ok = await service.unsyncVencimiento({ userId: req.user.id, vencimientoId: id });
    return res.json({ ok });
  } catch (err) {
    return respondError(res, err);
  }
}

async function syncActuacion(req, res) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
  try {
    const result = await service.syncActuacion({
      userId: req.user.id,
      actuacionId: id,
      durationMinutes: Number.parseInt(req.body?.duration_minutes, 10) || 60,
    });
    return res.json(result);
  } catch (err) {
    return respondError(res, err);
  }
}

async function getPrefs(req, res) {
  try {
    const prefs = await service.getUserCalendarPrefs(req.user.id);
    return res.json(prefs);
  } catch (err) {
    return respondError(res, err);
  }
}

async function setPrefs(req, res) {
  try {
    await service.setUserCalendarPrefs({
      userId: req.user.id,
      autoSync: typeof req.body?.calendar_auto_sync === 'boolean' ? req.body.calendar_auto_sync : null,
      calendarId: req.body?.calendar_id || null,
    });
    return res.json({ ok: true });
  } catch (err) {
    return respondError(res, err);
  }
}

async function listCalendars(req, res) {
  try {
    const calendars = await service.listAvailableCalendars(req.user.id);
    return res.json({ calendars });
  } catch (err) {
    return respondError(res, err);
  }
}

module.exports = {
  syncCase,
  syncVencimiento,
  unsyncVencimiento,
  syncActuacion,
  getPrefs,
  setPrefs,
  listCalendars,
};
