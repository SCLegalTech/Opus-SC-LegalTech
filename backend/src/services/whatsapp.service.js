/**
 * whatsapp.service.js
 * ─────────────────────────────────────────────────────────────
 * Cliente nativo para Meta Cloud API (WhatsApp Business).
 *
 * Cubre:
 *   - Verificacion de firma del webhook (X-Hub-Signature-256, HMAC-SHA256).
 *   - Verificacion del handshake del webhook (hub.challenge).
 *   - Envio de mensajes: texto libre (ventana 24h) y plantillas HSM.
 *   - Envio de medios (imagen, documento) por URL o media_id.
 *   - Descarga de medios entrantes (la URL de Meta expira en ~5 dias).
 *   - Marcar mensajes como leidos.
 *   - Consulta del estado del numero (quality_rating).
 *
 * Convenciones de Meta Cloud API (Graph API v20.0):
 *   - Base: https://graph.facebook.com/v20.0
 *   - Auth: Bearer ACCESS_TOKEN
 *   - Numero propio: PHONE_NUMBER_ID (no el numero humano)
 *   - Formato del destinatario: E.164 sin + (ej. 573001234567)
 *   - Idempotencia: el wa_message_id en el response es la clave.
 *
 * Politica de seguridad:
 *   - El servicio no decide. Es plomeria pura: redes y persistencia.
 *   - El controller decide si esta dentro de la ventana de 24h.
 *   - El agente Phi propone via propose_whatsapp_send (mcp tool).
 *   - sendText fuera de ventana 24h -> error 'OUTSIDE_24H_WINDOW'.
 */

const crypto = require('node:crypto');
const fs     = require('node:fs/promises');
const path   = require('node:path');

const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';
const GRAPH_BASE    = `https://graph.facebook.com/${GRAPH_VERSION}`;

// Carpeta local para medios descargados de inbound. En produccion deberia
// ir a Drive o a un bucket cifrado; por ahora local con path sanitizado.
const MEDIA_ROOT = process.env.WHATSAPP_MEDIA_ROOT
  || path.join(__dirname, '..', '..', 'storage', 'whatsapp');

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

function getConfig() {
  return {
    accessToken:        process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId:      process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    businessAccountId:  process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    appSecret:          process.env.WHATSAPP_APP_SECRET || '',
    verifyToken:        process.env.WHATSAPP_VERIFY_TOKEN || '',
  };
}

function isConfigured() {
  const c = getConfig();
  return Boolean(c.accessToken && c.phoneNumberId);
}

function assertConfigured() {
  if (!isConfigured()) {
    const err = new Error('WhatsApp no esta configurado. Revisa WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en el entorno.');
    err.code = 'WA_NOT_CONFIGURED';
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────
// Webhook: verificacion
// ─────────────────────────────────────────────────────────────

/**
 * Verifica la firma X-Hub-Signature-256 enviada por Meta.
 * Usa timingSafeEqual para evitar timing attacks.
 *
 * Importante: el payload debe ser el body RAW (Buffer), no el JSON parseado.
 * Por eso el webhook se monta con express.raw() o se pasa rawBody desde
 * un middleware previo.
 */
function verifySignature(rawBody, signatureHeader) {
  const { appSecret } = getConfig();
  if (!appSecret) return false;
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const received = signatureHeader.slice('sha256='.length).trim();
  const expected = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  if (received.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Handshake de verificacion del webhook (GET /webhooks/whatsapp).
 * Meta envia hub.mode, hub.verify_token, hub.challenge.
 * Devolvemos el challenge si el token coincide.
 */
function verifyHandshake({ mode, token, challenge }) {
  const { verifyToken } = getConfig();
  if (mode === 'subscribe' && token && verifyToken && token === verifyToken) {
    return { ok: true, challenge: String(challenge || '') };
  }
  return { ok: false };
}

// ─────────────────────────────────────────────────────────────
// HTTP helper sobre Graph API
// ─────────────────────────────────────────────────────────────

async function graphRequest(method, pathSuffix, body = null, extraHeaders = {}) {
  assertConfigured();
  const { accessToken } = getConfig();
  const url = `${GRAPH_BASE}/${pathSuffix.replace(/^\//, '')}`;

  const init = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  };
  if (body !== null) init.body = typeof body === 'string' ? body : JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (networkErr) {
    const err = new Error(`Meta Graph API inalcanzable: ${networkErr.message}`);
    err.code = 'WA_NETWORK_ERROR';
    throw err;
  }

  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { _raw: text };
  }

  if (!res.ok) {
    const message = json?.error?.message || `HTTP ${res.status} en ${method} ${pathSuffix}`;
    const err = new Error(message);
    err.code = json?.error?.code || 'WA_API_ERROR';
    err.status = res.status;
    err.metaError = json?.error || null;
    throw err;
  }

  return json;
}

// ─────────────────────────────────────────────────────────────
// Normalizadores
// ─────────────────────────────────────────────────────────────

/**
 * Meta espera el destinatario en E.164 sin '+'. Acepta string crudo,
 * con espacios, parentesis, guiones — los limpiamos.
 */
function normalizeRecipient(phone) {
  const cleaned = String(phone || '').replace(/[^\d+]/g, '');
  if (!cleaned) throw new Error('Telefono destino vacio');
  return cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
}

// ─────────────────────────────────────────────────────────────
// Envio: texto, plantilla, medios
// ─────────────────────────────────────────────────────────────

/**
 * Envia un texto libre. Solo permitido dentro de la ventana de 24h
 * desde el ultimo mensaje recibido del contacto. El controller debe
 * validar la ventana antes de llamar a esta funcion; aqui solo
 * empaquetamos y enviamos.
 */
async function sendText({ to, body, replyToWaMessageId = null }) {
  const { phoneNumberId } = getConfig();
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(to),
    type: 'text',
    text: { body: String(body || '').slice(0, 4096) },
  };
  if (replyToWaMessageId) {
    payload.context = { message_id: replyToWaMessageId };
  }
  const res = await graphRequest('POST', `${phoneNumberId}/messages`, payload);
  return {
    wa_message_id: res?.messages?.[0]?.id || null,
    raw: res,
  };
}

/**
 * Envia una plantilla HSM. Esta es la unica forma de iniciar conversacion
 * o de escribir fuera de la ventana de 24h. La plantilla debe estar
 * APPROVED en Meta.
 *
 * @param {object} args
 * @param {string} args.to              telefono destino
 * @param {string} args.templateName    nombre exacto de la plantilla en Meta
 * @param {string} args.languageCode    'es' | 'es_CO' | 'en_US' | etc.
 * @param {Array}  args.bodyVariables   array de strings para los {{1}}, {{2}}...
 * @param {Array}  args.headerVariables (opcional) variables del header
 * @param {Array}  args.buttonVariables (opcional) variables de botones URL
 */
async function sendTemplate({
  to,
  templateName,
  languageCode = 'es',
  bodyVariables = [],
  headerVariables = null,
  buttonVariables = null,
}) {
  const { phoneNumberId } = getConfig();

  const components = [];

  if (headerVariables && headerVariables.length) {
    components.push({
      type: 'header',
      parameters: headerVariables.map((v) => ({ type: 'text', text: String(v) })),
    });
  }

  if (bodyVariables && bodyVariables.length) {
    components.push({
      type: 'body',
      parameters: bodyVariables.map((v) => ({ type: 'text', text: String(v) })),
    });
  }

  if (buttonVariables && buttonVariables.length) {
    buttonVariables.forEach((btn, idx) => {
      components.push({
        type: 'button',
        sub_type: btn.subType || 'url',
        index: String(idx),
        parameters: [{ type: 'text', text: String(btn.value) }],
      });
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(to),
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  const res = await graphRequest('POST', `${phoneNumberId}/messages`, payload);
  return {
    wa_message_id: res?.messages?.[0]?.id || null,
    raw: res,
  };
}

/**
 * Envia un documento, imagen, audio o video por URL publica o por media_id
 * previamente subido a Meta. Solo dentro de ventana 24h (igual que sendText).
 */
async function sendMedia({ to, type, mediaUrl = null, mediaId = null, caption = null, filename = null }) {
  if (!mediaUrl && !mediaId) {
    throw new Error('sendMedia requiere mediaUrl o mediaId');
  }
  if (!['image', 'document', 'audio', 'video', 'sticker'].includes(type)) {
    throw new Error(`Tipo de media no soportado: ${type}`);
  }

  const { phoneNumberId } = getConfig();
  const mediaObj = mediaId ? { id: mediaId } : { link: mediaUrl };
  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    mediaObj.caption = String(caption).slice(0, 1024);
  }
  if (filename && type === 'document') {
    mediaObj.filename = String(filename).slice(0, 240);
  }

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: normalizeRecipient(to),
    type,
    [type]: mediaObj,
  };

  const res = await graphRequest('POST', `${phoneNumberId}/messages`, payload);
  return {
    wa_message_id: res?.messages?.[0]?.id || null,
    raw: res,
  };
}

/**
 * Marca un mensaje recibido como leido. Mejora la experiencia del cliente
 * (los double-checks azules) y el quality rating.
 */
async function markAsRead(waMessageId) {
  const { phoneNumberId } = getConfig();
  const payload = {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: waMessageId,
  };
  return graphRequest('POST', `${phoneNumberId}/messages`, payload);
}

// ─────────────────────────────────────────────────────────────
// Descarga de media entrante
// ─────────────────────────────────────────────────────────────

/**
 * Para un media_id de Meta, primero pedimos el URL temporal y despues
 * descargamos el binario. Lo guardamos local con un path sanitizado y
 * devolvemos { localPath, mime, size, filename }.
 *
 * IMPORTANTE: la URL de Meta expira en ~5 dias y solo se puede acceder
 * con el access token. Por eso almacenamos copia local.
 */
async function downloadMedia(mediaId, suggestedFilename = null) {
  assertConfigured();
  const { accessToken } = getConfig();

  // 1. Resolver el URL temporal del media
  const meta = await graphRequest('GET', `${mediaId}`);
  if (!meta?.url) {
    throw new Error(`Media ${mediaId} no tiene URL accesible`);
  }

  // 2. Descargar el binario (requiere Authorization header)
  const res = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Descarga de media ${mediaId} fallo con HTTP ${res.status}`);
  }

  const arrayBuf = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);

  // 3. Determinar extension/filename y guardar
  await fs.mkdir(MEDIA_ROOT, { recursive: true });
  const ext = mimeToExtension(meta.mime_type) || 'bin';
  const safeName = sanitizeFilename(suggestedFilename || `${mediaId}.${ext}`);
  const localPath = path.join(MEDIA_ROOT, safeName);
  await fs.writeFile(localPath, buffer);

  return {
    localPath,
    mime: meta.mime_type || null,
    size: meta.file_size || buffer.length,
    sha256: meta.sha256 || null,
    filename: safeName,
  };
}

function mimeToExtension(mime) {
  if (!mime) return null;
  const map = {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
    'audio/ogg':  'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4':  'm4a',
    'video/mp4':  'mp4',
    'video/3gpp': '3gp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
  };
  return map[mime] || (mime.split('/')[1] || null);
}

function sanitizeFilename(name) {
  // Solo letras, numeros, guion, punto y guion bajo. Resto -> '_'.
  return String(name).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 200);
}

// ─────────────────────────────────────────────────────────────
// Estado del numero
// ─────────────────────────────────────────────────────────────

/**
 * Pide a Meta el estado del numero (quality_rating, name_status).
 * Util para sincronizar wa_phone_numbers.quality_rating periodicamente.
 */
async function getPhoneNumberStatus() {
  const { phoneNumberId } = getConfig();
  const fields = 'verified_name,display_phone_number,quality_rating,name_status,code_verification_status';
  return graphRequest('GET', `${phoneNumberId}?fields=${encodeURIComponent(fields)}`);
}

/**
 * Lista las plantillas registradas en la WABA (catalogo Meta).
 * Util para sincronizar el estado APPROVED/REJECTED al wa_templates local.
 */
async function listMetaTemplates() {
  const { businessAccountId } = getConfig();
  if (!businessAccountId) throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID requerido para listar plantillas');
  return graphRequest('GET', `${businessAccountId}/message_templates?limit=100`);
}

// ─────────────────────────────────────────────────────────────
// Helpers de ventana 24h
// ─────────────────────────────────────────────────────────────

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/**
 * Dado el last_inbound_at de una conversacion, devuelve true si todavia
 * estamos dentro de la ventana de 24h y se permite enviar texto libre.
 */
function isWithin24hWindow(lastInboundAt) {
  if (!lastInboundAt) return false;
  const ts = lastInboundAt instanceof Date ? lastInboundAt.getTime() : new Date(lastInboundAt).getTime();
  if (Number.isNaN(ts)) return false;
  return (Date.now() - ts) < WINDOW_24H_MS;
}

module.exports = {
  // Config
  isConfigured,
  getConfig,

  // Webhook
  verifySignature,
  verifyHandshake,

  // Envio
  sendText,
  sendTemplate,
  sendMedia,
  markAsRead,

  // Recepcion
  downloadMedia,

  // Admin / sync
  getPhoneNumberStatus,
  listMetaTemplates,

  // Helpers
  normalizeRecipient,
  isWithin24hWindow,
  WINDOW_24H_MS,
};
