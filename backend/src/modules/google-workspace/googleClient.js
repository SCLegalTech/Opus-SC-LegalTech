/**
 * googleClient.js
 * ─────────────────────────────────────────────────────────────
 * Wrapper sobre googleapis. Lee credenciales OAuth desde
 * app_config (DB) con fallback a variables de entorno.
 * Cubre Gmail + Drive en una sola autorización.
 */

const { google } = require('googleapis');
const appConfig  = require('./appConfig.repository');

// Scopes agrupados por servicio — se solicitan todos en una sola autorización.
// drive = acceso total a archivos/carpetas que el usuario cree o abra con la
// app. Lo pedimos full (no readonly) porque el agente organiza el expediente:
// crea subcarpetas y mueve archivos dentro de la carpeta raíz del caso.
// Cuentas conectadas previamente con drive.readonly seguirán funcionando
// para lectura; la primera operación de escritura devolverá 403 y el cliente
// recibirá code=DRIVE_SCOPE_REQUIRED para solicitar reconexión.
const SCOPES = {
  base:     ['https://www.googleapis.com/auth/userinfo.email'],
  gmail:    ['https://www.googleapis.com/auth/gmail.modify'],
  drive:    ['https://www.googleapis.com/auth/drive'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],   // crear/editar/borrar eventos
};

const ALL_SCOPES = [...SCOPES.base, ...SCOPES.gmail, ...SCOPES.drive, ...SCOPES.calendar];

async function buildOAuthClient() {
  const { clientId, clientSecret, redirectUri } = await appConfig.getGoogleCredentials();

  if (!clientId || !clientSecret || !redirectUri) {
    const err = new Error(
      'Google Workspace no está configurado. Ve a Ajustes → Integraciones y añade las credenciales OAuth.'
    );
    err.code = 'GOOGLE_NOT_CONFIGURED';
    throw err;
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

async function getAuthUrl(stateToken) {
  const oauth2 = await buildOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       ALL_SCOPES,
    state:       stateToken,
  });
}

async function exchangeCodeForTokens(code) {
  const oauth2 = await buildOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const oauth2Api = google.oauth2({ version: 'v2', auth: oauth2 });
  const { data: userInfo } = await oauth2Api.userinfo.get();

  // Detectar qué scopes fueron realmente concedidos
  const granted = (tokens.scope || '').split(' ');
  const scopesGranted = [];
  if (granted.some(s => s.includes('gmail')))    scopesGranted.push('gmail');
  if (granted.some(s => s.includes('gmail.modify'))) scopesGranted.push('gmail_modify');
  if (granted.some(s => s.includes('drive')))    scopesGranted.push('drive');
  if (granted.some(s => s.includes('calendar'))) scopesGranted.push('calendar');

  return {
    email:          userInfo.email,
    access_token:   tokens.access_token,
    refresh_token:  tokens.refresh_token,
    expiry_date:    tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    scope:          tokens.scope,
    scopes_granted: scopesGranted,
  };
}

async function buildAuthorizedClient(account) {
  const oauth2 = await buildOAuthClient();
  oauth2.setCredentials({
    access_token:  account.access_token,
    refresh_token: account.refresh_token,
    expiry_date:   account.token_expiry
      ? new Date(account.token_expiry).getTime() : undefined,
    scope: account.scope,
  });
  return oauth2;
}

// ── Gmail ──────────────────────────────────────────────────────

async function listGmailMessages(account, { query, threadId, maxResults = 20 }) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });

  if (threadId) {
    const { data } = await gmail.users.threads.get({
      userId: 'me', id: threadId, format: 'metadata',
    });
    return (data.messages || []).map(m => ({ id: m.id, threadId: m.threadId }));
  }

  const limit = Math.min(Number(maxResults) || 20, 500);
  const messages = [];
  let pageToken;

  do {
    const remaining = limit - messages.length;
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: query || '',
      maxResults: Math.min(remaining, 100),
      pageToken,
    });
    messages.push(...(data.messages || []));
    pageToken = data.nextPageToken;
  } while (pageToken && messages.length < limit);

  return messages;
}

async function listGmailInbox(account, { query, maxResults = 10, pageToken }) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const limit = Math.min(Number(maxResults) || 10, 25);

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    q: query || 'in:inbox',
    maxResults: limit,
    pageToken,
  });

  return {
    refs: data.messages || [],
    nextPageToken: data.nextPageToken || null,
    resultSizeEstimate: data.resultSizeEstimate || 0,
  };
}

async function getGmailMessage(account, messageId) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.get({
    userId: 'me', id: messageId, format: 'full',
  });
  return data;
}

async function markGmailMessageRead(account, messageId) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['UNREAD'],
    },
  });
  return data;
}

async function archiveGmailMessage(account, messageId) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      removeLabelIds: ['INBOX'],
    },
  });
  return data;
}

async function trashGmailMessage(account, messageId) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });
  const { data } = await gmail.users.messages.trash({
    userId: 'me',
    id: messageId,
  });
  return data;
}

// ── Drive ──────────────────────────────────────────────────────

async function listDriveFiles(account, { query, pageSize = 20, folderId }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  let q = query || '';
  if (folderId) q = `'${folderId}' in parents${q ? ' and ' + q : ''}`;

  const { data } = await drive.files.list({
    q,
    pageSize,
    fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents)',
  });
  return data.files || [];
}

async function getDriveFile(account, fileId) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });
  const { data } = await drive.files.get({
    fileId,
    fields: 'id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents,description',
  });
  return data;
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';

async function searchDriveByText(account, { text, pageSize = 25, includeFolders = false }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  // fullText matches contents; name contains solo título — unimos con OR.
  const safe = String(text || '').replace(/'/g, "\\'");
  const clauses = [`fullText contains '${safe}'`, `name contains '${safe}'`];
  let q = `(${clauses.join(' or ')}) and trashed = false`;
  if (!includeFolders) q += ` and mimeType != '${FOLDER_MIME}'`;

  const { data } = await drive.files.list({
    q,
    pageSize: Math.min(Number(pageSize) || 25, 100),
    fields: 'files(id,name,mimeType,size,createdTime,modifiedTime,webViewLink,parents)',
    orderBy: 'modifiedTime desc',
  });
  return data.files || [];
}

async function createDriveFolder(account, { name, parentFolderId }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: FOLDER_MIME,
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    fields: 'id,name,mimeType,webViewLink,parents',
  });
  return data;
}

async function findDriveChildFolder(account, { parentFolderId, name }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  const safeName = String(name || '').replace(/'/g, "\\'");
  const q = `'${parentFolderId}' in parents and name = '${safeName}' and mimeType = '${FOLDER_MIME}' and trashed = false`;

  const { data } = await drive.files.list({
    q,
    pageSize: 1,
    fields: 'files(id,name,mimeType,webViewLink,parents)',
  });
  return (data.files && data.files[0]) || null;
}

async function ensureDriveFolder(account, { name, parentFolderId }) {
  const existing = parentFolderId
    ? await findDriveChildFolder(account, { parentFolderId, name })
    : null;
  if (existing) return { folder: existing, created: false };
  const created = await createDriveFolder(account, { name, parentFolderId });
  return { folder: created, created: true };
}

async function sendGmailMessage(account, { to, cc, bcc, subject, body, threadId, inReplyTo, from }) {
  const auth  = await buildAuthorizedClient(account);
  const gmail = google.gmail({ version: 'v1', auth });

  const headers = [];
  if (from)      headers.push(`From: ${from}`);
  if (to)        headers.push(`To: ${to}`);
  if (cc)        headers.push(`Cc: ${cc}`);
  if (bcc)       headers.push(`Bcc: ${bcc}`);
  if (subject)   headers.push(`Subject: ${subject}`);
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    headers.push(`References: ${inReplyTo}`);
  }
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=utf-8');
  headers.push('Content-Transfer-Encoding: 7bit');

  const raw = Buffer
    .from(`${headers.join('\r\n')}\r\n\r\n${body || ''}`)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const { data } = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: threadId || undefined },
  });
  return data;  // { id, threadId, labelIds }
}

async function createDriveDoc(account, { name, content, parentFolderId }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  // Subimos texto plano y dejamos que Drive lo convierta a Google Doc
  // indicando mimeType de destino application/vnd.google-apps.document.
  const { data } = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.document',
      parents: parentFolderId ? [parentFolderId] : undefined,
    },
    media: {
      mimeType: 'text/plain',
      body: content || '',
    },
    fields: 'id,name,mimeType,webViewLink,parents,createdTime,modifiedTime',
  });
  return data;
}

async function moveDriveFile(account, { fileId, toFolderId }) {
  const auth  = await buildAuthorizedClient(account);
  const drive = google.drive({ version: 'v3', auth });

  const current = await drive.files.get({ fileId, fields: 'parents' });
  const prevParents = (current.data.parents || []).join(',');

  const { data } = await drive.files.update({
    fileId,
    addParents: toFolderId,
    removeParents: prevParents || undefined,
    fields: 'id,name,mimeType,webViewLink,parents',
  });
  return data;
}

// ── Parser Gmail ───────────────────────────────────────────────

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
    has_attachments: hasAttachment(raw.payload),
  };
}

function extractPlainText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf8');
  }
  if (part.parts?.length) {
    for (const sub of part.parts) {
      const txt = extractPlainText(sub);
      if (txt) return txt;
    }
  }
  return '';
}

function hasAttachment(part) {
  if (!part) return false;
  if (part.filename && part.body?.attachmentId) return true;
  return Boolean(part.parts?.some(hasAttachment));
}

// ─────────────────────────────────────────────────────────────
// Google Calendar — eventos
// ─────────────────────────────────────────────────────────────

async function createCalendarEvent(account, { calendarId = 'primary', summary, description, start, end, allDay = false, location, reminders }) {
  const auth = await buildAuthorizedClient(account);
  const cal = google.calendar({ version: 'v3', auth });

  const event = {
    summary,
    description: description || undefined,
    location:    location || undefined,
    reminders:   reminders || { useDefault: true },
  };

  if (allDay) {
    event.start = { date: start };                          // YYYY-MM-DD
    event.end   = { date: end || start };
  } else {
    event.start = { dateTime: start, timeZone: 'America/Bogota' };
    event.end   = { dateTime: end || start, timeZone: 'America/Bogota' };
  }

  const { data } = await cal.events.insert({
    calendarId,
    requestBody: event,
  });
  return data;
}

async function updateCalendarEvent(account, eventId, { calendarId = 'primary', summary, description, start, end, allDay = false, location }) {
  const auth = await buildAuthorizedClient(account);
  const cal = google.calendar({ version: 'v3', auth });

  const patch = {};
  if (summary !== undefined)     patch.summary = summary;
  if (description !== undefined) patch.description = description;
  if (location !== undefined)    patch.location = location;
  if (start !== undefined) {
    patch.start = allDay ? { date: start } : { dateTime: start, timeZone: 'America/Bogota' };
    patch.end   = allDay ? { date: end || start } : { dateTime: end || start, timeZone: 'America/Bogota' };
  }

  const { data } = await cal.events.patch({
    calendarId,
    eventId,
    requestBody: patch,
  });
  return data;
}

async function deleteCalendarEvent(account, eventId, { calendarId = 'primary' } = {}) {
  const auth = await buildAuthorizedClient(account);
  const cal = google.calendar({ version: 'v3', auth });
  try {
    await cal.events.delete({ calendarId, eventId });
    return true;
  } catch (err) {
    if (err?.code === 404 || err?.response?.status === 404) return true;     // ya no existe → idempotente
    throw err;
  }
}

async function listCalendars(account) {
  const auth = await buildAuthorizedClient(account);
  const cal = google.calendar({ version: 'v3', auth });
  const { data } = await cal.calendarList.list();
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: !!c.primary,
    accessRole: c.accessRole,
  }));
}

module.exports = {
  ALL_SCOPES,
  SCOPES,
  getAuthUrl,
  exchangeCodeForTokens,
  buildAuthorizedClient,
  listGmailMessages,
  listGmailInbox,
  getGmailMessage,
  markGmailMessageRead,
  archiveGmailMessage,
  trashGmailMessage,
  parseGmailMessage,
  listDriveFiles,
  getDriveFile,
  searchDriveByText,
  createDriveFolder,
  findDriveChildFolder,
  ensureDriveFolder,
  moveDriveFile,
  sendGmailMessage,
  createDriveDoc,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listCalendars,
  FOLDER_MIME,
};
