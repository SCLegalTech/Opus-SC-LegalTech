/**
 * tools/tasks.js — Herramientas de tareas y vencimientos
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (2):
 *   list_tasks     — Listar tareas con filtros (globales o por caso/macrocaso)
 *   list_deadlines — Vencimientos próximos o vencidos
 */

import { z } from 'zod';
import { get, post, put } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok  = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const TaskStatus = z.enum(['PENDIENTE','EN_CURSO','COMPLETADA','CANCELADA']);
const TaskPriority = z.enum(['BAJA','MEDIA','ALTA','CRITICA']);

export function registerTaskTools(server) {

  // 12. list_tasks
  server.tool(
    'list_tasks',
    'Lista las tareas del sistema. Se puede filtrar por estado, prioridad, caso o macrocaso. Sin filtros devuelve la bandeja completa del agente.',
    {
      status:       TaskStatus.optional(),
      priority:     TaskPriority.optional(),
      case_id:      z.number().int().optional().describe('Filtrar tareas de un caso específico'),
      macrocaso_id: z.number().int().optional().describe('Filtrar tareas de un macrocaso específico'),
      limit:        z.number().int().min(1).max(200).default(50),
      offset:       z.number().int().min(0).default(0),
    },
    async (params) => {
      try { return ok(await get('/tareas', { ...params, envelope: true })); }
      catch (e) { return err(e); }
    }
  );

  // 13. list_deadlines
  server.tool(
    'list_deadlines',
    'Devuelve los vencimientos procesales próximos (hasta 30 días) y los ya vencidos sin resolver. Crítico para gestión de términos legales.',
    {
      days:    z.number().int().min(1).max(90).default(30)
                .describe('Ventana de días hacia adelante para considerar "próximo"'),
      include_overdue: z.boolean().default(true)
                .describe('Incluir vencimientos ya pasados sin resolver'),
    },
    async ({ days, include_overdue }) => {
      try { return ok(await get('/vencimientos/proximos', { days, include_overdue })); }
      catch (e) { return err(e); }
    }
  );

  // 14. create_task
  server.tool(
    'create_task',
    'Crea una tarea concreta en la bandeja de trabajo. Para uso agentico debe venir de un plan aprobado o de una instruccion humana explicita. Si case_id esta presente, la tarea queda asociada al caso.',
    {
      title:       z.string().min(3).max(500),
      description: z.string().optional(),
      case_id:     z.union([z.string(), z.number().int()]).optional(),
      assigned_to: z.number().int().optional(),
      priority:    TaskPriority.default('MEDIA'),
      due_date:    z.string().nullable().optional().describe('Fecha ISO YYYY-MM-DD o null.'),
      context:     z.string().optional(),
      checklist:   z.array(z.object({
        label: z.string(),
        done:  z.boolean().optional(),
      })).optional(),
    },
    async ({ case_id, ...body }) => {
      try {
        const path = case_id ? `/cases/${case_id}/tareas` : '/tareas';
        return ok(await post(path, body));
      } catch (e) { return err(e); }
    }
  );

  // 15. update_task
  server.tool(
    'update_task',
    'Actualiza una tarea existente: estado, prioridad, fecha, responsable o contenido. Completar una tarea tambien resuelve vencimientos asociados.',
    {
      id:                z.number().int(),
      title:             z.string().min(3).max(500).optional(),
      description:       z.string().optional(),
      assigned_to:       z.number().int().optional(),
      priority:          TaskPriority.optional(),
      status:            TaskStatus.optional(),
      due_date:          z.string().nullable().optional(),
      context:           z.string().optional(),
      blocked_reason:    z.string().nullable().optional(),
      estimated_minutes: z.number().int().nullable().optional(),
    },
    async ({ id, ...body }) => {
      try { return ok(await put(`/tareas/${id}`, body)); }
      catch (e) { return err(e); }
    }
  );
}
