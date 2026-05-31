/**
 * tools/cases.js — Herramientas de casos
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (6):
 *   list_cases          — Listar casos con filtros
 *   get_case            — Detalle de un caso por ID o UUID
 *   create_case         — Crear un caso nuevo
 *   update_case         — Actualizar campos de un caso existente
 *   list_communications — Comunicaciones / bitácora de un caso
 *   add_communication   — Agregar nota, email o llamada a un caso
 */

import { z } from 'zod';
import { get, post, put } from '../api-client.js';

/** Formatea cualquier valor como texto JSON indentado para el agente. */
const json = (v) => JSON.stringify(v, null, 2);

/** Envuelve el resultado en el formato de contenido MCP. */
const ok  = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

// ─── Schemas comunes ──────────────────────────────────────────────────────────

const CaseId = z.string().describe(
  'ID numérico o UUID del caso. Ejemplo: "42" o "550e8400-e29b-41d4-a716-446655440000"'
);

// ─── Herramientas ─────────────────────────────────────────────────────────────

export function registerCaseTools(server) {

  // 1. list_cases
  server.tool(
    'list_cases',
    'Lista los casos accesibles para el agente. Soporta filtros por estado, tipo de servicio y búsqueda de texto libre (número de caso, título o nombre del cliente).',
    {
      status:       z.enum(['NUEVO','EN_PROCESO','PENDIENTE','CERRADO']).optional()
                     .describe('Filtrar por estado del caso (contrato real Opus)'),
      service_type: z.string().optional()
                     .describe('Filtrar por tipo de servicio (LABORAL, SOCIETARIO, OTRO, PQRS, TUTELA, etc.)'),
      search:       z.string().optional()
                     .describe('Búsqueda libre sobre número, título o nombre del cliente'),
      limit:        z.number().int().min(1).max(200).default(50)
                     .describe('Máximo de resultados a devolver'),
      offset:       z.number().int().min(0).default(0)
                     .describe('Desplazamiento para paginación'),
    },
    async ({ status, service_type, search, limit, offset }) => {
      try {
        return ok(await get('/cases', { status, service_type, search, limit, offset }));
      } catch (e) { return err(e); }
    }
  );

  // 2. get_case
  server.tool(
    'get_case',
    'Obtiene el detalle completo de un caso: datos del cliente, abogado asignado, fechas, estado y honorarios.',
    { id: CaseId },
    async ({ id }) => {
      try { return ok(await get(`/cases/${id}`)); }
      catch (e) { return err(e); }
    }
  );

  // 3. create_case
  server.tool(
    'create_case',
    'Crea un caso nuevo en el sistema. El número de caso (SC-YYYY-NNNN) se genera automáticamente de forma atómica.',
    {
      client_id:         z.number().int().describe('ID numérico del cliente'),
      service_type:      z.string().describe('Tipo de servicio (LABORAL, SOCIETARIO, OTRO, PQRS, TUTELA, etc.)'),
      title:             z.string().min(3).describe('Título descriptivo del caso'),
      description:       z.string().optional().describe('Descripción detallada'),
      entity:            z.string().optional().describe('Entidad o contraparte involucrada'),
      assigned_to:       z.number().int().optional().describe('ID del abogado o asistente asignado (omitir = usuario actual)'),
      filing_date:       z.string().optional().describe('Fecha de radicación ISO 8601 (YYYY-MM-DD)'),
      response_deadline: z.string().optional().describe('Fecha límite de respuesta ISO 8601 (YYYY-MM-DD)'),
    },
    async (body) => {
      try { return ok(await post('/cases', body)); }
      catch (e) { return err(e); }
    }
  );

  // 4. update_case
  server.tool(
    'update_case',
    'Actualiza uno o más campos de un caso existente. Solo se modifican los campos que se envíen.',
    {
      id:                CaseId,
      title:             z.string().optional(),
      description:       z.string().optional(),
      entity:            z.string().optional(),
      status:            z.enum(['NUEVO','EN_PROCESO','PENDIENTE','CERRADO']).optional(),
      fee_paid:          z.boolean().optional().describe('Marcar si los honorarios han sido pagados'),
      assigned_to:       z.number().int().optional(),
      filing_date:       z.string().optional(),
      response_deadline: z.string().optional(),
      next_action:       z.string().optional().describe('Descripción de la próxima acción procesal'),
      next_action_date:  z.string().optional().describe('Fecha de la próxima acción (YYYY-MM-DD)'),
      closed_at:         z.string().optional().describe('Fecha de cierre (YYYY-MM-DD)'),
    },
    async ({ id, ...fields }) => {
      try { return ok(await put(`/cases/${id}`, fields)); }
      catch (e) { return err(e); }
    }
  );

  // 5. list_communications
  server.tool(
    'list_communications',
    'Obtiene el historial completo de comunicaciones y notas de un caso, ordenado cronológicamente.',
    { case_id: CaseId.describe('ID o UUID del caso') },
    async ({ case_id }) => {
      try { return ok(await get(`/cases/${case_id}/communications`)); }
      catch (e) { return err(e); }
    }
  );

  // 6. add_communication
  server.tool(
    'add_communication',
    'Agrega una comunicación o nota a la bitácora de un caso. Útil para registrar llamadas, correos o avances.',
    {
      case_id: CaseId.describe('ID o UUID del caso'),
      type:    z.enum(['note','email','call','hearing']).default('note')
                .describe('Tipo de comunicación'),
      content: z.string().min(1).describe('Contenido de la nota o resumen de la comunicación'),
    },
    async ({ case_id, type, content }) => {
      try { return ok(await post(`/cases/${case_id}/communications`, { type, content })); }
      catch (e) { return err(e); }
    }
  );
}
