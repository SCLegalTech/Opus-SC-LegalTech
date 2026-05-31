/**
 * tools/whatsapp.js — Herramientas WhatsApp Business
 * Opus SC LegalTech MCP Server
 *
 * Herramientas (7):
 *   whatsapp_list_conversations    — Lista hilos de WhatsApp (filtros).
 *   whatsapp_get_conversation      — Detalle de un hilo + ventana 24h.
 *   whatsapp_list_messages         — Mensajes de un hilo (sin enviar nada).
 *   whatsapp_list_templates        — Catálogo de plantillas HSM disponibles.
 *   whatsapp_link_to_case          — Vincula un hilo a un caso del expediente.
 *   whatsapp_send                  — Envía texto libre (SOLO dentro de
 *                                    ventana 24h, dry_run=true por defecto).
 *   whatsapp_send_template         — Envía plantilla HSM aprobada
 *                                    (única forma fuera de ventana 24h,
 *                                    dry_run=true por defecto).
 *
 * Política de seguridad:
 *   - whatsapp_send y whatsapp_send_template son acciones IRREVERSIBLES
 *     (salida hacia terceros). dry_run=true por defecto: devuelven preview
 *     sin enviar. Sólo con dry_run=false (aprobación humana explícita) sale.
 *   - El agente Phi en WhatsApp opera como auxiliar administrativo: puede
 *     dar contexto jurídico general (qué es una tutela, qué significa el
 *     término X), pero la aplicación concreta al caso del cliente la deja
 *     siempre al profesional jurídico.
 *   - Las tools de lectura (list_*, get_*) son autónomas: no requieren
 *     aprobación.
 */

import { z } from 'zod';
import { get, post } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok   = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err  = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const ConversationId = z.union([z.string(), z.number()]).describe(
  'ID numérico de la conversación de WhatsApp (entero).'
);

export function registerWhatsappTools(server) {

  // 1. whatsapp_list_conversations
  server.tool(
    'whatsapp_list_conversations',
    'Lista hilos de WhatsApp. Útil para localizar conversaciones por nombre, teléfono, caso vinculado o estado de asignación. NO envía nada.',
    {
      status:       z.enum(['open', 'snoozed', 'closed', 'all']).default('open')
                      .describe('Estado del hilo. Default "open".'),
      assigned_to:  z.string().optional()
                      .describe('"me" para los míos, "unassigned" para sin asignar, o un userId numérico.'),
      case_id:      z.number().int().optional()
                      .describe('Filtrar por caso vinculado.'),
      has_case:     z.enum(['true', 'false']).optional()
                      .describe('"true" sólo hilos vinculados a caso, "false" sólo sin caso.'),
      search:       z.string().optional()
                      .describe('Texto a buscar en nombre o teléfono del contacto.'),
      limit:        z.number().int().min(1).max(200).default(50),
    },
    async (args) => {
      try {
        return ok(await get('/whatsapp/conversations', args));
      } catch (e) { return err(e); }
    }
  );

  // 2. whatsapp_get_conversation
  server.tool(
    'whatsapp_get_conversation',
    'Devuelve el detalle de un hilo de WhatsApp y un flag `within_24h_window` que indica si todavía se puede enviar texto libre o si toca usar plantilla HSM.',
    { conversation_id: ConversationId },
    async ({ conversation_id }) => {
      try {
        return ok(await get(`/whatsapp/conversations/${conversation_id}`));
      } catch (e) { return err(e); }
    }
  );

  // 3. whatsapp_list_messages
  server.tool(
    'whatsapp_list_messages',
    'Lista los mensajes de un hilo de WhatsApp en orden cronológico ascendente. Úsalo para entender el contexto antes de proponer una respuesta. NO envía nada.',
    {
      conversation_id: ConversationId,
      limit:           z.number().int().min(1).max(200).default(50),
      offset:          z.number().int().min(0).default(0),
    },
    async ({ conversation_id, limit, offset }) => {
      try {
        return ok(await get(`/whatsapp/conversations/${conversation_id}/messages`, { limit, offset }));
      } catch (e) { return err(e); }
    }
  );

  // 4. whatsapp_list_templates
  server.tool(
    'whatsapp_list_templates',
    'Lista las plantillas HSM (mensajes aprobados por Meta) disponibles en el catálogo. Úsalo para sugerir cuál enviar fuera de la ventana de 24h. Solo las que tengan status="approved" son enviables.',
    {},
    async () => {
      try {
        return ok(await get('/whatsapp/templates'));
      } catch (e) { return err(e); }
    }
  );

  // 5. whatsapp_link_to_case
  server.tool(
    'whatsapp_link_to_case',
    'Vincula un hilo de WhatsApp a un caso del expediente. A partir de ese momento los mensajes del hilo se materializan también en `communications` del caso. Acción interna reversible.',
    {
      conversation_id: ConversationId,
      case_id:         z.number().int().describe('ID numérico del caso.'),
    },
    async ({ conversation_id, case_id }) => {
      try {
        return ok(await post(`/whatsapp/conversations/${conversation_id}/link-case`, { case_id }));
      } catch (e) { return err(e); }
    }
  );

  // 6. whatsapp_send — SALIENTE, ventana 24h, dry_run
  server.tool(
    'whatsapp_send',
    'Envía un mensaje de texto libre por WhatsApp. SOLO permitido dentro de la ventana de 24h desde el último mensaje recibido del contacto (Meta Cloud API rule). Por defecto opera en dry_run=true: devuelve el preview SIN enviar. Para enviar de verdad pasa dry_run=false como confirmación humana explícita (Constitución § VI: acción irreversible). Si el hilo está vinculado a un caso, el envío se registra automáticamente en las communications del caso.',
    {
      conversation_id: ConversationId,
      body:            z.string().min(1).max(4096)
                         .describe('Texto del mensaje. Máximo 4096 caracteres.'),
      dry_run:         z.boolean().default(true)
                         .describe('Si true (default), previsualiza sin enviar. Pasa false SÓLO con aprobación humana explícita.'),
    },
    async ({ conversation_id, body, dry_run }) => {
      try {
        if (dry_run) {
          // En modo preview, traemos el contexto del hilo y devolvemos un sumario
          const conv = await get(`/whatsapp/conversations/${conversation_id}`);
          return ok({
            dry_run: true,
            preview: {
              to: conv.conversation?.contact_phone,
              contact_name: conv.conversation?.contact_name,
              body,
              within_24h_window: conv.within_24h_window,
            },
            warning: !conv.within_24h_window
              ? 'FUERA DE VENTANA 24H. El envío real fallará. Usa whatsapp_send_template en su lugar.'
              : 'Dentro de ventana 24h. Para enviar de verdad pasa dry_run=false.',
          });
        }
        return ok(await post(`/whatsapp/conversations/${conversation_id}/send-text`, { body }));
      } catch (e) { return err(e); }
    }
  );

  // 7. whatsapp_send_template — SALIENTE, plantilla HSM, dry_run
  server.tool(
    'whatsapp_send_template',
    'Envía una plantilla HSM aprobada por Meta. Es la ÚNICA forma de escribir fuera de la ventana de 24h o de iniciar conversación a un contacto que no escribió primero. Por defecto opera en dry_run=true: devuelve el preview con las variables sustituidas SIN enviar. Para enviar de verdad pasa dry_run=false (aprobación humana explícita, Constitución § VI). La plantilla debe existir en el catálogo local con status="approved".',
    {
      conversation_id: ConversationId,
      template_name:   z.string().min(1)
                         .describe('Nombre exacto de la plantilla. Usa whatsapp_list_templates para ver disponibles.'),
      language:        z.string().default('es')
                         .describe('Código de idioma de la plantilla. Default "es".'),
      body_variables:  z.array(z.string()).default([])
                         .describe('Valores para los placeholders {{1}}, {{2}}... del cuerpo, en orden.'),
      header_variables: z.array(z.string()).optional()
                         .describe('Variables para el header de la plantilla (si tiene).'),
      dry_run:         z.boolean().default(true)
                         .describe('Si true (default), previsualiza sin enviar.'),
    },
    async ({ conversation_id, template_name, language, body_variables, header_variables, dry_run }) => {
      try {
        if (dry_run) {
          // Preview local: sustituye variables y muestra cómo quedaría
          const tmplList = await get('/whatsapp/templates');
          const tmpl = tmplList.templates.find((t) => t.name === template_name && t.language === language);
          if (!tmpl) {
            return err(new Error(`Plantilla "${template_name}" (${language}) no encontrada en el catálogo.`));
          }
          let rendered = String(tmpl.body || '');
          (body_variables || []).forEach((v, idx) => {
            rendered = rendered.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), String(v));
          });
          const conv = await get(`/whatsapp/conversations/${conversation_id}`);
          return ok({
            dry_run: true,
            preview: {
              to: conv.conversation?.contact_phone,
              contact_name: conv.conversation?.contact_name,
              template_name,
              language,
              status_in_catalog: tmpl.status,
              rendered_body: rendered,
              body_variables,
            },
            warning: tmpl.status !== 'approved'
              ? `La plantilla está en estado "${tmpl.status}". El envío real fallará hasta que esté APPROVED en Meta.`
              : 'Plantilla aprobada. Para enviar de verdad pasa dry_run=false.',
          });
        }
        return ok(await post(`/whatsapp/conversations/${conversation_id}/send-template`, {
          template_name, language, body_variables, header_variables,
        }));
      } catch (e) { return err(e); }
    }
  );
}
