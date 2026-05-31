/**
 * tools/agent.js — Auditoría agéntica y planes multi-paso
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (6):
 *   agent_action_log         — Registra una acción en el log inmutable.
 *   agent_action_list        — Lista acciones registradas (filtrable por caso).
 *   agent_plan_create        — Crea un plan multi-paso (propuesta agéntica).
 *   agent_plan_list          — Lista planes.
 *   agent_plan_get           — Detalle de un plan con todos sus pasos.
 *   agent_plan_update_step   — Actualiza un paso: aprobar, ejecutar, saltar.
 *
 * Principio constitucional (§ VI):
 *   - `agent_actions` es append-only (triggers SQL bloquean UPDATE/DELETE).
 *   - Planes con pasos `requires_approval=true` deben aprobarse antes de
 *     ejecutarse. Este tool NO ejecuta los pasos: el agente lee el plan,
 *     ejecuta cada paso con la herramienta correspondiente, y reporta el
 *     resultado de vuelta vía agent_plan_update_step o agent_action_log.
 */

import { z } from 'zod';
import { get, post, patch } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok   = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err  = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const ACTION_STATUS = z.enum(['pending', 'approved', 'executed', 'rejected', 'failed']);
const PLAN_STATUS   = z.enum(['draft', 'in_progress', 'completed', 'cancelled']);
const STEP_STATUS   = z.enum(['pending', 'approved', 'executed', 'skipped', 'failed']);

export function registerAgentTools(server) {

  // 1. agent_action_log — escribe en el log inmutable
  server.tool(
    'agent_action_log',
    'Registra una acción agéntica en el log inmutable `agent_actions`. Úsalo tras ejecutar cualquier herramienta con efecto (envío de correo, exportación a Drive, firma, modificación de caso) para dejar rastro auditable. No se puede modificar ni borrar (triggers SQL lo bloquean).',
    {
      action_type: z.string().min(3)
                     .describe('Tipo de acción. Ej: "gmail_send", "document_export_to_drive", "case_update".'),
      case_id:     z.number().int().optional().describe('ID del caso afectado.'),
      client_id:   z.number().int().optional().describe('ID del cliente afectado.'),
      document_id: z.number().int().optional().describe('ID del documento afectado.'),
      plan_id:     z.number().int().optional().describe('ID del plan padre (si aplica).'),
      params:      z.record(z.string(), z.any()).optional()
                     .describe('Parámetros de la acción (JSONB).'),
      result:      z.record(z.string(), z.any()).optional()
                     .describe('Resultado de la ejecución (JSONB).'),
      status:      ACTION_STATUS.optional()
                     .describe('Estado. Default: "executed".'),
      reversible:  z.boolean().optional()
                     .describe('¿La acción es reversible? Default: true.'),
    },
    async (input) => {
      try { return ok(await post('/agent/actions', input)); }
      catch (e) { return err(e); }
    }
  );

  // 2. agent_action_list
  server.tool(
    'agent_action_list',
    'Lista el historial de acciones agénticas. Filtrable por caso y tipo. Ordenado por fecha descendente.',
    {
      case_id:     z.number().int().optional(),
      action_type: z.string().optional(),
      limit:       z.number().int().min(1).max(200).default(50),
      offset:      z.number().int().min(0).default(0),
    },
    async ({ case_id, action_type, limit, offset }) => {
      try {
        return ok(await get('/agent/actions', { case_id, action_type, limit, offset }));
      } catch (e) { return err(e); }
    }
  );

  // 3. agent_plan_create
  server.tool(
    'agent_plan_create',
    'Crea un plan multi-paso para una tarea compleja (ej. "organizar expediente completo del cliente X": buscar en Drive → crear subcarpetas → mover archivos → ingestar correos → redactar oficio). Cada paso puede marcarse `requires_approval=true` si es irreversible (ej. enviar correo, firmar documento). El plan nace en "draft" y pasa a "in_progress" cuando se empieza a ejecutar.',
    {
      title:       z.string().min(3).max(500),
      description: z.string().optional(),
      case_id:     z.number().int().optional(),
      client_id:   z.number().int().optional(),
      steps: z.array(z.object({
        tool:              z.string().describe('Nombre de la herramienta MCP a ejecutar. Ej: "drive_organize_expediente".'),
        params:            z.record(z.string(), z.any()).optional().describe('Parámetros para la herramienta.'),
        description:       z.string().optional().describe('Descripción legible del paso.'),
        requires_approval: z.boolean().optional()
                             .describe('Si true, el agente debe detenerse y pedir aprobación humana antes de ejecutar.'),
      })).describe('Pasos del plan en orden de ejecución.'),
      status: PLAN_STATUS.optional(),
    },
    async (input) => {
      try { return ok(await post('/agent/plans', input)); }
      catch (e) { return err(e); }
    }
  );

  // 4. agent_plan_list
  server.tool(
    'agent_plan_list',
    'Lista planes agénticos. Filtrable por caso y estado. No devuelve los pasos completos — usa agent_plan_get.',
    {
      case_id: z.number().int().optional(),
      status:  PLAN_STATUS.optional(),
      limit:   z.number().int().min(1).max(200).default(50),
      offset:  z.number().int().min(0).default(0),
    },
    async ({ case_id, status, limit, offset }) => {
      try { return ok(await get('/agent/plans', { case_id, status, limit, offset })); }
      catch (e) { return err(e); }
    }
  );

  // 5. agent_plan_get
  server.tool(
    'agent_plan_get',
    'Obtiene el detalle de un plan, incluyendo todos sus pasos con su estado actual (pending, approved, executed, skipped, failed) y los resultados de los ya ejecutados.',
    { id: z.number().int().describe('ID numérico del plan.') },
    async ({ id }) => {
      try { return ok(await get(`/agent/plans/${id}`)); }
      catch (e) { return err(e); }
    }
  );

  // 6. agent_plan_update_step — aprobar/ejecutar/saltar pasos
  server.tool(
    'agent_plan_update_step',
    'Actualiza un paso de un plan. Úsalo para: (a) aprobar un paso con requires_approval (pasando approve=true), (b) marcar un paso como executed con su result, (c) saltar un paso (status="skipped"), (d) marcar un paso como failed con el error. Cuando todos los pasos quedan executed o skipped, el plan pasa automáticamente a "completed".',
    {
      plan_id:    z.number().int(),
      step_index: z.number().int().min(0).describe('Índice del paso (0-based).'),
      approve:    z.boolean().optional()
                    .describe('Si true, marca el paso como approved y registra al usuario como approved_by.'),
      status:     STEP_STATUS.optional(),
      result:     z.record(z.string(), z.any()).optional()
                    .describe('Resultado de la ejecución del paso (JSONB).'),
    },
    async ({ plan_id, step_index, approve, status, result }) => {
      try {
        return ok(await patch(`/agent/plans/${plan_id}/steps/${step_index}`, {
          approve, status, result,
        }));
      } catch (e) { return err(e); }
    }
  );

  // 7. agent_proactive_status
  server.tool(
    'agent_proactive_status',
    'Devuelve la configuracion de la capa local Gemma/Ollama y el estado del autopiloto. Usa health=true para comprobar si Ollama responde y si el modelo configurado esta descargado.',
    {
      health: z.boolean().default(false),
    },
    async ({ health }) => {
      try { return ok(await get('/agent/status', { health })); }
      catch (e) { return err(e); }
    }
  );

  // 8. agent_proactive_run
  server.tool(
    'agent_proactive_run',
    'Ejecuta un barrido proactivo local sobre casos activos. Crea planes draft con pasos aprobables para tareas, expedientes, vencimientos y Drive; dry_run=true previsualiza sin guardar.',
    {
      dry_run: z.boolean().default(true),
      limit:   z.number().int().min(1).max(20).default(5),
    },
    async ({ dry_run, limit }) => {
      try { return ok(await post('/agent/proactive/run', { dry_run, limit })); }
      catch (e) { return err(e); }
    }
  );
}
