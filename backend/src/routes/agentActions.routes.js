/**
 * agentActions.routes.js
 * ─────────────────────────────────────────────────────────────
 * Auditoría agéntica y planes multi-paso.
 *
 *   actionsRouter → /api/v1/agent/actions
 *   plansRouter   → /api/v1/agent/plans
 *
 * Contrato constitucional (§ VI):
 *   - agent_actions es append-only (triggers SQL bloquean UPDATE/DELETE).
 *   - Los planes son propuestas: pasos con requires_approval=true
 *     detienen la ejecución hasta que un humano apruebe vía
 *     PATCH /plans/:id/steps/:stepIndex con { approve: true }.
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { requireInternal } = require('../middleware/authz');
const {
  logAction,
  listActions,
  createPlan,
  listPlans,
  getPlan,
  updatePlanStep,
} = require('../controllers/agentActions.controller');

// ── Acciones (log inmutable) ──────────────────────────────────
const actionsRouter = express.Router();
actionsRouter.use(authenticate, requireInternal);
actionsRouter.get ('/', listActions);
actionsRouter.post('/', logAction);

// ── Planes ────────────────────────────────────────────────────
const plansRouter = express.Router();
plansRouter.use(authenticate, requireInternal);
plansRouter.get  ('/',                       listPlans);
plansRouter.post ('/',                       createPlan);
plansRouter.get  ('/:id',                    getPlan);
plansRouter.patch('/:id/steps/:stepIndex',   updatePlanStep);

module.exports = { actionsRouter, plansRouter };
