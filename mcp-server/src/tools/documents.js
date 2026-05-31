/**
 * tools/documents.js — Plantillas jurídicas y redacción agéntica
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (7):
 *   list_templates            — Lista plantillas jurídicas disponibles.
 *   get_template              — Obtiene una plantilla.
 *   document_draft            — Redacta un documento (estado "borrador").
 *   list_case_documents       — Lista documentos del caso.
 *   get_document              — Detalle de un documento.
 *   document_export_to_drive  — Exporta el documento como Google Doc a la
 *                               subcarpeta 06_Borradores del expediente.
 *                               Requiere carpeta vinculada al caso.
 *   document_mark_signed      — Marca un documento como firmado. Registra
 *                               sha256 del cuerpo como referencia lógica.
 *
 * Principio de seguridad:
 *   Ningún documento generado por el agente debe pasar a firmado
 *   o enviado sin revisión humana. El tool document_draft NO
 *   firma ni envía: sólo crea el borrador.
 */

import { z } from 'zod';
import { get, post } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok   = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err  = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const CaseId = z.string().describe(
  'ID numérico o UUID del caso. Ejemplo: "42" o "SC-2026-0007".'
);

export function registerDocumentTools(server) {

  // 1. list_templates
  server.tool(
    'list_templates',
    'Lista las plantillas jurídicas activas. Cada plantilla tiene un `code` único (ej. "oficio_impulso_procesal") que se usa como referencia en document_draft.',
    {
      service_type: z.enum(['PQRS','TUTELA']).optional()
                     .describe('Filtrar por tipo de servicio.'),
      jurisdiction: z.string().optional()
                     .describe('Filtrar por jurisdicción (CO, PA, VE, EC).'),
    },
    async ({ service_type, jurisdiction }) => {
      try {
        return ok(await get('/templates', { service_type, jurisdiction }));
      } catch (e) { return err(e); }
    }
  );

  // 2. get_template
  server.tool(
    'get_template',
    'Obtiene la plantilla completa por su code, incluyendo el cuerpo con marcadores {{variable}} y la especificación de variables requeridas.',
    {
      code: z.string().min(3).describe('Código de la plantilla. Ej: "oficio_impulso_procesal".'),
    },
    async ({ code }) => {
      try {
        return ok(await get(`/templates/${encodeURIComponent(code)}`));
      } catch (e) { return err(e); }
    }
  );

  // 3. document_draft
  server.tool(
    'document_draft',
    'Redacta un documento a partir de una plantilla y un caso. El sistema pre-llena automáticamente variables del caso (radicado, accionante, accionado, cliente, abogado, fecha). Las `variables` que pases sobreescriben las automáticas. El documento se guarda en estado "borrador" y se devuelve con su body renderizado y la lista de variables requeridas que faltaron (si las hay). NUNCA firma ni envía — eso requiere acción humana explícita posterior.',
    {
      case_id:       CaseId,
      template_code: z.string().min(3).describe('Código de la plantilla. Ej: "oficio_impulso_procesal".'),
      variables:     z.record(z.string(), z.any()).optional()
                       .describe('Valores concretos para las variables de la plantilla. Sobreescribe los auto-derivados.'),
      title:         z.string().optional()
                       .describe('Título del documento. Por defecto: "<nombre plantilla> — <radicado>".'),
    },
    async ({ case_id, template_code, variables, title }) => {
      try {
        return ok(await post(`/cases/${case_id}/documents/draft`, {
          template_code,
          variables: variables || {},
          title,
        }));
      } catch (e) { return err(e); }
    }
  );

  // 4. list_case_documents
  server.tool(
    'list_case_documents',
    'Lista los documentos asociados a un caso (borradores, documentos en revisión, firmados, enviados, archivados). No devuelve el cuerpo completo — usa get_document para el detalle.',
    { case_id: CaseId },
    async ({ case_id }) => {
      try {
        return ok(await get(`/cases/${case_id}/documents`));
      } catch (e) { return err(e); }
    }
  );

  // 5. get_document
  server.tool(
    'get_document',
    'Obtiene el detalle completo de un documento por su ID, incluyendo body renderizado, variables usadas, estado y metadatos.',
    {
      id: z.number().int().describe('ID numérico del documento.'),
    },
    async ({ id }) => {
      try {
        return ok(await get(`/documents/${id}`));
      } catch (e) { return err(e); }
    }
  );

  // 6. document_export_to_drive
  server.tool(
    'document_export_to_drive',
    'Exporta el documento al Google Drive del expediente como Google Doc en la subcarpeta 06_Borradores. Requiere que el caso tenga una carpeta Drive vinculada (usa drive_link_folder_to_case primero). Deja el documento listo para revisión humana, firma manual (u otra herramienta) y descarga en PDF.',
    {
      id: z.number().int().describe('ID numérico del documento.'),
    },
    async ({ id }) => {
      try {
        return ok(await post(`/documents/${id}/export-to-drive`, {}));
      } catch (e) { return err(e); }
    }
  );

  // 7. document_mark_signed — irreversible en estado, registra sha256
  server.tool(
    'document_mark_signed',
    'Marca un documento como firmado. Genera un registro lógico: hash sha256 del cuerpo, firmante, fecha. NO firma criptográficamente — es un marcador de estado del flujo para auditoría. Requiere aprobación humana explícita: sólo ejecútalo si el abogado responsable ha confirmado que el documento físico/digital ya está firmado.',
    {
      id:         z.number().int().describe('ID numérico del documento.'),
      signed_by:  z.string().optional()
                    .describe('Nombre del firmante. Default: el usuario autenticado.'),
      signed_at:  z.string().optional()
                    .describe('Fecha ISO de firma. Default: ahora.'),
    },
    async ({ id, signed_by, signed_at }) => {
      try {
        return ok(await post(`/documents/${id}/mark-signed`, { signed_by, signed_at }));
      } catch (e) { return err(e); }
    }
  );
}
