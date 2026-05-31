/**
 * agentActions.controller.js
 * ─────────────────────────────────────────────────────────────
 * Auditoría inmutable de acciones agénticas + planes multi-paso.
 *
 * Tablas:
 *   agent_actions — append-only (triggers SQL bloquean UPDATE/DELETE)
 *   agent_plans   — planes con pasos; cada paso puede requerir
 *                   aprobación humana antes de ejecutarse.
 *
 * El controller NO ejecuta los pasos del plan: sólo los registra.
 * La ejecución corresponde al agente (Claudia / MCP client) que lee
 * el plan, ejecuta el paso, y registra el resultado via log_action
 * o update_plan_step. Esto preserva la Constitución § VI.
 */

const db = require('../config/db');
const {
  canAccessCase,
  canAccessClient,
  hasOperationalScope,
} = require('../middleware/authz');

const ACTION_STATUSES = ['pending', 'approved', 'executed', 'rejected', 'failed'];
const PLAN_STATUSES   = ['draft', 'in_progress', 'completed', 'cancelled'];
const STEP_STATUSES   = ['pending', 'approved', 'executed', 'skipped', 'failed'];

function buildAgentRecordFilter(alias, user, offset = 1) {
  if (hasOperationalScope(user?.role)) return { clause: '', params: [], next: offset };

  const role = String(user?.role || '').toLowerCase();
  if (role === 'client') {
    return {
      clause: `(${alias}.user_id = $${offset} OR (
        ${alias}.client_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM clients _cl
          WHERE _cl.id = ${alias}.client_id
            AND LOWER(_cl.email) = LOWER($${offset + 1})
        )
      ))`,
      params: [user.id, user.email || ''],
      next: offset + 2,
    };
  }

  return {
    clause: `(${alias}.user_id = $${offset} OR (
      ${alias}.case_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM cases _c
        LEFT JOIN macrocasos _m ON _c.macrocaso_id = _m.id
        WHERE _c.id = ${alias}.case_id
          AND (_c.assigned_to = $${offset + 1} OR _c.created_by = $${offset + 2} OR _m.lead_lawyer = $${offset + 3})
      )
    ) OR (
      ${alias}.client_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM cases _cc
        LEFT JOIN macrocasos _cm ON _cc.macrocaso_id = _cm.id
        WHERE _cc.client_id = ${alias}.client_id
          AND (_cc.assigned_to = $${offset + 4} OR _cc.created_by = $${offset + 5} OR _cm.lead_lawyer = $${offset + 6})
      )
    ))`,
    params: [user.id, user.id, user.id, user.id, user.id, user.id, user.id],
    next: offset + 7,
  };
}

async function assertAgentScope(req, res, { caseId, clientId }) {
  if (caseId) {
    const ok = await canAccessCase(req.user.id, req.user.role, caseId);
    if (!ok) {
      res.status(403).json({ error: 'No autorizado para usar este caso en una accion agentica' });
      return false;
    }
  }
  if (clientId) {
    const ok = await canAccessClient(req.user, clientId);
    if (!ok) {
      res.status(403).json({ error: 'No autorizado para usar este cliente en una accion agentica' });
      return false;
    }
  }
  return true;
}

// ─── Acciones ─────────────────────────────────────────────────

async function logAction(req, res) {
  const {
    action_type, case_id, client_id, document_id, plan_id,
    params, result, status, reversible,
  } = req.body || {};

  if (!action_type || typeof action_type !== 'string') {
    return res.status(400).json({ error: 'action_type es requerido' });
  }
  if (status && !ACTION_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status inválido. Permitidos: ${ACTION_STATUSES.join(', ')}` });
  }

  try {
    const scoped = await assertAgentScope(req, res, { caseId: case_id, clientId: client_id });
    if (!scoped) return;

    const { rows } = await db.query(
      `INSERT INTO agent_actions (
          action_type, case_id, client_id, document_id, plan_id,
          user_id, params, result, status, reversible, created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, NOW())
        RETURNING *`,
      [
        action_type,
        case_id || null,
        client_id || null,
        document_id || null,
        plan_id || null,
        req.user.id,
        JSON.stringify(params || {}),
        JSON.stringify(result || {}),
        status || 'executed',
        reversible === undefined ? true : Boolean(reversible),
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[agent] logAction error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listActions(req, res) {
  const { case_id, action_type, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;
  if (case_id)     { conditions.push(`aa.case_id = $${i++}`);     params.push(Number(case_id)); }
  if (action_type) { conditions.push(`aa.action_type = $${i++}`); params.push(action_type); }
  const scope = buildAgentRecordFilter('aa', req.user, i);
  if (scope.clause) {
    conditions.push(scope.clause);
    params.push(...scope.params);
    i = scope.next;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    params.push(Math.min(Number(limit) || 50, 200));
    params.push(Number(offset) || 0);
    const { rows } = await db.query(
      `SELECT * FROM agent_actions aa ${where}
        ORDER BY aa.created_at DESC, aa.id DESC
        LIMIT $${i++} OFFSET $${i}`,
      params
    );
    res.json({ actions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─── Planes ───────────────────────────────────────────────────

function normalizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps)) return [];
  return rawSteps.map((s, index) => ({
    index,
    tool:              s.tool || null,
    params:            s.params && typeof s.params === 'object' ? s.params : {},
    description:       s.description || null,
    requires_approval: Boolean(s.requires_approval),
    status:            STEP_STATUSES.includes(s.status) ? s.status : 'pending',
    result:            s.result && typeof s.result === 'object' ? s.result : null,
    executed_at:       s.executed_at || null,
    approved_by:       s.approved_by || null,
  }));
}

async function createPlan(req, res) {
  const { title, description, case_id, client_id, steps, status } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title es requerido' });
  if (status && !PLAN_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status inválido. Permitidos: ${PLAN_STATUSES.join(', ')}` });
  }
  try {
    const scoped = await assertAgentScope(req, res, { caseId: case_id, clientId: client_id });
    if (!scoped) return;

    const normalized = normalizeSteps(steps);
    const { rows } = await db.query(
      `INSERT INTO agent_plans (
          title, description, case_id, client_id, user_id, steps, status, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW())
        RETURNING *`,
      [
        title.slice(0, 500),
        description || null,
        case_id || null,
        client_id || null,
        req.user.id,
        JSON.stringify(normalized),
        status || 'draft',
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[agent] createPlan error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listPlans(req, res) {
  const { case_id, status, limit = 50, offset = 0 } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;
  if (case_id) { conditions.push(`ap.case_id = $${i++}`); params.push(Number(case_id)); }
  if (status)  { conditions.push(`ap.status  = $${i++}`); params.push(status); }
  const scope = buildAgentRecordFilter('ap', req.user, i);
  if (scope.clause) {
    conditions.push(scope.clause);
    params.push(...scope.params);
    i = scope.next;
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    params.push(Math.min(Number(limit) || 50, 200));
    params.push(Number(offset) || 0);
    const { rows } = await db.query(
      `SELECT id, uuid, title, description, case_id, client_id, user_id, status, created_at, updated_at
         FROM agent_plans ap ${where}
         ORDER BY ap.created_at DESC, ap.id DESC
         LIMIT $${i++} OFFSET $${i}`,
      params
    );
    res.json({ plans: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPlan(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  try {
    const scope = buildAgentRecordFilter('ap', req.user, 2);
    const { rows } = await db.query(
      `SELECT * FROM agent_plans ap
        WHERE ap.id = $1
          ${scope.clause ? `AND ${scope.clause}` : ''}
        LIMIT 1`,
      [id, ...scope.params]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plan no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePlanStep(req, res) {
  const id = Number(req.params.id);
  const stepIndex = Number(req.params.stepIndex);
  if (!id || !Number.isInteger(stepIndex) || stepIndex < 0) {
    return res.status(400).json({ error: 'id o stepIndex inválido' });
  }
  const { status, result, approve } = req.body || {};
  if (status && !STEP_STATUSES.includes(status)) {
    return res.status(400).json({ error: `step status inválido. Permitidos: ${STEP_STATUSES.join(', ')}` });
  }

  try {
    const scope = buildAgentRecordFilter('ap', req.user, 2);
    const { rows: current } = await db.query(
      `SELECT * FROM agent_plans ap
        WHERE ap.id = $1
          ${scope.clause ? `AND ${scope.clause}` : ''}
        LIMIT 1`,
      [id, ...scope.params]
    );
    const plan = current[0];
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const steps = Array.isArray(plan.steps) ? [...plan.steps] : [];
    if (!steps[stepIndex]) return res.status(404).json({ error: 'Paso no existe en el plan' });

    const step = { ...steps[stepIndex] };
    if (approve) {
      step.status = 'approved';
      step.approved_by = req.user.id;
    }
    if (status) {
      step.status = status;
      if (status === 'executed' || status === 'failed') {
        step.executed_at = new Date().toISOString();
      }
    }
    if (result && typeof result === 'object') {
      step.result = result;
    }
    steps[stepIndex] = step;

    // Si todos los pasos están executed/skipped, el plan queda completed.
    const allDone = steps.every(s => s.status === 'executed' || s.status === 'skipped');
    const nextStatus = allDone ? 'completed' : (plan.status === 'draft' ? 'in_progress' : plan.status);

    const { rows } = await db.query(
      `UPDATE agent_plans
          SET steps = $2::jsonb,
              status = $3,
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [id, JSON.stringify(steps), nextStatus]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[agent] updatePlanStep error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  logAction,
  listActions,
  createPlan,
  listPlans,
  getPlan,
  updatePlanStep,
};
