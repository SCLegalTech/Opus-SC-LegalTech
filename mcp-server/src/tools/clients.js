/**
 * tools/clients.js — Herramientas de clientes
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (3):
 *   list_clients  — Buscar y listar clientes
 *   get_client    — Perfil completo de un cliente
 *   create_client — Registrar un cliente nuevo
 */

import { z } from 'zod';
import { get, post } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok  = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

export function registerClientTools(server) {

  // 7. list_clients
  server.tool(
    'list_clients',
    'Busca y lista los clientes registrados en el sistema. La búsqueda opera sobre nombre, número de documento y correo electrónico.',
    {
      search: z.string().optional().describe('Texto libre para buscar por nombre, documento o email'),
      limit:  z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    },
    async ({ search, limit, offset }) => {
      try { return ok(await get('/clients', { search, limit, offset })); }
      catch (e) { return err(e); }
    }
  );

  // 8. get_client
  server.tool(
    'get_client',
    'Obtiene el perfil completo de un cliente incluyendo sus datos de contacto y conteo de casos activos.',
    {
      id: z.string().describe('ID numérico o UUID del cliente'),
    },
    async ({ id }) => {
      try { return ok(await get(`/clients/${id}`)); }
      catch (e) { return err(e); }
    }
  );

  // 9. create_client
  server.tool(
    'create_client',
    'Registra un cliente nuevo en el sistema. El nombre completo es el único campo obligatorio.',
    {
      full_name:       z.string().min(2).describe('Nombre completo del cliente'),
      document_type:   z.enum(['CC','CE','NIT','PP','TE']).default('CC')
                        .describe('Tipo de documento de identidad'),
      document_number: z.string().optional().describe('Número de documento'),
      email:           z.string().email().optional(),
      phone:           z.string().optional(),
      address:         z.string().optional(),
      city:            z.string().optional(),
      notes:           z.string().optional().describe('Notas internas sobre el cliente'),
    },
    async (body) => {
      try { return ok(await post('/clients', body)); }
      catch (e) { return err(e); }
    }
  );
}
