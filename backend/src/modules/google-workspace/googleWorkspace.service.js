/**
 * googleWorkspace.service.js
 * ─────────────────────────────────────────────────────────────
 * Orquesta OAuth, sincronización de Gmail y Drive.
 * Es el reemplazo de gmailSync.service.js con soporte unificado.
 */

const googleClient = require('./googleClient');
const accounts     = require('./googleAccounts.repository');
const commsPort    = require('./adapters/communications.port');
const db           = require('../../config/db');

// Subcarpetas canónicas del expediente. Orden = prefijo numérico.
// Cualquier cambio aquí debe reflejarse en docs/onboarding.
const EXPEDIENTE_SUBFOLDERS = [
  '00_Poderes',
  '01_Contratos',
  '02_Demanda',
  '03_Actuaciones',
  '04_Pruebas',
  '05_Comunicaciones',
  '06_Borradores',
  '99_Sin_clasificar',
];

// Mapeo categoría (case_drive_files.category) → subcarpeta destino.
const CATEGORY_TO_SUBFOLDER = {
  sin_clasificar: '99_Sin_clasificar',
  ingreso:        '01_Contratos',
  cliente:        '00_Poderes',
  actuacion:      '03_Actuaciones',
  prueba:         '04_Pruebas',
  comunicacion:   '05_Comunicaciones',
  borrador:       '06_Borradores',
  firmado:        '02_Demanda',
};

class GoogleNotConnectedError extends Error {
  constructor() {
    super('El usuario no tiene una cuenta de Google conectada');
    this.code = 'GOOGLE_NOT_CONNECTED';
  }
}

class GoogleNotConfiguredError extends Error {
  constructor() {
    super('Google Workspace no está configurado. Ve a Ajustes → Integraciones.');
    this.code = 'GOOGLE_NOT_CONFIGURED';
  }
}

async function requireAccount(userId) {
  const acc = await accounts.getAccountByUserId(userId);
  if (!acc || !acc.refresh_token) throw new GoogleNotConnectedError();
  return acc;
}

// ── Estado ────────────────────────────────────────────────────

async function getStatus(userId) {
  const acc = await accounts.getAccountByUserId(userId);
  if (!acc) return { connected: false };
  const granted = acc.scopes_granted || [];
  const scopeText = acc.scope || '';
  const gmailModify = granted.includes('gmail_modify') || scopeText.includes('gmail.modify');
  return {
    connected:      true,
    email:          acc.email,
    scopes_granted: granted,
    gmail_enabled:  granted.includes('gmail'),
    gmail_modify_enabled: gmailModify,
    drive_enabled:  granted.includes('drive'),
    connected_at:   acc.created_at,
  };
}

async function disconnect(userId) {
  await accounts.deleteAccountByUserId(userId);
}

// ── OAuth ─────────────────────────────────────────────────────

async function completeOAuth({ userId, code }) {
  try {
    const tokens = await googleClient.exchangeCodeForTokens(code);
    return accounts.upsertAccount({
      userId,
      email:          tokens.email,
      access_token:   tokens.access_token,
      refresh_token:  tokens.refresh_token,
      expiry_date:    tokens.expiry_date,
      scope:          tokens.scope,
      scopes_granted: tokens.scopes_granted,
    });
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONFIGURED') throw new GoogleNotConfiguredError();
    throw err;
  }
}

// ── Gmail sync ────────────────────────────────────────────────

async function syncGmailToCase({ userId, caseId, query, threadId, maxResults = 20 }) {
  const account = await requireAccount(userId);

  const refs = await googleClient.listGmailMessages(account, { query, threadId, maxResults });
  if (!refs.length) return { imported: 0, skipped: 0, total: 0, messages: [] };

  let imported = 0, skipped = 0;
  const results = [];

  for (const ref of refs) {
    const raw    = await googleClient.getGmailMessage(account, ref.id);
    const parsed = googleClient.parseGmailMessage(raw);
    const result = await commsPort.persistEmailAsCommunication({ caseId, userId, parsed });

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

async function listCaseGmailMessages(caseId) {
  return commsPort.listGmailCommunicationsByCase(caseId);
}

// ── Drive ─────────────────────────────────────────────────────

async function listGmailInbox({ userId, query, maxResults = 10, pageToken }) {
  const account = await requireAccount(userId);
  const { refs, nextPageToken, resultSizeEstimate } = await googleClient.listGmailInbox(account, {
    query,
    maxResults,
    pageToken,
  });

  const messages = [];
  for (const ref of refs) {
    const raw = await googleClient.getGmailMessage(account, ref.id);
    const parsed = googleClient.parseGmailMessage(raw);
    messages.push({
      gmail_message_id: parsed.gmail_message_id,
      thread_id: parsed.gmail_thread_id,
      subject: parsed.subject,
      from: parsed.from,
      to: parsed.to,
      date: parsed.date,
      snippet: parsed.snippet,
      unread: (parsed.label_ids || []).includes('UNREAD'),
      has_attachments: parsed.has_attachments,
      labels: parsed.label_ids || [],
    });
  }

  return { messages, nextPageToken, resultSizeEstimate };
}

async function markGmailMessageRead({ userId, messageId }) {
  const account = await requireAccount(userId);
  const result = await googleClient.markGmailMessageRead(account, messageId);
  return {
    ok: true,
    gmail_message_id: result.id || messageId,
    thread_id: result.threadId,
    labels: result.labelIds || [],
  };
}

async function archiveGmailMessage({ userId, messageId }) {
  const account = await requireAccount(userId);
  const result = await googleClient.archiveGmailMessage(account, messageId);
  return {
    ok: true,
    gmail_message_id: result.id || messageId,
    thread_id: result.threadId,
    labels: result.labelIds || [],
  };
}

async function trashGmailMessage({ userId, messageId }) {
  const account = await requireAccount(userId);
  const result = await googleClient.trashGmailMessage(account, messageId);
  return {
    ok: true,
    gmail_message_id: result.id || messageId,
    thread_id: result.threadId,
    labels: result.labelIds || [],
  };
}

async function listDriveFiles({ userId, query, folderId, pageSize = 20 }) {
  const account = await requireAccount(userId);
  return googleClient.listDriveFiles(account, { query, folderId, pageSize });
}

async function getDriveFile({ userId, fileId }) {
  const account = await requireAccount(userId);
  return googleClient.getDriveFile(account, fileId);
}

// ── Búsqueda orientada al cliente/caso ───────────────────────
// Construye términos de búsqueda a partir del caso: número de caso,
// título, nombre completo del cliente, documento. Ejecuta una búsqueda
// por cada término y devuelve resultados deduplicados por fileId,
// marcando cuáles ya están vinculados al caso (case_drive_files).
async function searchDriveForCase({ userId, caseId, extraQuery, maxPerTerm = 10 }) {
  const account = await requireAccount(userId);

  const { rows } = await db.query(
    `SELECT c.id, c.case_number, c.title,
            cl.full_name   AS client_name,
            cl.document_number AS client_document
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = $1
      LIMIT 1`,
    [caseId]
  );
  const caseRow = rows[0];
  if (!caseRow) {
    const e = new Error('Caso no encontrado');
    e.code = 'CASE_NOT_FOUND';
    throw e;
  }

  const terms = [];
  if (caseRow.case_number)     terms.push(caseRow.case_number);
  if (caseRow.client_name)     terms.push(caseRow.client_name);
  if (caseRow.client_document) terms.push(caseRow.client_document);
  if (extraQuery)              terms.push(extraQuery);

  const byId = new Map();
  for (const t of terms) {
    if (!t || String(t).trim().length < 3) continue;
    const files = await googleClient.searchDriveByText(account, {
      text: String(t).trim(),
      pageSize: maxPerTerm,
    });
    for (const f of files) {
      const prev = byId.get(f.id) || { ...f, matched_terms: [] };
      if (!prev.matched_terms.includes(t)) prev.matched_terms.push(t);
      byId.set(f.id, prev);
    }
  }

  const fileIds = [...byId.keys()];
  if (fileIds.length) {
    const { rows: linked } = await db.query(
      `SELECT drive_file_id, category
         FROM case_drive_files
        WHERE case_id = $1 AND drive_file_id = ANY($2::text[])`,
      [caseId, fileIds]
    );
    const linkedMap = new Map(linked.map(r => [r.drive_file_id, r.category]));
    for (const [id, f] of byId) {
      f.already_linked = linkedMap.has(id);
      f.linked_category = linkedMap.get(id) || null;
    }
  }

  return {
    case: {
      id: caseRow.id,
      case_number: caseRow.case_number,
      title: caseRow.title,
      client_name: caseRow.client_name,
      client_document: caseRow.client_document,
    },
    terms_used: terms,
    files: [...byId.values()],
  };
}

// ── Vincular carpeta Drive existente como raíz del expediente ─
async function linkDriveFolderToCase({ userId, caseId, folderId }) {
  const account = await requireAccount(userId);

  const file = await googleClient.getDriveFile(account, folderId);
  if (file.mimeType !== googleClient.FOLDER_MIME) {
    const e = new Error('El fileId proporcionado no es una carpeta de Drive');
    e.code = 'DRIVE_NOT_A_FOLDER';
    throw e;
  }

  const { rows } = await db.query(
    `UPDATE cases
        SET drive_folder_id = $2,
            drive_folder_url = $3,
            updated_at = NOW()
      WHERE id = $1
      RETURNING id, case_number, drive_folder_id, drive_folder_url`,
    [caseId, file.id, file.webViewLink || null]
  );
  if (!rows[0]) {
    const e = new Error('Caso no encontrado');
    e.code = 'CASE_NOT_FOUND';
    throw e;
  }
  return { case: rows[0], folder: file };
}

// ── Organizar expediente ─────────────────────────────────────
// 1. Asegura carpeta raíz del caso (usa la vinculada; si no hay,
//    la crea bajo parentFolderId o en "Mi unidad" root).
// 2. Crea las subcarpetas canónicas si no existen.
// 3. Si vienen `files` [{ drive_file_id, category }], los vincula al caso
//    y — si dry_run = false — los mueve a su subcarpeta destino.
// Devuelve el plan y las operaciones ejecutadas.
async function organizeExpediente({ userId, caseId, parentFolderId, files = [], dryRun = false }) {
  const account = await requireAccount(userId);

  const { rows: caseRows } = await db.query(
    `SELECT id, case_number, title, drive_folder_id, drive_folder_url
       FROM cases
      WHERE id = $1
      LIMIT 1`,
    [caseId]
  );
  const caseRow = caseRows[0];
  if (!caseRow) {
    const e = new Error('Caso no encontrado');
    e.code = 'CASE_NOT_FOUND';
    throw e;
  }

  const plan = {
    case: { id: caseRow.id, case_number: caseRow.case_number, title: caseRow.title },
    dry_run: Boolean(dryRun),
    root_folder: null,
    subfolders: [],
    moves: [],
    links: [],
  };

  // Nombre de la carpeta raíz.
  const rootName = `${caseRow.case_number} — ${caseRow.title}`.slice(0, 150);

  let rootFolder;
  if (caseRow.drive_folder_id) {
    rootFolder = await googleClient.getDriveFile(account, caseRow.drive_folder_id);
  } else if (dryRun) {
    rootFolder = { id: null, name: rootName, webViewLink: null, _would_create: true, parent: parentFolderId || 'root' };
  } else {
    const created = await googleClient.createDriveFolder(account, { name: rootName, parentFolderId });
    rootFolder = created;
    await db.query(
      `UPDATE cases SET drive_folder_id = $2, drive_folder_url = $3, updated_at = NOW()
        WHERE id = $1`,
      [caseId, created.id, created.webViewLink || null]
    );
  }
  plan.root_folder = rootFolder;

  // Subcarpetas canónicas.
  const subMap = {};
  for (const name of EXPEDIENTE_SUBFOLDERS) {
    if (dryRun || !rootFolder.id) {
      plan.subfolders.push({ name, id: null, _would_ensure: true });
      continue;
    }
    const { folder, created } = await googleClient.ensureDriveFolder(account, {
      name,
      parentFolderId: rootFolder.id,
    });
    subMap[name] = folder;
    plan.subfolders.push({ name, id: folder.id, webViewLink: folder.webViewLink, created });
  }

  // Mover y vincular archivos.
  for (const item of files) {
    const driveFileId = item.drive_file_id || item.fileId;
    const category = item.category || 'sin_clasificar';
    if (!driveFileId) continue;

    const destName = CATEGORY_TO_SUBFOLDER[category] || '99_Sin_clasificar';

    const op = {
      drive_file_id: driveFileId,
      category,
      target_subfolder: destName,
      moved: false,
      linked: false,
    };

    if (!dryRun && rootFolder.id) {
      const dest = subMap[destName];
      if (dest) {
        try {
          const moved = await googleClient.moveDriveFile(account, {
            fileId: driveFileId,
            toFolderId: dest.id,
          });
          op.moved = true;
          op.file_name = moved.name;
          op.web_view_link = moved.webViewLink;
        } catch (err) {
          op.move_error = err.message;
        }
      }

      // Link en case_drive_files — vía repo para mantener consistencia.
      const caseDriveFiles = require('../../repositories/caseDriveFiles.repository');
      try {
        const driveFile = await googleClient.getDriveFile(account, driveFileId);
        const link = await caseDriveFiles.upsertLink({
          caseId,
          userId,
          driveFileId: driveFile.id,
          name: driveFile.name,
          mimeType: driveFile.mimeType,
          webViewLink: driveFile.webViewLink,
          size: driveFile.size || null,
          modifiedTime: driveFile.modifiedTime || null,
          category,
          metadata: {
            source: 'drive',
            drive_file_id: driveFile.id,
            organized_at: new Date().toISOString(),
            target_subfolder: destName,
          },
        });
        op.linked = true;
        op.link_id = link.file?.id;
      } catch (err) {
        op.link_error = err.message;
      }
    }

    plan.moves.push(op);
  }

  if (!dryRun && rootFolder.id) {
    await db.query(
      `UPDATE cases SET drive_folder_synced_at = NOW() WHERE id = $1`,
      [caseId]
    );
  }

  return plan;
}

// ── Envío saliente de Gmail ──────────────────────────────────
// dry_run=true devuelve una vista previa sin tocar Gmail.
// Cuando se envía, registra el correo como communication saliente
// en la bitácora del caso y, si hay documentId, marca el documento
// como 'enviado' con auditoría.
async function sendGmail({
  userId, caseId, documentId,
  to, cc, bcc, subject, body,
  threadId, inReplyTo,
  dryRun = true,
}) {
  if (!to || !subject || !body) {
    const e = new Error('to, subject y body son obligatorios');
    e.code = 'GMAIL_SEND_MISSING_FIELDS';
    throw e;
  }

  const account = await requireAccount(userId);

  const preview = {
    from: account.email,
    to, cc: cc || null, bcc: bcc || null,
    subject,
    body_preview: String(body).slice(0, 500),
    body_length: String(body).length,
    thread_id: threadId || null,
    in_reply_to: inReplyTo || null,
    case_id: caseId || null,
    document_id: documentId || null,
    dry_run: Boolean(dryRun),
  };

  if (dryRun) {
    return { sent: false, preview };
  }

  const sent = await googleClient.sendGmailMessage(account, {
    from: account.email,
    to, cc, bcc, subject, body,
    threadId, inReplyTo,
  });

  // Registrar como communication saliente en el caso si aplica.
  if (caseId) {
    await db.query(
      `INSERT INTO communications (case_id, type, content, user_id, metadata, created_at)
       VALUES ($1, 'email', $2, $3, $4::jsonb, NOW())`,
      [
        caseId,
        `[SALIENTE] ${subject}\n\n${body}`,
        userId,
        JSON.stringify({
          direction: 'outbound',
          gmail_message_id: sent.id,
          gmail_thread_id:  sent.threadId,
          from: account.email,
          to, cc: cc || null, bcc: bcc || null,
          subject,
          sent_via: 'agent',
          document_id: documentId || null,
        }),
      ]
    );
  }

  // Si el envío corresponde a un documento, marcarlo enviado.
  if (documentId) {
    await db.query(
      `UPDATE documents
          SET status = 'enviado',
              sent_at = NOW(),
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
        WHERE id = $1`,
      [
        documentId,
        JSON.stringify({
          sent: {
            gmail_message_id: sent.id,
            gmail_thread_id:  sent.threadId,
            to, cc: cc || null, subject,
            sent_at: new Date().toISOString(),
            sent_by_user_id: userId,
          },
        }),
      ]
    );
  }

  return {
    sent: true,
    gmail_message_id: sent.id,
    gmail_thread_id:  sent.threadId,
    preview,
  };
}

// ── Export de documento a Drive ──────────────────────────────
// Sube el body del documento como Google Doc dentro de la carpeta
// del expediente (o de la subcarpeta 06_Borradores si no se indica).
// Vincula el archivo en case_drive_files y actualiza documents.drive_file_id.
async function exportDocumentToDrive({ userId, documentId, subfolderName = '06_Borradores', filename }) {
  const account = await requireAccount(userId);

  const { rows: docRows } = await db.query(
    `SELECT d.*, c.case_number, c.title AS case_title, c.drive_folder_id
       FROM documents d
       LEFT JOIN cases c ON c.id = d.case_id
      WHERE d.id = $1
      LIMIT 1`,
    [documentId]
  );
  const doc = docRows[0];
  if (!doc) {
    const e = new Error('Documento no encontrado');
    e.code = 'DOC_NOT_FOUND';
    throw e;
  }

  if (!doc.case_id || !doc.drive_folder_id) {
    const e = new Error('El caso no tiene carpeta raíz en Drive. Ejecuta drive_organize_expediente primero.');
    e.code = 'CASE_DRIVE_NOT_ORGANIZED';
    throw e;
  }

  // Resolver subcarpeta destino (o usar la raíz si subfolderName es null).
  let parentFolderId = doc.drive_folder_id;
  if (subfolderName) {
    const { folder } = await googleClient.ensureDriveFolder(account, {
      name: subfolderName,
      parentFolderId: doc.drive_folder_id,
    });
    parentFolderId = folder.id;
  }

  const docName = (filename && String(filename).trim()) ||
    `${doc.title || doc.name || 'Documento'} — ${doc.case_number || doc.case_id}`.slice(0, 150);

  const created = await googleClient.createDriveDoc(account, {
    name: docName,
    content: doc.body || '',
    parentFolderId,
  });

  // Vínculo en case_drive_files (categoría según estado del doc).
  const category = doc.status === 'firmado' ? 'firmado' : 'borrador';
  const caseDriveFiles = require('../../repositories/caseDriveFiles.repository');
  await caseDriveFiles.upsertLink({
    caseId: doc.case_id,
    userId,
    driveFileId: created.id,
    name: created.name,
    mimeType: created.mimeType,
    webViewLink: created.webViewLink,
    size: null,
    modifiedTime: created.modifiedTime || null,
    category,
    metadata: {
      source: 'document_export',
      document_id: documentId,
      exported_at: new Date().toISOString(),
    },
  });

  // Actualizar el documento con el drive_file_id y timestamps.
  await db.query(
    `UPDATE documents
        SET drive_file_id = $2,
            exported_at = NOW(),
            updated_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
      WHERE id = $1`,
    [
      documentId,
      created.id,
      JSON.stringify({
        export: {
          drive_file_id:  created.id,
          drive_file_url: created.webViewLink,
          parent_folder_id: parentFolderId,
          subfolder: subfolderName || null,
          exported_at: new Date().toISOString(),
          exported_by_user_id: userId,
        },
      }),
    ]
  );

  return {
    document_id: documentId,
    drive_file: created,
    parent_folder_id: parentFolderId,
  };
}

module.exports = {
  GoogleNotConnectedError,
  GoogleNotConfiguredError,
  getStatus,
  disconnect,
  completeOAuth,
  syncGmailToCase,
  listCaseGmailMessages,
  listGmailInbox,
  markGmailMessageRead,
  archiveGmailMessage,
  trashGmailMessage,
  listDriveFiles,
  getDriveFile,
  searchDriveForCase,
  linkDriveFolderToCase,
  organizeExpediente,
  sendGmail,
  exportDocumentToDrive,
  EXPEDIENTE_SUBFOLDERS,
  CATEGORY_TO_SUBFOLDER,
};
