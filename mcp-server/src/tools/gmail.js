/**
 * tools/gmail.js — Herramientas Gmail (lectura + ingesta a expediente)
 * Φ SC LegalTech · Opus MCP Server
 *
 * Herramientas (7):
 *   gmail_search_inbox       — Busca correos en la bandeja (query estilo Gmail).
 *   gmail_ingest_to_case     — Importa correos (por query o threadId) como
 *                              communications del caso. Idempotente por
 *                              gmail_message_id.
 *   gmail_list_case_messages — Lista los correos ya ingestados al caso.
 *   gmail_mark_read          — Marca un correo como leído en Gmail.
 *   gmail_archive            — Archiva un correo (quita de INBOX).
 *   gmail_trash              — Mueve un correo a la papelera.
 *   gmail_send               — Envía un correo (con dry_run=true por defecto:
 *                              siempre previsualiza antes de enviar).
 *
 * Principio constitucional (§ VI):
 *   gmail_send es irreversible. Por defecto opera en modo `dry_run`:
 *   devuelve el preview (to, subject, body) sin enviar. Sólo con
 *   dry_run=false (aprobación humana explícita) el correo sale.
 */

import { z } from 'zod';
import { get, post, patch } from '../api-client.js';

const json = (v) => JSON.stringify(v, null, 2);
const ok   = (data) => ({ content: [{ type: 'text', text: json(data) }] });
const err  = (e)    => ({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });

const CaseId = z.string().describe(
  'ID numérico o UUID del caso. Ejemplo: "42" o "SC-2026-0007".'
);

export function registerGmailTools(server) {

  // 1. gmail_search_inbox
  server.tool(
    'gmail_search_inbox',
    'Busca correos en la bandeja de entrada de la cuenta Google conectada. Acepta sintaxis de búsqueda Gmail: "from:", "subject:", "is:unread", "has:attachment", etc. Útil para localizar correos de un cliente antes de ingestarlos a un caso.',
    {
      query:        z.string().optional()
                      .describe('Sintaxis Gmail. Default: "in:inbox". Ej: "from:juan@ejemplo.com is:unread".'),
      max_results:  z.number().int().min(1).max(25).default(10)
                      .describe('Máximo de correos a devolver (tope 25).'),
      page_token:   z.string().optional()
                      .describe('Token de paginación devuelto en la respuesta anterior.'),
    },
    async ({ query, max_results, page_token }) => {
      try {
        return ok(await get('/google/gmail/inbox', {
          query,
          maxResults: max_results,
          pageToken: page_token,
        }));
      } catch (e) { return err(e); }
    }
  );

  // 2. gmail_ingest_to_case
  server.tool(
    'gmail_ingest_to_case',
    'Importa correos a la bitácora del caso como communications type="email". Usa query (sintaxis Gmail) o thread_id para importar un hilo completo. Es idempotente: reingresar el mismo correo no lo duplica. Siempre incluye al menos uno de los dos: query o thread_id.',
    {
      case_id:     CaseId,
      query:       z.string().optional()
                     .describe('Búsqueda Gmail. Ej: "from:cliente@ejemplo.com subject:demanda".'),
      thread_id:   z.string().optional()
                     .describe('ID del hilo Gmail para importar el hilo entero.'),
      max_results: z.number().int().min(1).max(100).default(20)
                     .describe('Máximo de correos a importar en esta ejecución.'),
    },
    async ({ case_id, query, thread_id, max_results }) => {
      if (!query && !thread_id) {
        return err(new Error('Debes proporcionar `query` o `thread_id`.'));
      }
      try {
        return ok(await post(`/cases/${case_id}/google/gmail/sync`, {
          query,
          threadId: thread_id,
          maxResults: max_results,
        }));
      } catch (e) { return err(e); }
    }
  );

  // 3. gmail_list_case_messages
  server.tool(
    'gmail_list_case_messages',
    'Lista los correos ya ingestados como communications del caso. No consulta Gmail en vivo: devuelve lo que está en el expediente.',
    { case_id: CaseId },
    async ({ case_id }) => {
      try {
        return ok(await get(`/cases/${case_id}/google/gmail/messages`));
      } catch (e) { return err(e); }
    }
  );

  // 4. gmail_mark_read
  server.tool(
    'gmail_mark_read',
    'Marca un correo de Gmail como leído (quita la etiqueta UNREAD). Útil tras ingestar o revisar.',
    {
      message_id: z.string().min(5).describe('Gmail message ID (no el thread_id).'),
    },
    async ({ message_id }) => {
      try {
        return ok(await patch(`/google/gmail/messages/${message_id}/read`, {}));
      } catch (e) { return err(e); }
    }
  );

  // 5. gmail_archive
  server.tool(
    'gmail_archive',
    'Archiva un correo en Gmail (quita la etiqueta INBOX). No lo borra. Útil para cerrar correos ya ingestados al expediente.',
    {
      message_id: z.string().min(5).describe('Gmail message ID.'),
    },
    async ({ message_id }) => {
      try {
        return ok(await post(`/google/gmail/messages/${message_id}/archive`, {}));
      } catch (e) { return err(e); }
    }
  );

  // 6. gmail_trash
  server.tool(
    'gmail_trash',
    'Mueve un correo a la papelera de Gmail. Reversible desde Gmail durante 30 días. Úsalo para spam o correos no relevantes al caso.',
    {
      message_id: z.string().min(5).describe('Gmail message ID.'),
    },
    async ({ message_id }) => {
      try {
        return ok(await post(`/google/gmail/messages/${message_id}/trash`, {}));
      } catch (e) { return err(e); }
    }
  );

  // 7. gmail_send — SALIENTE, con aprobación humana
  server.tool(
    'gmail_send',
    'Envía un correo saliente desde la cuenta Google conectada. Por defecto opera en modo dry_run=true: devuelve el preview (destinatario, asunto, cuerpo) SIN enviar. Para enviar de verdad, pasa dry_run=false como confirmación humana explícita (Constitución § VI: acción irreversible). Si pasas case_id, el correo se registra en las communications del caso como saliente. Si pasas document_id, el cuerpo del documento se usa como cuerpo del correo y el documento queda marcado como enviado.',
    {
      to:            z.union([z.string(), z.array(z.string())])
                       .describe('Destinatario(s). Puede ser un string o un array de emails.'),
      subject:       z.string().min(1).describe('Asunto del correo.'),
      body:          z.string().optional()
                       .describe('Cuerpo del correo. Opcional si pasas document_id (se usa el body del documento).'),
      cc:            z.union([z.string(), z.array(z.string())]).optional().describe('Copia.'),
      bcc:           z.union([z.string(), z.array(z.string())]).optional().describe('Copia oculta.'),
      case_id:       z.string().optional()
                       .describe('ID del caso (numérico o UUID). Si se pasa, el envío queda registrado en la bitácora del caso.'),
      document_id:   z.number().int().optional()
                       .describe('ID del documento a enviar como cuerpo. El documento debe estar en estado firmado o revisión.'),
      thread_id:     z.string().optional().describe('ID del hilo Gmail para responder en contexto.'),
      in_reply_to:   z.string().optional().describe('Message-ID al que se responde (encabezado RFC).'),
      dry_run:       z.boolean().default(true)
                       .describe('Si true (default), previsualiza sin enviar. Pasa false SÓLO con aprobación humana explícita.'),
    },
    async ({ to, subject, body, cc, bcc, case_id, document_id, thread_id, in_reply_to, dry_run }) => {
      const path = case_id ? `/cases/${case_id}/google/gmail/send` : `/google/gmail/send`;
      try {
        return ok(await post(path, {
          to, cc, bcc, subject, body,
          thread_id,
          in_reply_to,
          document_id,
          dry_run,
        }));
      } catch (e) { return err(e); }
    }
  );
}
