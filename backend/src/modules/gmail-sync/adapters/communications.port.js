/**
 * communications.port.js
 * ─────────────────────────────────────────────────────────────
 * Único punto de contacto del módulo gmail-sync con la tabla
 * `communications` del core. Si mañana se extrae como microservicio,
 * este archivo es el que se reemplaza por una llamada HTTP al core.
 *
 * Regla de oro: ningún otro archivo del módulo importa `config/db`.
 */

const db = require('../../../config/db');

/**
 * Busca una communication ya persistida por gmail_message_id,
 * limitado al caso indicado. Usado para idempotencia.
 */
async function findByGmailMessageId(caseId, gmailMessageId) {
  const { rows } = await db.query(
    `SELECT id, case_id, type, content, metadata, created_at
       FROM communications
      WHERE case_id = $1
        AND metadata->>'gmail_message_id' = $2
      LIMIT 1`,
    [caseId, gmailMessageId]
  );
  return rows[0] || null;
}

/**
 * Persiste un correo de Gmail como communication type='email'.
 * @param {{ caseId:number, userId:number, parsed:object }} args
 * @returns {Promise<{id:number, created:boolean}>}
 */
async function persistEmailAsCommunication({ caseId, userId, parsed }) {
  const existing = await findByGmailMessageId(caseId, parsed.gmail_message_id);
  if (existing) return { id: existing.id, created: false };

  const content = [
    parsed.subject ? `Asunto: ${parsed.subject}` : null,
    parsed.from    ? `De: ${parsed.from}`         : null,
    parsed.to      ? `Para: ${parsed.to}`         : null,
    parsed.date    ? `Fecha: ${parsed.date}`      : null,
    '',
    parsed.body || parsed.snippet || '',
  ].filter((l) => l !== null).join('\n');

  const metadata = {
    source:           'gmail',
    gmail_message_id: parsed.gmail_message_id,
    gmail_thread_id:  parsed.gmail_thread_id,
    from:             parsed.from,
    to:               parsed.to,
    cc:               parsed.cc,
    subject:          parsed.subject,
    date:             parsed.date,
    snippet:          parsed.snippet,
    label_ids:        parsed.label_ids,
  };

  const { rows } = await db.query(
    `INSERT INTO communications (case_id, type, content, metadata, created_by)
          VALUES ($1, 'email', $2, $3::jsonb, $4)
       RETURNING id`,
    [caseId, content, JSON.stringify(metadata), userId]
  );

  return { id: rows[0].id, created: true };
}

/**
 * Lista las communications de tipo email importadas desde Gmail
 * para un caso.
 */
async function listGmailCommunicationsByCase(caseId) {
  const { rows } = await db.query(
    `SELECT id, case_id, type, content, metadata, created_by, created_at
       FROM communications
      WHERE case_id = $1
        AND type = 'email'
        AND metadata->>'source' = 'gmail'
      ORDER BY created_at DESC`,
    [caseId]
  );
  return rows;
}

module.exports = {
  findByGmailMessageId,
  persistEmailAsCommunication,
  listGmailCommunicationsByCase,
};
