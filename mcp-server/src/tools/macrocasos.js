/**
 * tools/macrocasos.js — Herramientas de macrocasos / proyectos colectivos
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (2):
 *   list_macrocasos — Listar proyectos con filtros
 *   get_macrocaso   — Detalle completo de un macrocaso
 */

import { z } from 'zod';
import { get } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok  = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

export function registerMacrocasoTools(server) {

  // 10. list_macrocasos
  server.tool(
    'list_macrocasos',
    'Lista los macrocasos (proyectos colectivos) accesibles para el agente. Un macrocaso agrupa múltiples casos bajo una causa común — por ejemplo, todos los clientes en un PQRS colectivo ante la SIC.',
    {
      status:       z.enum(['ACTIVO','EN_ESPERA','CERRADO','ARCHIVADO']).optional(),
      service_type: z.enum(['PQRS','TUTELA']).optional(),
    },
    async ({ status, service_type }) => {
      try { return ok(await get('/macrocasos', { status, service_type })); }
      catch (e) { return err(e); }
    }
  );

  // 11. get_macrocaso
  server.tool(
    'get_macrocaso',
    'Obtiene el detalle completo de un macrocaso: abogado líder, número de casos miembros, tareas, vencimientos y próximas acciones.',
    {
      id: z.string().describe('ID numérico o UUID del macrocaso'),
    },
    async ({ id }) => {
      try { return ok(await get(`/macrocasos/${id}`)); }
      catch (e) { return err(e); }
    }
  );
}
