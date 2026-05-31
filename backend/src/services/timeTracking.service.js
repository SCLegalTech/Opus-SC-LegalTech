/**
 * timeTracking.service.js
 * ─────────────────────────────────────────────────────────────
 * Time tracking — ABC del ERP legal.
 *
 * Modos:
 *   - Cronómetro: start() crea entrada is_running, stop() la cierra.
 *   - Manual:     create() con start_at + duration_minutes ingresados.
 *
 * Reglas:
 *   - Un usuario solo puede tener un cronómetro corriendo (UNIQUE index).
 *   - amount_cents se calcula al cerrar: duration_minutes/60 * hourly_rate_cents.
 *   - hourly_rate_cents se snapshot al iniciar — si el abogado cambia tarifa,
 *     los registros viejos no se afectan.
 *   - billable=FALSE no entra a facturación pero se reporta para productividad.
 *
 * Lectura por usuario: cada quien ve sus propias entradas. Admin/partner pueden
 * ver todas (la authz se aplica en el controller).
 */

const db = require('../config/db');
const gamification = require('./timeGamification.service');

async function start({ userId, organizationId, caseId, taskId, clientId, description, category, billable = true }) {
  // Verificar si ya hay un cronómetro corriendo. Si lo hay, lo paramos antes.
  const running = await getRunning(userId);
  if (running) {
    await stop({ userId, entryId: running.id });
  }

  const rate = await getUserHourlyRate(userId);

  const { rows } = await db.query(
    `INSERT INTO time_entries (
       user_id, organization_id, case_id, task_id, client_id,
       start_at, description, category, billable, hourly_rate_cents
     ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)
     RETURNING *`,
    [userId, organizationId || null, caseId || null, taskId || null, clientId || null,
     description || null, category || null, billable, rate]
  );
  return rows[0];
}

async function stop({ userId, entryId }) {
  // Si no se pasa entryId, paramos el cronómetro corriendo
  let id = entryId;
  if (!id) {
    const running = await getRunning(userId);
    if (!running) return null;
    id = running.id;
  }

  const { rows } = await db.query(
    `UPDATE time_entries
        SET end_at = NOW(),
            duration_minutes = EXTRACT(EPOCH FROM (NOW() - start_at))::int / 60,
            amount_cents = CASE
              WHEN hourly_rate_cents IS NOT NULL AND billable = TRUE
              THEN (EXTRACT(EPOCH FROM (NOW() - start_at))::bigint * hourly_rate_cents / 3600)
              ELSE NULL
            END,
            updated_at = NOW()
      WHERE id = $1 AND user_id = $2 AND end_at IS NULL
      RETURNING *`,
    [id, userId]
  );
  const entry = rows[0] || null;

  // Award XP best-effort. Si falla, no afecta el cierre del cronómetro.
  if (entry) {
    try {
      const award = await gamification.awardForClosedEntry({
        userId,
        organizationId: entry.organization_id,
        entry,
      });
      if (award) entry._award = award;
    } catch (e) {
      console.warn('[time-tracking] award fallo:', e.message);
    }
  }
  return entry;
}

async function getRunning(userId) {
  const { rows } = await db.query(
    `SELECT * FROM time_entries WHERE user_id = $1 AND end_at IS NULL LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * Crea entrada manual (ya cerrada) con start_at + duration_minutes.
 */
async function createManual({ userId, organizationId, caseId, taskId, clientId, startAt, durationMinutes, description, category, billable = true }) {
  if (!startAt || !durationMinutes) throw new Error('startAt y durationMinutes son obligatorios para manual');
  if (durationMinutes <= 0) throw new Error('durationMinutes debe ser > 0');

  const rate = await getUserHourlyRate(userId);
  const amountCents = (billable && rate) ? Math.round(durationMinutes / 60 * rate) : null;

  const { rows } = await db.query(
    `INSERT INTO time_entries (
       user_id, organization_id, case_id, task_id, client_id,
       start_at, end_at, duration_minutes,
       description, category, billable, hourly_rate_cents, amount_cents
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6::timestamp, $6::timestamp + ($7::int * INTERVAL '1 minute'), $7,
       $8, $9, $10, $11, $12
     )
     RETURNING *`,
    [userId, organizationId || null, caseId || null, taskId || null, clientId || null,
     startAt, durationMinutes, description || null, category || null, billable, rate, amountCents]
  );
  const entry = rows[0];
  if (entry) {
    try {
      const award = await gamification.awardForClosedEntry({
        userId,
        organizationId: entry.organization_id,
        entry,
      });
      if (award) entry._award = award;
    } catch (e) {
      console.warn('[time-tracking] award manual fallo:', e.message);
    }
  }
  return entry;
}

async function update({ userId, entryId, patch }) {
  const fields = [];
  const values = [];
  let idx = 1;
  const allowed = ['description', 'category', 'billable', 'case_id', 'task_id', 'client_id'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      fields.push(`${key} = $${idx++}`);
      values.push(patch[key]);
    }
  }
  if (!fields.length) return getById({ userId, entryId });

  values.push(entryId, userId);
  const { rows } = await db.query(
    `UPDATE time_entries SET ${fields.join(', ')}, updated_at = NOW()
      WHERE id = $${idx++} AND user_id = $${idx}
      RETURNING *`,
    values
  );
  return rows[0] || null;
}

async function deleteEntry({ userId, entryId }) {
  const { rows } = await db.query(
    `DELETE FROM time_entries WHERE id = $1 AND user_id = $2 RETURNING id`,
    [entryId, userId]
  );
  return rows.length > 0;
}

async function getById({ userId, entryId }) {
  const { rows } = await db.query(
    `SELECT * FROM time_entries WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [entryId, userId]
  );
  return rows[0] || null;
}

async function listByCase({ caseId, limit = 100 }) {
  const { rows } = await db.query(
    `SELECT te.*, u.name AS user_name
       FROM time_entries te
       JOIN users u ON u.id = te.user_id
      WHERE te.case_id = $1
      ORDER BY te.start_at DESC
      LIMIT $2`,
    [caseId, limit]
  );
  return rows;
}

async function listByUser({ userId, from, to, limit = 200 }) {
  const params = [userId];
  const conditions = ['user_id = $1'];
  if (from) { conditions.push(`start_at >= $${params.length + 1}`); params.push(from); }
  if (to)   { conditions.push(`start_at < $${params.length + 1}`);  params.push(to); }
  params.push(limit);

  const { rows } = await db.query(
    `SELECT * FROM time_entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY start_at DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────
// Reportes
// ─────────────────────────────────────────────────────────────

async function reportByUser({ from, to, organizationId }) {
  const params = [];
  const conditions = ['te.end_at IS NOT NULL'];
  if (from) { conditions.push(`te.start_at >= $${params.length + 1}`); params.push(from); }
  if (to)   { conditions.push(`te.start_at < $${params.length + 1}`);  params.push(to); }
  if (organizationId) {
    conditions.push(`te.organization_id = $${params.length + 1}`);
    params.push(organizationId);
  }

  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.name AS user_name, u.email,
            SUM(te.duration_minutes)::int AS total_minutes,
            SUM(CASE WHEN te.billable THEN te.duration_minutes ELSE 0 END)::int AS billable_minutes,
            SUM(CASE WHEN te.billable THEN te.amount_cents ELSE 0 END)::bigint AS billable_amount_cents,
            COUNT(*)::int AS entries_count
       FROM time_entries te
       JOIN users u ON u.id = te.user_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY u.id, u.name, u.email
      ORDER BY total_minutes DESC NULLS LAST`,
    params
  );
  return rows;
}

async function reportByCase({ from, to, organizationId }) {
  const params = [];
  const conditions = ['te.end_at IS NOT NULL', 'te.case_id IS NOT NULL'];
  if (from) { conditions.push(`te.start_at >= $${params.length + 1}`); params.push(from); }
  if (to)   { conditions.push(`te.start_at < $${params.length + 1}`);  params.push(to); }
  if (organizationId) {
    conditions.push(`te.organization_id = $${params.length + 1}`);
    params.push(organizationId);
  }

  const { rows } = await db.query(
    `SELECT c.id AS case_id, c.case_number, c.title AS case_title,
            SUM(te.duration_minutes)::int AS total_minutes,
            SUM(CASE WHEN te.billable THEN te.duration_minutes ELSE 0 END)::int AS billable_minutes,
            SUM(CASE WHEN te.billable THEN te.amount_cents ELSE 0 END)::bigint AS billable_amount_cents,
            COUNT(*)::int AS entries_count
       FROM time_entries te
       JOIN cases c ON c.id = te.case_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.id, c.case_number, c.title
      ORDER BY total_minutes DESC NULLS LAST
      LIMIT 50`,
    params
  );
  return rows;
}

async function caseTotals(caseId) {
  const { rows } = await db.query(
    `SELECT
        COUNT(*)::int AS entries,
        COALESCE(SUM(duration_minutes), 0)::int AS total_minutes,
        COALESCE(SUM(CASE WHEN billable THEN duration_minutes ELSE 0 END), 0)::int AS billable_minutes,
        COALESCE(SUM(CASE WHEN billable AND NOT invoiced THEN amount_cents ELSE 0 END), 0)::bigint AS uninvoiced_amount_cents,
        COALESCE(SUM(CASE WHEN billable THEN amount_cents ELSE 0 END), 0)::bigint AS total_billable_amount_cents,
        EXISTS(SELECT 1 FROM time_entries WHERE case_id = $1 AND end_at IS NULL) AS has_running
       FROM time_entries
      WHERE case_id = $1`,
    [caseId]
  );
  return rows[0];
}

// ─────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────

async function getUserHourlyRate(userId) {
  const { rows } = await db.query(`SELECT hourly_rate_cents FROM users WHERE id = $1`, [userId]);
  return rows[0]?.hourly_rate_cents || null;
}

// Cap superior para detectar errores y limitar abuso.
// 1_000_000 cents = COP 10.000.000/hora ≈ USD 2.500/hora — absurdo
// para cualquier abogado real pero deja margen.
const MAX_HOURLY_RATE_CENTS = 1_000_000_00;

async function setUserHourlyRate({ userId, hourlyRateCents }) {
  if (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0) {
    throw new Error('hourly_rate_cents debe ser un entero >= 0');
  }
  if (hourlyRateCents > MAX_HOURLY_RATE_CENTS) {
    throw new Error(`hourly_rate_cents excede el cap (${MAX_HOURLY_RATE_CENTS})`);
  }

  // Capturar valor previo para auditoría
  const { rows: prev } = await db.query(
    `SELECT hourly_rate_cents FROM users WHERE id = $1`,
    [userId]
  );
  const previous = prev[0]?.hourly_rate_cents ?? null;

  await db.query(
    `UPDATE users SET hourly_rate_cents = $1, updated_at = NOW() WHERE id = $2`,
    [hourlyRateCents, userId]
  );

  // Auditar cambio en append-only agent_actions
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible, user_id)
       VALUES ('time.rate_changed', $1::jsonb, $2::jsonb, 'executed', true, $3)`,
      [
        JSON.stringify({ previous_cents: previous }),
        JSON.stringify({ new_cents: hourlyRateCents }),
        userId,
      ]
    );
  } catch (e) {
    console.warn('[time-tracking] audit rate change failed:', e.message);
  }
}

module.exports.MAX_HOURLY_RATE_CENTS = MAX_HOURLY_RATE_CENTS;

module.exports = {
  start,
  stop,
  getRunning,
  createManual,
  update,
  deleteEntry,
  getById,
  listByCase,
  listByUser,
  reportByUser,
  reportByCase,
  caseTotals,
  getUserHourlyRate,
  setUserHourlyRate,
};
