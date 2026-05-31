/**
 * tools/dashboard.js — Herramientas de inteligencia operacional
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (2):
 *   get_stats   — Métricas agregadas de la operación (casos, ingresos, tareas)
 *   get_bandeja — Bandeja de trabajo del agente (tareas y actuaciones pendientes)
 */

import { z } from 'zod';
import { get } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok  = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

export function registerDashboardTools(server) {

  // 14. get_stats
  server.tool(
    'get_stats',
    'Devuelve las métricas operacionales de la firma: total de casos activos, casos por estado, honorarios pendientes de cobro, tareas vencidas y próximos vencimientos. Útil para reportes ejecutivos y briefings de estado.',
    {
      // Sin parámetros requeridos — el scope se aplica según el token del agente
    },
    async () => {
      try { return ok(await get('/dashboard/stats')); }
      catch (e) { return err(e); }
    }
  );

  // 15. get_bandeja
  server.tool(
    'get_priority_score',
    'Devuelve el score de prioridad operacional del portafolio: casos ordenados por vencimientos, tareas vencidas, falta de siguiente accion, plazos de respuesta, documentos sin clasificar y correos recientes. Cumple el requisito de Paimon para tomar decisiones de priorizacion.',
    {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
      include_archived: z.boolean().default(false),
    },
    async ({ limit, offset, include_archived }) => {
      try { return ok(await get('/operations/priority-score', { limit, offset, include_archived })); }
      catch (e) { return err(e); }
    }
  );

  server.tool(
    'get_global_priority_ranking',
    'Alias explicito para ChatGPT: devuelve el ranking global de priorizacion del portafolio Opus. Usar cuando el usuario pida priorizacion global, ranking completo de prioridad, dashboard ejecutivo, auditoria amplia del portafolio, casos criticos, tareas vencidas o proximos vencimientos.',
    {
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0),
      include_archived: z.boolean().default(false),
    },
    async ({ limit, offset, include_archived }) => {
      try { return ok(await get('/operations/priority-score', { limit, offset, include_archived })); }
      catch (e) { return err(e); }
    }
  );

  server.tool(
    'get_operational_metrics',
    'Alias explicito para ChatGPT: devuelve metricas operacionales agregadas de Opus: total de casos, clientes, casos activos, ingresos, casos por estado, honorarios pendientes, tareas vencidas y proximos vencimientos.',
    {},
    async () => {
      try { return ok(await get('/dashboard/stats')); }
      catch (e) { return err(e); }
    }
  );

  server.tool(
    'get_bandeja',
    'Retorna la bandeja de trabajo del agente: tareas pendientes propias, actuaciones próximas y vencimientos que requieren atención inmediata. Es el punto de partida ideal para una sesión de trabajo.',
    {
      user_id: z.number().int().optional()
                .describe('ID de usuario específico (solo administradores). Omitir para ver la propia bandeja.'),
    },
    async ({ user_id }) => {
      try { return ok(await get('/dashboard/bandeja', { user_id })); }
      catch (e) { return err(e); }
    }
  );
}
