/**
 * gmailSync.service.js
 * ─────────────────────────────────────────────────────────────
 * Orquesta el flujo: autorización → fetch → parse → persist vía
 * el puerto communications. No conoce detalles de Express ni SQL.
 */

const gmailClient = require('./gmailClient');
const accounts    = require('./gmailAccounts.repository');
const commsPort   = require('./adapters/communications.port');

class GmailNotConnectedError extends Error {
  constructor() {
    super('El usuario no tiene una cuenta de Gmail conectada');
    this.code = 'GMAIL_NOT_CONNECTED';
  }
}

async function requireAccount(userId) {
  const acc = await accounts.getAccountByUserId(userId);
  if (!acc || !acc.refresh_token) throw new GmailNotConnectedError();
  return acc;
}

async function getStatus(userId) {
  const acc = await accounts.getAccountByUserId(userId);
  if (!acc) return { connected: false };
  return {
    connected: true,
    email:     acc.email,
    connected_at: acc.created_at,
  };
}

async function disconnect(userId) {
  await accounts.deleteAccountByUserId(userId);
}

async function completeOAuth({ userId, code }) {
  const tokens = await gmailClient.exchangeCodeForTokens(code);
  return accounts.upsertAccount({
    userId,
    email:         tokens.email,
    access_token:  tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date:   tokens.expiry_date,
    scope:         tokens.scope,
  });
}

/**
 * Importa correos asociándolos a un caso como communications.
 * @param {{ userId:number, caseId:number, query?:string, threadId?:string, maxResults?:number }} args
 */
async function syncToCase({ userId, caseId, query, threadId, maxResults = 20 }) {
  const account = await requireAccount(userId);

  const refs = await gmailClient.listMessages(account, { query, threadId, maxResults });
  if (!refs.length) {
    return { imported: 0, skipped: 0, total: 0, messages: [] };
  }

  let imported = 0;
  let skipped  = 0;
  const results = [];

  for (const ref of refs) {
    const raw    = await gmailClient.getMessage(account, ref.id);
    const parsed = gmailClient.parseGmailMessage(raw);
    const result = await commsPort.persistEmailAsCommunication({
      caseId,
      userId,
      parsed,
    });

    if (result.created) imported += 1;
    else                skipped  += 1;

    results.push({
      gmail_message_id: parsed.gmail_message_id,
      subject:          parsed.subject,
      from:             parsed.from,
      date:             parsed.date,
      communication_id: result.id,
      created:          result.created,
    });
  }

  return { imported, skipped, total: refs.length, messages: results };
}

async function listCaseMessages(caseId) {
  return commsPort.listGmailCommunicationsByCase(caseId);
}

module.exports = {
  GmailNotConnectedError,
  getStatus,
  disconnect,
  completeOAuth,
  syncToCase,
  listCaseMessages,
};
