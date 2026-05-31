/**
 * timeGamification.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Capa de gamificaciÃ³n sobre time tracking.
 *
 * Reglas de XP:
 *   - 1 hora billable cerrada = 100 XP
 *   - 1 hora no-billable cerrada = 30 XP
 *   - Bonus por categorÃ­a especial (audiencia = 1.5x, viaje = 0.5x)
 *   - Streak bonus: +50 XP cuando cierras racha de 7 dÃ­as, +200 a 30d
 *
 * Niveles (acumulativo):
 *   Lv 1: 0â€“99 XP        "Novato"
 *   Lv 2: 100â€“299        "Aprendiz"
 *   Lv 3: 300â€“699        "Despachante"
 *   Lv 4: 700â€“1499       "Estratega"
 *   Lv 5: 1500â€“3099      "Litigante"
 *   Lv 6: 3100â€“6299      "Veterano"
 *   Lv 7: 6300â€“12699     "Maestro"
 *   Lv 8: 12700+         "Arquitecto"
 *
 * Curva: nivel N requiere 100 * (2^N - 1) XP, capeado en 50_000.
 *
 * Badges (claves persistidas en time_user_stats.badges):
 *   first_hour        Cerraste tu primera hora
 *   first_billable    Cerraste tu primera hora billable
 *   streak_7          7 dÃ­as seguidos
 *   streak_30         30 dÃ­as seguidos
 *   hundred_hours     100 horas totales
 *   thousand_hours    1000 horas totales
 *   high_value_day    DÃ­a con >5h billables
 *   night_owl         Cerraste entrada despuÃ©s de 10pm
 *   early_bird        Cerraste entrada antes de 7am
 */

const db = require('../config/db');

const LEVELS = [
  { lv: 1, name: 'Novato',      min: 0 },
  { lv: 2, name: 'Aprendiz',    min: 100 },
  { lv: 3, name: 'Despachante', min: 300 },
  { lv: 4, name: 'Estratega',   min: 700 },
  { lv: 5, name: 'Litigante',   min: 1500 },
  { lv: 6, name: 'Veterano',    min: 3100 },
  { lv: 7, name: 'Maestro',     min: 6300 },
  { lv: 8, name: 'Arquitecto',  min: 12700 },
];

const CATEGORY_MULT = {
  audiencia: 1.5,
  redaccion: 1.0,
  reunion: 1.0,
  investigacion: 1.0,
  viaje: 0.5,
  otro: 1.0,
};

const BASE_XP_PER_HOUR_BILLABLE = 100;
const BASE_XP_PER_HOUR_NON_BILLABLE = 30;

function computeLevel(xp) {
  let last = LEVELS[0];
  for (const l of LEVELS) {
    if (xp >= l.min) last = l;
    else break;
  }
  const next = LEVELS.find((l) => l.min > xp);
  return {
    level: last.lv,
    name: last.name,
    xp_total: xp,
    xp_into_level: xp - last.min,
    xp_to_next: next ? next.min - xp : null,
    next_level_name: next?.name || null,
    progress_pct: next ? Math.round(((xp - last.min) / (next.min - last.min)) * 100) : 100,
  };
}

function xpFromEntry({ durationMinutes, billable, category }) {
  const hours = (durationMinutes || 0) / 60;
  const base = billable ? BASE_XP_PER_HOUR_BILLABLE : BASE_XP_PER_HOUR_NON_BILLABLE;
  const mult = CATEGORY_MULT[String(category || '').toLowerCase()] ?? 1.0;
  return Math.round(hours * base * mult);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Award â€” llamada despuÃ©s de cerrar una time_entry
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function awardForClosedEntry({ userId, organizationId, entry }) {
  if (!entry || entry.is_running) return null;
  const xpDelta = xpFromEntry({
    durationMinutes: entry.duration_minutes,
    billable: entry.billable,
    category: entry.category,
  });
  if (xpDelta <= 0) return null;

  // 1. Asegurar fila time_user_stats
  await db.query(
    `INSERT INTO time_user_stats (user_id, organization_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, organizationId || null]
  );

  // 2. Recalcular streak basÃ¡ndose en last_activity_date
  const today = new Date().toISOString().slice(0, 10);
  const { rows: statRows } = await db.query(
    `SELECT * FROM time_user_stats WHERE user_id = $1`,
    [userId]
  );
  const prev = statRows[0];
  const prevDate = prev.last_activity_date ? new Date(prev.last_activity_date).toISOString().slice(0, 10) : null;

  let newStreak = prev.current_streak_days || 0;
  if (prevDate === today) {
    // ya contÃ³ hoy, no cambia
  } else if (prevDate && daysBetween(prevDate, today) === 1) {
    newStreak += 1;
  } else {
    newStreak = 1;
  }
  const longestStreak = Math.max(prev.longest_streak_days || 0, newStreak);

  // 3. Bonus de racha
  const bonuses = [];
  if (newStreak === 7 && (prev.current_streak_days || 0) < 7) {
    bonuses.push({ source: 'streak_bonus', delta: 50, reason: 'Racha de 7 dÃ­as' });
  }
  if (newStreak === 30 && (prev.current_streak_days || 0) < 30) {
    bonuses.push({ source: 'streak_bonus', delta: 200, reason: 'Racha de 30 dÃ­as' });
  }

  // 4. Badges
  const prevBadges = Array.isArray(prev.badges) ? prev.badges : [];
  const newBadges = new Set(prevBadges);
  const totalMinutesNew = (prev.total_minutes || 0) + (entry.duration_minutes || 0);
  const billableMinutesNew = (prev.billable_minutes || 0) + (entry.billable ? entry.duration_minutes || 0 : 0);
  const totalAmountNew = BigInt(prev.total_amount_cents || 0) + BigInt(entry.amount_cents || 0);

  if (!newBadges.has('first_hour')) newBadges.add('first_hour');
  if (entry.billable && !newBadges.has('first_billable')) newBadges.add('first_billable');
  if (newStreak >= 7) newBadges.add('streak_7');
  if (newStreak >= 30) newBadges.add('streak_30');
  if (totalMinutesNew >= 100 * 60) newBadges.add('hundred_hours');
  if (totalMinutesNew >= 1000 * 60) newBadges.add('thousand_hours');
  if (entry.end_at) {
    const hour = new Date(entry.end_at).getHours();
    if (hour >= 22 || hour < 2) newBadges.add('night_owl');
    if (hour < 7) newBadges.add('early_bird');
  }
  // high_value_day: Â¿hoy cerrÃ³ >5h billables? (sumando esta entrada)
  if (entry.billable) {
    const { rows: todayRows } = await db.query(
      `SELECT COALESCE(SUM(duration_minutes), 0)::int AS mins
         FROM time_entries
        WHERE user_id = $1 AND billable = TRUE
          AND DATE(start_at) = CURRENT_DATE
          AND end_at IS NOT NULL`,
      [userId]
    );
    if ((todayRows[0]?.mins || 0) >= 5 * 60) newBadges.add('high_value_day');
  }
  const newBadgesArr = [...newBadges];
  const unlockedBadges = newBadgesArr.filter((b) => !prevBadges.includes(b));

  // 5. Aplicar XP base + bonuses
  let xpRunning = (prev.xp_total || 0) + xpDelta;
  for (const b of bonuses) xpRunning += b.delta;
  const lv = computeLevel(xpRunning);

  // 6. UPDATE time_user_stats
  await db.query(
    `UPDATE time_user_stats SET
       xp_total = $1,
       level = $2,
       current_streak_days = $3,
       longest_streak_days = $4,
       last_activity_date = CURRENT_DATE,
       total_minutes = $5,
       billable_minutes = $6,
       total_amount_cents = $7,
       badges = $8::jsonb,
       updated_at = NOW()
     WHERE user_id = $9`,
    [xpRunning, lv.level, newStreak, longestStreak,
     totalMinutesNew, billableMinutesNew, totalAmountNew.toString(),
     JSON.stringify(newBadgesArr), userId]
  );

  // 7. Append a time_xp_log (uno por la entrada, uno por cada bonus, uno por cada badge)
  const inserts = [];
  inserts.push({ source: 'time_entry_closed', delta: xpDelta, reason: entryReason(entry), xpAfter: (prev.xp_total || 0) + xpDelta });
  let running = (prev.xp_total || 0) + xpDelta;
  for (const b of bonuses) {
    running += b.delta;
    inserts.push({ source: b.source, delta: b.delta, reason: b.reason, xpAfter: running });
  }
  for (const b of unlockedBadges) {
    inserts.push({ source: 'badge_unlocked', delta: 0, reason: `Badge: ${b}`, xpAfter: running, badge: b });
  }
  // Filtramos los de delta=0 (badges) que el CHECK rechaza; los registramos con delta=1 simbÃ³lico
  for (const i of inserts) {
    const delta = i.delta > 0 ? i.delta : 1;
    await db.query(
      `INSERT INTO time_xp_log (user_id, organization_id, time_entry_id, source, xp_delta, reason, level_after, xp_total_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, organizationId || null, entry.id, i.source, delta, i.reason, lv.level, i.xpAfter]
    );
  }

  return {
    xp_gained: xpDelta,
    bonuses,
    badges_unlocked: unlockedBadges,
    new_level: lv,
    streak: newStreak,
  };
}

function entryReason(entry) {
  const hours = ((entry.duration_minutes || 0) / 60).toFixed(2);
  return `${hours}h ${entry.billable ? 'billable' : 'no-billable'}${entry.category ? ' Â· ' + entry.category : ''}`;
}

function daysBetween(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return Math.round((b - a) / 86400000);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Lecturas
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getMyStats(userId) {
  const { rows } = await db.query(
    `SELECT * FROM time_user_stats WHERE user_id = $1`,
    [userId]
  );
  const stats = rows[0] || {
    xp_total: 0, level: 1, current_streak_days: 0, longest_streak_days: 0,
    last_activity_date: null, total_minutes: 0, billable_minutes: 0,
    total_amount_cents: 0, badges: [], show_in_leaderboard: true,
  };
  const lv = computeLevel(stats.xp_total || 0);

  // Ãšltimos 30 dÃ­as de actividad para mini-grÃ¡fica
  const { rows: byDay } = await db.query(
    `SELECT DATE(start_at) AS day,
            SUM(duration_minutes)::int AS mins,
            SUM(CASE WHEN billable THEN duration_minutes ELSE 0 END)::int AS billable_mins
       FROM time_entries
      WHERE user_id = $1 AND end_at IS NOT NULL
        AND start_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY 1 ORDER BY 1`,
    [userId]
  );

  // Ãšltimas 5 ganancias de XP
  const { rows: xpLog } = await db.query(
    `SELECT source, xp_delta, reason, level_after, created_at
       FROM time_xp_log
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [userId]
  );

  return {
    ...stats,
    level_info: lv,
    daily_activity_30d: byDay,
    recent_xp: xpLog,
  };
}

async function getLeaderboard({ organizationId, limit = 10 }) {
  // Tenant strict: si no hay org no devolvemos nada (no leak global).
  if (!organizationId) {
    throw new Error('organizationId requerido para leaderboard');
  }
  const { rows } = await db.query(
    `SELECT s.user_id, u.name, u.email,
            s.xp_total, s.level, s.current_streak_days, s.longest_streak_days,
            jsonb_array_length(s.badges) AS badges_count
       FROM time_user_stats s
       JOIN users u ON u.id = s.user_id
      WHERE s.show_in_leaderboard = TRUE
        AND s.organization_id = $1
      ORDER BY s.xp_total DESC
      LIMIT $2`,
    [organizationId, limit]
  );
  return rows.map((r) => ({
    ...r,
    level_info: computeLevel(r.xp_total),
  }));
}

async function setLeaderboardOptIn({ userId, optIn }) {
  await db.query(
    `INSERT INTO time_user_stats (user_id, show_in_leaderboard)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET show_in_leaderboard = $2, updated_at = NOW()`,
    [userId, !!optIn]
  );
}

module.exports = {
  computeLevel,
  xpFromEntry,
  awardForClosedEntry,
  getMyStats,
  getLeaderboard,
  setLeaderboardOptIn,
  LEVELS,
};
