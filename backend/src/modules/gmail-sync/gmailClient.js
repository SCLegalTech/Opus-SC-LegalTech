/**
 * gmailClient.js
 * ─────────────────────────────────────────────────────────────
 * Wrapper fino sobre googleapis para Gmail.
 * Encapsula OAuth2 client construction, refresh de tokens y
 * llamadas a la Gmail API. No conoce la tabla communications
 * ni la lógica de caso — sólo habla con Google.
 */

const { google } = require('googleapis');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function buildOAuthClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error(
      'Gmail-sync: faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI en .env'
    );
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(stateToken) {
  const oauth2 = buildOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: stateToken,
  });
}

async function exchangeCodeForTokens(code) {
  const oauth2 = buildOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Obtenemos el email asociado para identificar la cuenta.
  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
  const { data: userInfo } = await oauth2Api.userinfo.get();

  return {
    email: userInfo.email,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope: tokens.scope,
  };
}

function buildAuthorizedClient(account) {
  const oauth2 = buildOAuthClient();
  oauth2.setCredentials({
    access_token:  account.access_token,
    refresh_token: account.refresh_token,
    expiry_date:   account.token_expiry ? new Date(account.token_expiry).getTime() : undefined,
    scope:         account.scope,
  });
  return oauth2;
}

async function listMessages(account, { query, threadId, maxResults = 20 }) {
  const auth = buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });

  if (threadId) {
    const { data } = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'metadata',
    });
    return (data.messages || []).map((m) => ({ id: m.id, threadId: m.threadId }));
  }

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: query || '',
    maxResults,
  });
  return data.messages || [];
}

async function getMessage(account, messageId) {
  const auth = buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });
  return data;
}

// Extrae cabeceras clave y un cuerpo en texto plano del payload de Gmail.
function parseGmailMessage(raw) {
  const headers = {};
  for (const h of raw.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  const body = extractPlainText(raw.payload) || raw.snippet || '';

  return {
    gmail_message_id: raw.id,
    gmail_thread_id:  raw.threadId,
    from:    headers.from    || null,
    to:      headers.to      || null,
    cc:      headers.cc      || null,
    subject: headers.subject || null,
    date:    headers.date    || null,
    snippet: raw.snippet     || null,
    body,
    label_ids: raw.labelIds || [],
  };
}

function extractPlainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  if (part.parts && part.parts.length) {
    for (const sub of part.parts) {
      const txt = extractPlainText(sub);
      if (txt) return txt;
    }
  }
  return '';
}

module.exports = {
  SCOPES,
  getAuthUrl,
  exchangeCodeForTokens,
  listMessages,
  getMessage,
  parseGmailMessage,
};
