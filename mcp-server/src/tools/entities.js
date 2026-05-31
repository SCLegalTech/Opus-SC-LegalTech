/**
 * tools/entities.js - Grimorio Runtime / entidades autonomas
 * Phi SC LegalTech - Opus MCP Server
 */

import { z } from 'zod';
import { get, post } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e) => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

export function registerEntityTools(server) {
  server.tool('entity_list', 'Lista el primer grupo de 12 entidades autonomas.', {}, async () => {
    try { return ok(await get('/entities')); } catch (e) { return err(e); }
  });

  server.tool(
    'entity_get',
    'Obtiene el detalle operativo de una entidad por nombre o clave.',
    { key: z.string().min(2).describe('Clave o nombre de la entidad.') },
    async ({ key }) => {
      try { return ok(await get(`/entities/${encodeURIComponent(key)}`)); } catch (e) { return err(e); }
    }
  );

  server.tool(
    'entity_resolve',
    'Resuelve que entidad debe liderar una orden en lenguaje natural.',
    {
      instruction: z.string().min(3),
      limit: z.number().int().min(1).max(6).default(4),
    },
    async ({ instruction, limit }) => {
      try { return ok(await post('/entities/resolve', { instruction, limit })); } catch (e) { return err(e); }
    }
  );

  server.tool(
    'entity_invoke',
    'Invoca una entidad como agente especializado y devuelve lectura, brechas Kaizen, acciones y plan.',
    {
      key: z.string().min(2),
      instruction: z.string().min(3),
      case_id: z.number().int().optional(),
      mode: z.enum(['plan', 'diagnostic']).default('plan'),
      create_plan: z.boolean().default(true),
    },
    async ({ key, instruction, case_id, mode, create_plan }) => {
      try {
        return ok(await post(`/entities/${encodeURIComponent(key)}/invoke`, {
          instruction,
          case_id,
          mode,
          create_plan,
        }));
      } catch (e) { return err(e); }
    }
  );

  server.tool(
    'entity_signals',
    'Lista senales autonomas, invocaciones y brechas de capacidad detectadas por entidades.',
    {
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
    async ({ entity, limit }) => {
      try { return ok(await get('/entities/signals', { entity, limit })); } catch (e) { return err(e); }
    }
  );

  server.tool(
    'entity_monitor_run',
    'Ejecuta monitores autonomos de entidades y registra senales sin duplicar recientes.',
    {
      entity: z.string().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ entity, limit }) => {
      try { return ok(await post('/entities/monitors/run', { entity, limit })); } catch (e) { return err(e); }
    }
  );
}
