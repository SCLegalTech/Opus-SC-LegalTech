/**
 * whatsappWebhook.controller.js
 * ─────────────────────────────────────────────────────────────
 * Webhook publico de Meta Cloud API. Endpoints:
 *
 *   GET  /api/webhooks/whatsapp   handshake (hub.challenge)
 *   POST /api/webhooks/whatsapp   eventos: messages, statuses
 *
 * Principios criticos:
 *   1. Validacion HMAC del header X-Hub-Signature-256 contra el body RAW
 *      (el route handler usa express.raw para no perder bytes).
 *   2. Idempotencia por wa_message_id: el mismo mensaje puede llegar
 *      varias veces si Meta reintenta tras un timeout.
 *   3. ACK 200 inmediato: Meta reintenta agresivamente si ve >5xx o
 *      >5s. Trabajo pesado (descarga de media, OCR, IA) se hace en
 *      background con setImmediate; el handler responde rapido.
 *   4. Toda comunicacion se materializa tambien en `communications`
 *      cuando hay caso vinculado, para que aparezca en la timeline
 *      del expediente.
 */

const db = require('../config/db');
const wa = require('../services/whatsapp.service');
const onboarding = require('../services/waOnboarding.service');
const mediaAnalysis = require('../services/waMediaAnalysis.service');

// ─────────────────────────────────────────────────────────────
// GET — handshake de verificacion
// ─────────────────────────────────────────────────────────────

const verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const result = wa.verifyHandshake({ mode, token, challenge });
  if (result.ok) {
    return res.status(200).type('text/plain').send(result.challenge);
  }
  return res.status(403).json({ error: 'verify_token invalido' });
};

// ─────────────────────────────────────────────────────────────
// POST — recepcion de eventos
// ─────────────────────────────────────────────────────────────

const receiveWebhook = async (req, res) => {
  // En este endpoint usamos express.raw, asi que req.body es Buffer.
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const signature = req.headers['x-hub-signature-256'];

  if (!wa.verifySignature(rawBody, signature)) {
    console.warn('[wa-webhook] Firma invalida o ausente');
    return res.status(401).json({ error: 'firma invalida' });
  }

  let payload = null;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'payload no es JSON valido' });
  }

  // ACK rapido. Procesamos en background para no bloquear a Meta.
  res.status(200).json({ ok: true });

  setImmediate(() => {
    processWebhookPayload(payload).catch((err) => {
      console.error('[wa-webhook] Error procesando evento:', err);
    });
  });
};

// ─────────────────────────────────────────────────────────────
// Procesamiento del payload
// Estructura de Meta:
//   {
//     object: 'whatsapp_business_account',
//     entry: [{
//       id: '<WABA_ID>',
//       changes: [{
//         field: 'messages',
//         value: {
//           messaging_product: 'whatsapp',
//           metadata: { display_phone_number, phone_number_id },
//           contacts: [{ profile: { name }, wa_id }],
//           messages: [...] | statuses: [...]
//         }
//       }]
//     }]
//   }
// ─────────────────────────────────────────────────────────────

async function processWebhookPayload(payload) {
  if (!payload || payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};

      const phoneNumberRow = await ensurePhoneNumber({
        phone_number_id: value.metadata?.phone_number_id,
        display_phone:   value.metadata?.display_phone_number,
      });
      if (!phoneNumberRow) {
        console.warn('[wa-webhook] phone_number_id desconocido:', value.metadata);
        continue;
      }

      // Mensajes entrantes
      for (const msg of value.messages || []) {
        const contact = (value.contacts || []).find((c) => c.wa_id === msg.from);
        await handleInboundMessage({
          phoneNumberRow,
          contact: contact || { wa_id: msg.from },
          message: msg,
        });
      }

      // Cambios de estado de mensajes salientes (sent/delivered/read/failed)
      for (const status of value.statuses || []) {
        await handleStatusUpdate(status);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ensurePhoneNumber: localiza la fila o registra un placeholder
// ─────────────────────────────────────────────────────────────

async function ensurePhoneNumber({ phone_number_id, display_phone }) {
  if (!phone_number_id) return null;

  const found = await db.query(
    'SELECT * FROM wa_phone_numbers WHERE phone_number_id = $1',
    [phone_number_id]
  );
  if (found.rows.length) return found.rows[0];

  // Si llega un evento de un phone_number_id no registrado, lo creamos
  // como placeholder (jurisdiccion CO por defecto). Esto evita perder
  // mensajes en caso de provisioning incompleto.
  const inserted = await db.query(
    `INSERT INTO wa_phone_numbers (phone_number_id, display_phone, jurisdiction, active)
     VALUES ($1, $2, 'CO', TRUE)
     ON CONFLICT (phone_number_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [phone_number_id, display_phone || 'desconocido']
  );
  return inserted.rows[0];
}

// ─────────────────────────────────────────────────────────────
// handleInboundMessage
// ─────────────────────────────────────────────────────────────

async function handleInboundMessage({ phoneNumberRow, contact, message }) {
  const waMessageId = message.id;
  if (!waMessageId) return;

  // Idempotencia: si ya tenemos el wa_message_id no lo procesamos otra vez.
  const exists = await db.query(
    'SELECT id FROM wa_messages WHERE wa_message_id = $1',
    [waMessageId]
  );
  if (exists.rows.length) return;

  const contactPhone = '+' + String(contact.wa_id || message.from || '').replace(/^\+/, '');
  const contactName  = contact.profile?.name || null;

  // 1. Asegurar conversacion
  const convRes = await db.query(
    `INSERT INTO wa_conversations (phone_number_id, contact_phone, contact_name, last_message_at, last_inbound_at, unread_count)
     VALUES ($1, $2, $3, NOW(), NOW(), 1)
     ON CONFLICT (phone_number_id, contact_phone) DO UPDATE SET
       contact_name     = COALESCE(EXCLUDED.contact_name, wa_conversations.contact_name),
       last_message_at  = NOW(),
       last_inbound_at  = NOW(),
       unread_count     = wa_conversations.unread_count + 1,
       status           = CASE WHEN wa_conversations.status = 'closed' THEN 'open' ELSE wa_conversations.status END,
       updated_at       = NOW()
     RETURNING *`,
    [phoneNumberRow.id, contactPhone, contactName]
  );
  const conversation = convRes.rows[0];

  // 2. Detectar consentimiento si el cuerpo es 'ACEPTO' (cualquier capitalizacion)
  await maybeRecordConsent({ conversation, message });

  // 3. Insertar el mensaje
  const { type, body, mediaMetaId, mediaMime, mediaFilename, mediaCaption } = extractMessageContent(message);

  const inserted = await db.query(
    `INSERT INTO wa_messages
       (conversation_id, wa_message_id, direction, message_type, body,
        media_meta_id, media_mime, media_filename, media_caption, raw_payload)
     VALUES ($1, $2, 'inbound', $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [conversation.id, waMessageId, type, body, mediaMetaId, mediaMime, mediaFilename, mediaCaption, JSON.stringify(message)]
  );
  const messageRow = inserted.rows[0];

  // 4. Materializar como communication si hay caso vinculado
  if (conversation.case_id) {
    const summary = buildCommunicationSummary({ direction: 'inbound', type, body, contactName, contactPhone, mediaCaption });
    const comm = await db.query(
      `INSERT INTO communications (case_id, type, content, metadata)
       VALUES ($1, 'whatsapp', $2, $3::jsonb)
       RETURNING id`,
      [conversation.case_id, summary, JSON.stringify({
        wa_message_id: waMessageId,
        wa_conversation_id: conversation.id,
        from: contactPhone,
        message_type: type,
      })]
    );
    await db.query(
      'UPDATE wa_messages SET related_communication_id = $1 WHERE id = $2',
      [comm.rows[0].id, messageRow.id]
    );
  }

  // 5. Si tiene media, agendar descarga + análisis (no bloquea el ack)
  if (mediaMetaId) {
    setImmediate(() => {
      downloadMediaSafely({ messageId: messageRow.id, mediaMetaId, mediaFilename })
        .then(() => mediaAnalysis.analyzeMessage({ messageId: messageRow.id }))
        .catch((err) => console.error('[wa-webhook] media pipeline failed:', err.message));
    });
  }

  // 6. Marcar como leido en Meta (mejora UX y quality rating)
  if (wa.isConfigured()) {
    setImmediate(() => {
      wa.markAsRead(waMessageId).catch((err) => {
        console.warn('[wa-webhook] markAsRead failed:', err.message);
      });
    });
  }

  // 7. Onboarding automatico (Fase 4): crea prospect, ejecuta triage con
  //    Gemini si hay >= N mensajes inbound y crea tarea para humano.
  //    100% interno, no envia salientes.
  setImmediate(() => {
    // releer la conversacion para tener el consent_status actualizado
    db.query('SELECT * FROM wa_conversations WHERE id = $1', [conversation.id])
      .then(({ rows }) => {
        if (!rows.length) return null;
        return onboarding.handleInbound({
          conversation: rows[0],
          message,
          contactName,
          contactPhone,
        });
      })
      .catch((err) => console.error('[wa-webhook] onboarding failed:', err.message));
  });

  console.log(`[wa-webhook] inbound msg ${waMessageId} type=${type} conv=${conversation.id}`);
}

// ─────────────────────────────────────────────────────────────
// extractMessageContent: aplana los distintos tipos de Meta
// ─────────────────────────────────────────────────────────────

function extractMessageContent(message) {
  const t = message.type;
  if (t === 'text') {
    return { type: 'text', body: message.text?.body || '', mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null };
  }
  if (t === 'image') {
    return { type: 'image', body: null, mediaMetaId: message.image?.id, mediaMime: message.image?.mime_type, mediaFilename: null, mediaCaption: message.image?.caption || null };
  }
  if (t === 'document') {
    return { type: 'document', body: null, mediaMetaId: message.document?.id, mediaMime: message.document?.mime_type, mediaFilename: message.document?.filename, mediaCaption: message.document?.caption || null };
  }
  if (t === 'audio') {
    return { type: 'audio', body: null, mediaMetaId: message.audio?.id, mediaMime: message.audio?.mime_type, mediaFilename: null, mediaCaption: null };
  }
  if (t === 'video') {
    return { type: 'video', body: null, mediaMetaId: message.video?.id, mediaMime: message.video?.mime_type, mediaFilename: null, mediaCaption: message.video?.caption || null };
  }
  if (t === 'location') {
    const loc = message.location || {};
    return {
      type: 'location',
      body: `[ubicacion] lat=${loc.latitude} lon=${loc.longitude}${loc.name ? ' ' + loc.name : ''}${loc.address ? ' ' + loc.address : ''}`,
      mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null,
    };
  }
  if (t === 'contacts') {
    const names = (message.contacts || []).map((c) => c.name?.formatted_name).filter(Boolean).join(', ');
    return { type: 'contacts', body: `[contactos] ${names}`, mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null };
  }
  if (t === 'interactive') {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply;
    return { type: 'interactive', body: reply?.title || reply?.id || '[interactive]', mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null };
  }
  if (t === 'button') {
    return { type: 'interactive', body: message.button?.text || '[boton]', mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null };
  }
  if (t === 'sticker') {
    return { type: 'sticker', body: null, mediaMetaId: message.sticker?.id, mediaMime: message.sticker?.mime_type, mediaFilename: null, mediaCaption: null };
  }
  return { type: 'unsupported', body: `[tipo no soportado: ${t}]`, mediaMetaId: null, mediaMime: null, mediaFilename: null, mediaCaption: null };
}

// ─────────────────────────────────────────────────────────────
// maybeRecordConsent: detecta 'ACEPTO' y registra Habeas Data
// ─────────────────────────────────────────────────────────────

const POLICY_VERSION = process.env.WHATSAPP_POLICY_VERSION || 'habeas-2026.1';

async function maybeRecordConsent({ conversation, message }) {
  const text = (message.text?.body || '').trim().toLowerCase();
  if (!text) return;

  // Aceptacion: "acepto", "si acepto", "autorizo", "estoy de acuerdo"
  const accepts = /^(acepto|si\s+acepto|autorizo|estoy\s+de\s+acuerdo)\b/i.test(text);
  // Revocacion: "revoco", "no acepto", "salir", "stop"
  const revokes = /^(revoco|no\s+acepto|salir|stop|baja)\b/i.test(text);

  if (!accepts && !revokes) return;

  await db.query(
    `INSERT INTO wa_consent_log (contact_phone, conversation_id, policy_version, granted, evidence_text)
     VALUES ($1, $2, $3, $4, $5)`,
    [conversation.contact_phone, conversation.id, POLICY_VERSION, accepts, message.text?.body || null]
  );

  await db.query(
    'UPDATE wa_conversations SET consent_status = $1, updated_at = NOW() WHERE id = $2',
    [accepts ? 'granted' : 'revoked', conversation.id]
  );
}

// ─────────────────────────────────────────────────────────────
// Resumen para communications.content
// ─────────────────────────────────────────────────────────────

function buildCommunicationSummary({ direction, type, body, contactName, contactPhone, mediaCaption }) {
  const who = direction === 'inbound'
    ? `WhatsApp recibido de ${contactName || contactPhone}`
    : `WhatsApp enviado a ${contactName || contactPhone}`;

  if (type === 'text' && body) return `${who}: ${truncate(body, 1000)}`;
  if (type === 'image')        return `${who}: [imagen]${mediaCaption ? ' · ' + truncate(mediaCaption, 200) : ''}`;
  if (type === 'document')     return `${who}: [documento]${mediaCaption ? ' · ' + truncate(mediaCaption, 200) : ''}`;
  if (type === 'audio')        return `${who}: [nota de voz]`;
  if (type === 'video')        return `${who}: [video]${mediaCaption ? ' · ' + truncate(mediaCaption, 200) : ''}`;
  if (type === 'location')     return `${who}: ${body}`;
  if (type === 'template')     return `${who}: [plantilla] ${body || ''}`;
  return `${who}: ${type}`;
}

function truncate(s, n) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n)}...`;
}

// ─────────────────────────────────────────────────────────────
// Descarga diferida de media
// ─────────────────────────────────────────────────────────────

async function downloadMediaSafely({ messageId, mediaMetaId, mediaFilename }) {
  try {
    const { localPath, mime, size, filename } = await wa.downloadMedia(mediaMetaId, mediaFilename);
    await db.query(
      `UPDATE wa_messages
         SET media_url = $1, media_mime = COALESCE(media_mime, $2), media_filename = COALESCE(media_filename, $3), updated_at = NOW()
       WHERE id = $4`,
      [localPath, mime, filename, messageId]
    );
    console.log(`[wa-webhook] media descargada: ${filename} (${size} bytes)`);
  } catch (err) {
    await db.query(
      `UPDATE wa_messages SET failure_reason = $1, updated_at = NOW() WHERE id = $2`,
      [`download_failed: ${err.message}`, messageId]
    );
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// handleStatusUpdate: sent/delivered/read/failed de outbound
// ─────────────────────────────────────────────────────────────

async function handleStatusUpdate(status) {
  const waMessageId = status.id;
  const newStatus   = status.status;     // sent | delivered | read | failed
  if (!waMessageId || !newStatus) return;

  const now = new Date();
  const fields = ['status = $1', 'updated_at = NOW()'];
  const params = [newStatus];

  if (newStatus === 'sent')      { params.push(now); fields.push(`sent_at = $${params.length}`); }
  if (newStatus === 'delivered') { params.push(now); fields.push(`delivered_at = $${params.length}`); }
  if (newStatus === 'read')      { params.push(now); fields.push(`read_at = $${params.length}`); }
  if (newStatus === 'failed') {
    const reason = status.errors?.[0]?.title || status.errors?.[0]?.message || 'failed';
    params.push(reason);
    fields.push(`failure_reason = $${params.length}`);
  }

  params.push(waMessageId);
  await db.query(
    `UPDATE wa_messages SET ${fields.join(', ')} WHERE wa_message_id = $${params.length}`,
    params
  );
}

module.exports = {
  verifyWebhook,
  receiveWebhook,

  // exported for tests / proactive sync
  processWebhookPayload,
};
