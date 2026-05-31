/**
 * timeTracking.controller.js — endpoints HTTP de time tracking.
 *
 * Convención: cada usuario ve y modifica solo sus propias entradas.
 * Reportes globales requieren rol admin/partner.
 */

const service = require('../services/timeTracking.service');
const gamification = require('../services/timeGamification.service');
const quests = require('../services/timeQuests.service');
const { canAccessCase } = require('../middleware/authz');

function isPrivileged(req) {
  return req.user.role === 'admin' || req.user.role === 'partner';
}

// Si llega un case_id desde el cliente, validar acceso para evitar que
// un usuario registre horas (y luego reportes/factura) sobre casos de
// otra firma. Devuelve true si autorizado o si caseId es null/undefined.
async function authorizeOptionalCaseId(req, caseId) {
  if (caseId == null) return true;
  const numeric = Number.parseInt(caseId, 10);
  if (!Number.isFinite(numeric)) return false;
  return canAccessCase(req.user.id, req.user.role, numeric);
}

async function getRunning(req, res) {
  try {
    const running = await service.getRunning(req.user.id);
    return res.json({ entry: running });
  } catch (err) {
    return respondError(res, err);
  }
}

async function start(req, res) {
  try {
    if (!(await authorizeOptionalCaseId(req, req.body?.case_id))) {
      return res.status(403).json({ error: 'Sin acceso al caso indicado' });
    }
    const orgId = req.organization_id || req.user.org_id || null;
    const entry = await service.start({
      userId: req.user.id,
      organizationId: orgId,
      caseId: req.body?.case_id ?? null,
      taskId: req.body?.task_id ?? null,
      clientId: req.body?.client_id ?? null,
      description: req.body?.description ?? null,
      category: req.body?.category ?? null,
      billable: req.body?.billable !== false,
    });
    return res.status(201).json({ entry });
  } catch (err) {
    return respondError(res, err);
  }
}

async function stop(req, res) {
  try {
    const entryId = req.params.id ? Number.parseInt(req.params.id, 10) : null;
    const entry = await service.stop({ userId: req.user.id, entryId });
    if (!entry) return res.status(404).json({ error: 'No hay cronómetro corriendo o no es tuyo' });
    return res.json({ entry });
  } catch (err) {
    return respondError(res, err);
  }
}

async function createManual(req, res) {
  try {
    if (!(await authorizeOptionalCaseId(req, req.body?.case_id))) {
      return res.status(403).json({ error: 'Sin acceso al caso indicado' });
    }
    const orgId = req.organization_id || req.user.org_id || null;
    const entry = await service.createManual({
      userId: req.user.id,
      organizationId: orgId,
      caseId: req.body?.case_id ?? null,
      taskId: req.body?.task_id ?? null,
      clientId: req.body?.client_id ?? null,
      startAt: req.body?.start_at,
      durationMinutes: Number.parseInt(req.body?.duration_minutes, 10),
      description: req.body?.description ?? null,
      category: req.body?.category ?? null,
      billable: req.body?.billable !== false,
    });
    return res.status(201).json({ entry });
  } catch (err) {
    return respondError(res, err);
  }
}

async function update(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'case_id')) {
      if (!(await authorizeOptionalCaseId(req, req.body.case_id))) {
        return res.status(403).json({ error: 'Sin acceso al caso indicado' });
      }
    }
    const entry = await service.update({ userId: req.user.id, entryId: id, patch: req.body || {} });
    if (!entry) return res.status(404).json({ error: 'Entrada no encontrada o no es tuya' });
    return res.json({ entry });
  } catch (err) {
    return respondError(res, err);
  }
}

async function deleteEntry(req, res) {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });
    const ok = await service.deleteEntry({ userId: req.user.id, entryId: id });
    if (!ok) return res.status(404).json({ error: 'Entrada no encontrada o no es tuya' });
    return res.json({ ok: true });
  } catch (err) {
    return respondError(res, err);
  }
}

async function listMine(req, res) {
  try {
    const entries = await service.listByUser({
      userId: req.user.id,
      from: req.query.from || null,
      to: req.query.to || null,
      limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
    });
    return res.json({ entries });
  } catch (err) {
    return respondError(res, err);
  }
}

async function listByCase(req, res) {
  try {
    const caseId = Number.parseInt(req.params.caseId || req.params.id, 10);
    if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });
    const entries = await service.listByCase({ caseId });
    return res.json({ entries });
  } catch (err) {
    return respondError(res, err);
  }
}

async function caseTotals(req, res) {
  try {
    const caseId = Number.parseInt(req.params.caseId || req.params.id, 10);
    if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });
    const totals = await service.caseTotals(caseId);
    return res.json({ totals });
  } catch (err) {
    return respondError(res, err);
  }
}

async function reportByUser(req, res) {
  try {
    if (!isPrivileged(req)) return res.status(403).json({ error: 'Solo admin/partner' });
    const orgId = req.organization_id || req.user.org_id || null;
    const rows = await service.reportByUser({
      from: req.query.from || null,
      to: req.query.to || null,
      organizationId: orgId,
    });
    return res.json({ rows });
  } catch (err) {
    return respondError(res, err);
  }
}

async function reportByCase(req, res) {
  try {
    if (!isPrivileged(req)) return res.status(403).json({ error: 'Solo admin/partner' });
    const orgId = req.organization_id || req.user.org_id || null;
    const rows = await service.reportByCase({
      from: req.query.from || null,
      to: req.query.to || null,
      organizationId: orgId,
    });
    return res.json({ rows });
  } catch (err) {
    return respondError(res, err);
  }
}

async function setMyRate(req, res) {
  try {
    const rate = Number.parseInt(req.body?.hourly_rate_cents, 10);
    if (!Number.isFinite(rate) || rate < 0) return res.status(400).json({ error: 'hourly_rate_cents inválido' });
    await service.setUserHourlyRate({ userId: req.user.id, hourlyRateCents: rate });
    return res.json({ ok: true, hourly_rate_cents: rate });
  } catch (err) {
    return respondError(res, err);
  }
}

async function getMyRate(req, res) {
  try {
    const rate = await service.getUserHourlyRate(req.user.id);
    return res.json({ hourly_rate_cents: rate });
  } catch (err) {
    return respondError(res, err);
  }
}

async function getMyGamification(req, res) {
  try {
    const stats = await gamification.getMyStats(req.user.id);
    return res.json(stats);
  } catch (err) {
    return respondError(res, err);
  }
}

async function getLeaderboard(req, res) {
  try {
    const orgId = req.organization_id || req.user.org_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Usuario sin organización asignada' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
    const rows = await gamification.getLeaderboard({ organizationId: orgId, limit });
    return res.json({ rows });
  } catch (err) {
    return respondError(res, err);
  }
}

async function getQuests(req, res) {
  try {
    const orgId = req.organization_id || req.user.org_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Usuario sin organización asignada' });
    }
    const list = await quests.refresh(req.user.id, orgId);
    return res.json({ quests: list });
  } catch (err) {
    return respondError(res, err);
  }
}

async function getPercentile(req, res) {
  try {
    const orgId = req.organization_id || req.user.org_id;
    if (!orgId) {
      return res.status(400).json({ error: 'Usuario sin organización asignada' });
    }
    const pct = await quests.getPercentile(req.user.id, orgId);
    return res.json({ percentile: pct });
  } catch (err) {
    return respondError(res, err);
  }
}

async function setLeaderboardOptIn(req, res) {
  try {
    await gamification.setLeaderboardOptIn({
      userId: req.user.id,
      optIn: req.body?.opt_in !== false,
    });
    return res.json({ ok: true });
  } catch (err) {
    return respondError(res, err);
  }
}

function respondError(res, err) {
  console.error('[time-tracking] error:', err);
  return res.status(400).json({ error: err.message || 'Error en time tracking' });
}

module.exports = {
  getRunning,
  start,
  stop,
  createManual,
  update,
  deleteEntry,
  listMine,
  listByCase,
  caseTotals,
  reportByUser,
  reportByCase,
  setMyRate,
  getMyRate,
  getMyGamification,
  getLeaderboard,
  setLeaderboardOptIn,
  getQuests,
  getPercentile,
};
