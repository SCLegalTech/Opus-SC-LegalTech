/**
 * salaCase.service.js
 * ─────────────────────────────────────────────────────────────
 * Agregador de la Sala AI-native (plan-estrategico §7.3 + §6).
 *
 * Una pantalla principal debe responder 5 preguntas:
 *   1) Contexto: que sabe el sistema
 *   2) Lectura: que interpreta Claudia
 *   3) Riesgo: que puede salir mal
 *   4) Accion: que se puede hacer ahora
 *   5) Rastro: donde queda auditado
 *
 * Este servicio agrega esos cinco campos para un caso, sin llamar a
 * Gemini por defecto (es read-only y rápido). El enriquecimiento con
 * AI se reserva para POST /analyze del caseIntelligence existente.
 */

const db = require('../config/db');

const URGENCY_DAYS = {
  CRITICO: 3,
  ALTO: 7,
  MEDIO: 15,
};

async function getSala(caseId) {
  const [caseRow, recentComms, pendingTasks, upcomingDeadlines, latestAnalysis, openPlan, actuaciones] = await Promise.all([
    loadCase(caseId),
    loadRecentCommunications(caseId, 5),
    loadPendingTasks(caseId),
    loadUpcomingDeadlines(caseId),
    loadLatestAnalysis(caseId),
    loadOpenAgentPlan(caseId),
    loadRecentActuaciones(caseId, 3),
  ]);

  if (!caseRow) return null;

  const state = buildState(caseRow);
  const risk = buildRisk({ caseRow, upcomingDeadlines, pendingTasks });
  const nextAction = buildNextAction({ caseRow, pendingTasks, upcomingDeadlines, latestAnalysis });
  const gaps = buildGaps({ caseRow, recentComms, actuaciones });
  const sources = buildSources({ recentComms, actuaciones });
  const lectura = buildLectura({ latestAnalysis });
  const plan = openPlan ? {
    id: openPlan.id,
    title: openPlan.title || openPlan.action_type,
    status: openPlan.status,
    requires_approval: openPlan.requires_approval,
    created_at: openPlan.created_at,
  } : null;

  return {
    case: {
      id: caseRow.id,
      case_number: caseRow.case_number,
      title: caseRow.title,
      status: caseRow.status,
      service_type: caseRow.service_type,
    },
    state,
    lectura,
    risk,
    next_action: nextAction,
    gaps,
    sources,
    plan,
    generated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────

async function loadCase(caseId) {
  const { rows } = await db.query(
    `SELECT c.*, cl.full_name AS client_name
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1
      LIMIT 1`,
    [caseId]
  );
  return rows[0] || null;
}

async function loadRecentCommunications(caseId, limit) {
  const { rows } = await db.query(
    `SELECT id, type, content, metadata, created_at
       FROM communications
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [caseId, limit]
  );
  return rows;
}

async function loadPendingTasks(caseId) {
  const { rows } = await db.query(
    `SELECT id, title, priority, due_date, status
       FROM tareas
      WHERE case_id = $1 AND status NOT IN ('COMPLETADA', 'CANCELADA')
      ORDER BY
        CASE priority WHEN 'CRITICA' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
        due_date NULLS LAST
      LIMIT 10`,
    [caseId]
  );
  return rows;
}

async function loadUpcomingDeadlines(caseId) {
  const { rows } = await db.query(
    `SELECT id, title, due_date, urgency, resolved
       FROM vencimientos
      WHERE case_id = $1
        AND resolved = FALSE
      ORDER BY due_date ASC NULLS LAST
      LIMIT 5`,
    [caseId]
  );
  return rows;
}

async function loadLatestAnalysis(caseId) {
  try {
    const { rows } = await db.query(
      `SELECT id, executive_summary, relevant_facts, risks, suggested_actions, created_at
         FROM case_intelligence_analyses
        WHERE case_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [caseId]
    );
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function loadOpenAgentPlan(caseId) {
  try {
    const { rows } = await db.query(
      `SELECT id, action_type, status, requires_approval, created_at, params
         FROM agent_plans
        WHERE (params->>'case_id')::int = $1
          AND status IN ('draft', 'pending', 'approved')
        ORDER BY created_at DESC
        LIMIT 1`,
      [caseId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return { ...r, title: r.params?.title || null };
  } catch {
    return null;
  }
}

async function loadRecentActuaciones(caseId, limit) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.fecha_actuacion, a.actuacion, a.anotacion, a.is_new,
              l.platform_key, l.external_process_number
         FROM judicial_actuaciones a
         JOIN judicial_case_links l ON l.id = a.case_link_id
        WHERE l.case_id = $1
        ORDER BY a.fecha_actuacion DESC NULLS LAST, a.id DESC
        LIMIT $2`,
      [caseId, limit]
    );
    return rows;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Builders
// ─────────────────────────────────────────────────────────────

function buildState(caseRow) {
  return {
    status: caseRow.status,
    next_action_text: caseRow.next_action || null,
    next_action_date: caseRow.next_action_date,
    days_until_next: daysUntil(caseRow.next_action_date),
    response_deadline: caseRow.response_deadline,
    days_until_deadline: daysUntil(caseRow.response_deadline),
    client_name: caseRow.client_name,
    assigned_to: caseRow.assigned_to,
  };
}

function buildRisk({ caseRow, upcomingDeadlines, pendingTasks }) {
  const reasons = [];
  let level = 'BAJO';

  const dDays = daysUntil(caseRow.response_deadline);
  if (dDays !== null) {
    if (dDays < 0) {
      level = 'CRITICO';
      reasons.push(`Plazo legal vencido hace ${Math.abs(dDays)} día(s)`);
    } else if (dDays <= URGENCY_DAYS.CRITICO) {
      level = bumpLevel(level, 'CRITICO');
      reasons.push(`Plazo legal en ${dDays} día(s)`);
    } else if (dDays <= URGENCY_DAYS.ALTO) {
      level = bumpLevel(level, 'ALTO');
      reasons.push(`Plazo legal en ${dDays} día(s)`);
    }
  }

  for (const v of upcomingDeadlines.slice(0, 3)) {
    const days = daysUntil(v.due_date);
    if (days === null) continue;
    if (days < 0) {
      level = bumpLevel(level, 'CRITICO');
      reasons.push(`Vencimiento "${truncate(v.title, 40)}" vencido hace ${Math.abs(days)}d`);
    } else if (days <= URGENCY_DAYS.CRITICO) {
      level = bumpLevel(level, 'CRITICO');
      reasons.push(`Vencimiento "${truncate(v.title, 40)}" en ${days}d`);
    } else if (days <= URGENCY_DAYS.ALTO && v.urgency === 'CRITICO') {
      level = bumpLevel(level, 'ALTO');
      reasons.push(`Vencimiento crítico en ${days}d`);
    }
  }

  const criticasPendientes = pendingTasks.filter((t) => t.priority === 'CRITICA').length;
  if (criticasPendientes > 0) {
    level = bumpLevel(level, 'ALTO');
    reasons.push(`${criticasPendientes} tarea(s) críticas sin completar`);
  }

  if (!reasons.length) reasons.push('Sin señales de riesgo inmediato');

  return { level, reasons };
}

function buildNextAction({ caseRow, pendingTasks, upcomingDeadlines, latestAnalysis }) {
  // Prioridad: 1) deadline más cercano, 2) tarea crítica, 3) next_action del caso, 4) sugerencia AI
  const closestDeadline = upcomingDeadlines[0];
  if (closestDeadline && daysUntil(closestDeadline.due_date) !== null && daysUntil(closestDeadline.due_date) <= URGENCY_DAYS.MEDIO) {
    return {
      source: 'deadline',
      text: `Atender "${closestDeadline.title}"`,
      due_date: closestDeadline.due_date,
      ref: { type: 'vencimiento', id: closestDeadline.id },
    };
  }

  const criticalTask = pendingTasks.find((t) => t.priority === 'CRITICA');
  if (criticalTask) {
    return {
      source: 'task',
      text: criticalTask.title,
      due_date: criticalTask.due_date,
      ref: { type: 'tarea', id: criticalTask.id },
    };
  }

  if (caseRow.next_action) {
    return {
      source: 'case',
      text: caseRow.next_action,
      due_date: caseRow.next_action_date,
      ref: null,
    };
  }

  const aiSuggestion = latestAnalysis?.suggested_actions?.[0];
  if (aiSuggestion) {
    return {
      source: 'ai',
      text: typeof aiSuggestion === 'string' ? aiSuggestion : (aiSuggestion.text || aiSuggestion.action || ''),
      due_date: null,
      ref: { type: 'analysis', id: latestAnalysis.id },
    };
  }

  return {
    source: 'none',
    text: 'Sin acción pendiente clara — analizar el caso para sugerir.',
    due_date: null,
    ref: null,
  };
}

function buildGaps({ caseRow, recentComms, actuaciones }) {
  const gaps = [];
  if (!caseRow.client_id) gaps.push('Cliente sin vincular');
  if (!caseRow.entity)    gaps.push('Entidad accionada no registrada');
  if (!caseRow.response_deadline) gaps.push('Sin plazo legal registrado');
  if (recentComms.length === 0)   gaps.push('Sin comunicaciones registradas en el expediente');
  if (!caseRow.drive_folder_id)   gaps.push('Sin carpeta Drive del expediente');
  if (actuaciones.length === 0 && caseRow.filing_date) {
    gaps.push('Caso radicado pero sin actuaciones cargadas (vincular en Radar Colombia)');
  }
  return gaps;
}

function buildSources({ recentComms, actuaciones }) {
  const items = [];
  for (const c of recentComms.slice(0, 3)) {
    const meta = typeof c.metadata === 'string' ? safeJson(c.metadata) : (c.metadata || {});
    items.push({
      type: c.type,
      label: meta.subject || truncate(c.content, 80),
      ref: `communication:${c.id}`,
      at: c.created_at,
      origin: meta.source || c.type,
    });
  }
  for (const a of actuaciones) {
    items.push({
      type: 'actuacion',
      label: a.actuacion,
      ref: `actuacion:${a.id}`,
      at: a.fecha_actuacion,
      origin: a.platform_key,
      is_new: a.is_new,
    });
  }
  items.sort((x, y) => (new Date(y.at).getTime() || 0) - (new Date(x.at).getTime() || 0));
  return items.slice(0, 5);
}

function buildLectura({ latestAnalysis }) {
  if (!latestAnalysis) {
    return {
      available: false,
      summary: 'Sin análisis aún. Genera uno desde el panel agéntico para que Claudia lea el caso.',
      created_at: null,
    };
  }
  return {
    available: true,
    summary: latestAnalysis.executive_summary || 'Análisis sin resumen ejecutivo.',
    risks: latestAnalysis.risks || [],
    created_at: latestAnalysis.created_at,
    analysis_id: latestAnalysis.id,
  };
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function daysUntil(date) {
  if (!date) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(date);
  if (Number.isNaN(target.getTime())) return null;
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
}

function bumpLevel(current, candidate) {
  const order = { BAJO: 1, MEDIO: 2, ALTO: 3, CRITICO: 4 };
  return order[candidate] > order[current] ? candidate : current;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

module.exports = { getSala };
