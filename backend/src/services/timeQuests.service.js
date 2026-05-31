/**
 * timeQuests.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Capa de quests (misiones diarias/semanales) sobre time tracking.
 *
 * Cada quest tiene: key, label, descripciÃ³n, frecuencia, mÃ©trica,
 * meta, XP de recompensa. Al hacer una acciÃ³n relevante (cerrar
 * entry, completar tarea, triagear correo) el quest engine actualiza
 * progreso y si llega a la meta acredita XP en time_xp_log.
 *
 * Las quests se recalculan a demanda (cuando el user abre la pÃ¡gina
 * o cuando ocurre la acciÃ³n), no por cron â€” el progreso siempre
 * refleja la realidad actual de la DB.
 */

const db = require('../config/db');
const gamification = require('./timeGamification.service');

const QUESTS = [
  // Daily
  {
    key: 'daily_billable_3h',
    label: 'Registrar 3h billables',
    desc: 'Logra 180 minutos billables registrados hoy.',
    frequency: 'daily',
    goal: 180,
    xp: 100,
    metric: 'billable_minutes_today',
  },
  {
    key: 'daily_close_1_task',
    label: 'Cerrar 1 tarea',
    desc: 'Completa al menos una tarea hoy.',
    frequency: 'daily',
    goal: 1,
    xp: 50,
    metric: 'tasks_completed_today',
  },
  {
    key: 'daily_clear_1_inbox',
    label: 'Triagear 1 correo',
    desc: 'Asocia o descarta al menos un correo de la bandeja.',
    frequency: 'daily',
    goal: 1,
    xp: 30,
    metric: 'inbox_handled_today',
  },
  // Weekly
  {
    key: 'weekly_billable_15h',
    label: '15h billables esta semana',
    desc: '900 minutos billables acumulados esta semana.',
    frequency: 'weekly',
    goal: 900,
    xp: 500,
    metric: 'billable_minutes_week',
  },
  {
    key: 'weekly_close_5_tasks',
    label: 'Cerrar 5 tareas',
    desc: 'Completa 5 tareas esta semana.',
    frequency: 'weekly',
    goal: 5,
    xp: 300,
    metric: 'tasks_completed_week',
  },
  {
    key: 'weekly_zero_overdue',
    label: 'Cerrar semana sin atrasos',
    desc: 'Que no queden vencimientos vencidos al cierre de la semana.',
    frequency: 'weekly',
    goal: 1,
    xp: 400,
    metric: 'zero_overdue_now',
  },
];

function dailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}
function weeklyKey(date = new Date()) {
  // ISO week
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function periodKey(q) {
  return q.frequency === 'weekly' ? weeklyKey() : dailyKey();
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MÃ©tricas (queries a tablas reales)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function computeMetric(userId, metric, organizationId = null) {
  // Defensa en profundidad: cuando organizationId estÃ¡ disponible, las
  // mÃ©tricas filtran adicionalmente por tenant. Las queries por user_id
  // ya aÃ­slan al propio usuario, pero esto previene leak si en el futuro
  // un user pertenece a varias orgs (legacy).
  const orgClause = organizationId ? ' AND organization_id = $2' : '';
  const orgParams = organizationId ? [userId, organizationId] : [userId];

  switch (metric) {
    case 'billable_minutes_today': {
      const { rows } = await db.query(
        `SELECT COALESCE(SUM(duration_minutes), 0)::int AS v
           FROM time_entries
          WHERE user_id = $1 AND billable = TRUE AND end_at IS NOT NULL
            AND DATE(start_at) = CURRENT_DATE${orgClause}`,
        orgParams
      );
      return rows[0]?.v || 0;
    }
    case 'tasks_completed_today': {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS v FROM tareas
          WHERE assigned_to = $1 AND status = 'COMPLETADA'
            AND DATE(completed_at) = CURRENT_DATE`,
        [userId]
      );
      return rows[0]?.v || 0;
    }
    case 'inbox_handled_today': {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS v FROM inbox_triage
          WHERE user_id = $1 AND status IN ('associated', 'dismissed')
            AND DATE(acted_at) = CURRENT_DATE${orgClause}`,
        orgParams
      );
      return rows[0]?.v || 0;
    }
    case 'billable_minutes_week': {
      const { rows } = await db.query(
        `SELECT COALESCE(SUM(duration_minutes), 0)::int AS v
           FROM time_entries
          WHERE user_id = $1 AND billable = TRUE AND end_at IS NOT NULL
            AND start_at >= DATE_TRUNC('week', CURRENT_DATE)${orgClause}`,
        orgParams
      );
      return rows[0]?.v || 0;
    }
    case 'tasks_completed_week': {
      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS v FROM tareas
          WHERE assigned_to = $1 AND status = 'COMPLETADA'
            AND completed_at >= DATE_TRUNC('week', CURRENT_DATE)`,
        [userId]
      );
      return rows[0]?.v || 0;
    }
    case 'zero_overdue_now': {
      // 1 si actualmente no tiene vencimientos vencidos asignados.
      // Filtro adicional por tenant del caso para defensa en profundidad.
      try {
        const params = organizationId ? [userId, organizationId] : [userId];
        const orgC = organizationId ? ' AND c.organization_id = $2' : '';
        const { rows } = await db.query(
          `SELECT COUNT(*)::int AS v FROM vencimientos v
             JOIN cases c ON c.id = v.case_id
            WHERE c.assigned_to = $1 AND v.resolved = FALSE AND v.due_date < CURRENT_DATE${orgC}`,
          params
        );
        return rows[0]?.v === 0 ? 1 : 0;
      } catch { return 0; }
    }
    default:
      return 0;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Quest engine
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Recalcula el progreso de todas las quests del usuario. Si alguna
 * supera la meta, acredita XP en time_xp_log + actualiza
 * time_user_stats (vÃ­a gamification helper).
 */
async function refresh(userId, organizationId) {
  if (!organizationId) {
    throw new Error('organizationId requerido para refresh de quests');
  }
  const results = [];
  for (const q of QUESTS) {
    const period = periodKey(q);
    const progress = await computeMetric(userId, q.metric, organizationId);
    const alreadyCompleted = await wasCompleted(userId, q.key, period);

    // Upsert progress
    await db.query(
      `INSERT INTO time_quest_progress (user_id, organization_id, quest_key, period_key, progress, goal)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, quest_key, period_key) DO UPDATE
         SET progress = EXCLUDED.progress, updated_at = NOW()`,
      [userId, organizationId || null, q.key, period, progress, q.goal]
    );

    let xpJustAwarded = 0;
    if (!alreadyCompleted && progress >= q.goal) {
      // Acreditar XP y marcar como completada
      xpJustAwarded = q.xp;
      await db.query(
        `UPDATE time_quest_progress
            SET completed_at = NOW(),
                xp_awarded = $1,
                updated_at = NOW()
          WHERE user_id = $2 AND quest_key = $3 AND period_key = $4`,
        [q.xp, userId, q.key, period]
      );
      await awardXp({
        userId,
        organizationId,
        delta: q.xp,
        source: 'quest_completed',
        reason: `Quest: ${q.label}`,
      });
    }

    results.push({
      quest: q,
      period,
      progress,
      completed: alreadyCompleted || progress >= q.goal,
      xp_just_awarded: xpJustAwarded,
    });
  }
  return results;
}

async function wasCompleted(userId, questKey, period) {
  const { rows } = await db.query(
    `SELECT completed_at FROM time_quest_progress
      WHERE user_id = $1 AND quest_key = $2 AND period_key = $3`,
    [userId, questKey, period]
  );
  return !!rows[0]?.completed_at;
}

async function awardXp({ userId, organizationId, delta, source, reason }) {
  // Get current stats
  const { rows } = await db.query(
    `SELECT xp_total FROM time_user_stats WHERE user_id = $1`,
    [userId]
  );
  const currentXp = rows[0]?.xp_total || 0;
  const newXp = currentXp + delta;
  const lv = gamification.computeLevel(newXp);

  await db.query(
    `INSERT INTO time_user_stats (user_id, organization_id, xp_total, level)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET xp_total = $3, level = $4, updated_at = NOW()`,
    [userId, organizationId || null, newXp, lv.level]
  );

  await db.query(
    `INSERT INTO time_xp_log (user_id, organization_id, source, xp_delta, reason, level_after, xp_total_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, organizationId || null, source, delta, reason, lv.level, newXp]
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Percentile vs firma â€” ranking del usuario contra su org
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getPercentile(userId, organizationId) {
  if (!organizationId) return null;
  const { rows } = await db.query(
    `WITH ranked AS (
       SELECT user_id, xp_total,
              PERCENT_RANK() OVER (ORDER BY xp_total) AS pr
         FROM time_user_stats
        WHERE organization_id = $1 AND show_in_leaderboard = TRUE
     )
     SELECT pr FROM ranked WHERE user_id = $2`,
    [organizationId, userId]
  );
  return rows[0]?.pr != null ? Math.round(Number(rows[0].pr) * 100) : null;
}

module.exports = {
  QUESTS,
  refresh,
  getPercentile,
};
