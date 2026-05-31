/**
 * waMediaAnalysis.service.js
 * ─────────────────────────────────────────────────────────────
 * Fase 6 — análisis automático de medios entrantes por WhatsApp:
 *   - Notas de voz  → transcripción (STT) con Gemini multimodal
 *   - Imágenes      → OCR + clasificación (cédula, comprobante, foto general)
 *   - Documentos    → texto extraído + clasificación
 *
 * Triggered desde el webhook controller después de que `downloadMedia`
 * haya guardado el archivo localmente. No bloquea el ack 200 porque corre
 * dentro de setImmediate.
 *
 * Resultado:
 *   - Para audio: la transcripción se guarda en wa_messages.body
 *     (de manera que el inbox la muestre como texto del cliente).
 *   - Para imagen / documento: el OCR text + clasificación se guarda en
 *     wa_messages.metadata.media_analysis JSONB.
 *   - Si la conversación tiene caso vinculado, el resumen se actualiza
 *     en la communication asociada.
 *
 * Filosofía:
 *   - Best-effort: si Gemini no está disponible o falla, el mensaje
 *     queda como estaba. Nunca rompemos el flujo del webhook.
 *   - El análisis NO emite opinión jurídica. Solo extrae texto y
 *     clasifica el tipo de documento (administrativo).
 */

const fs = require('node:fs/promises');
const db = require('../config/db');
const gemini = require('./gemini.service');

const TRANSCRIPTION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcription: { type: 'STRING', description: 'Transcripcion literal del audio en espanol.' },
    language: { type: 'STRING', description: 'Codigo de idioma detectado: "es", "en", etc.' },
    duration_estimate: { type: 'NUMBER', description: 'Duracion estimada en segundos.' },
    speaker_summary: { type: 'STRING', description: 'Resumen en una frase de lo que dijo el hablante. Sin opinion juridica.' },
  },
  required: ['transcription', 'speaker_summary'],
};

const IMAGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    document_type: {
      type: 'STRING',
      description: 'Tipo de documento detectado. Uno de: cedula | pasaporte | licencia | rut | factura | recibo | comprobante_pago | sentencia | resolucion | acta | contrato | poder | captura_pantalla | foto_lugar | foto_lesion | foto_documento_otro | sin_texto',
    },
    extracted_text: {
      type: 'STRING',
      description: 'Texto literal extraido del documento o imagen. Si no hay texto, devuelve string vacio.',
    },
    key_fields: {
      type: 'OBJECT',
      description: 'Campos clave extraidos. Si es cedula: { numero, nombre, fecha_nacimiento }. Si es factura: { proveedor, valor, fecha }. Vacio si no aplica.',
    },
    summary: {
      type: 'STRING',
      description: 'Resumen administrativo en una frase de que muestra la imagen. Sin opinion.',
    },
    confidence: { type: 'NUMBER', description: 'Confianza entre 0 y 1.' },
  },
  required: ['document_type', 'summary', 'confidence'],
};

const SYSTEM_INSTRUCTION = `
Eres Phi, auxiliar administrativo de SC LegalTech.
Tu tarea es extraer texto y clasificar medios que llegan por WhatsApp.
NO emitas opinion juridica. Solo CLASIFICA y EXTRAE TEXTO.
Devuelve JSON estricto que cumpla el schema.
`.trim();

// ─────────────────────────────────────────────────────────────
// Punto de entrada
// ─────────────────────────────────────────────────────────────

/**
 * Llamado por el webhook después de descargar el media.
 * Idempotente: si ya hay analysis previo, no reprocesa.
 */
async function analyzeMessage({ messageId }) {
  if (!gemini.isAvailable()) {
    console.warn('[wa-media] Gemini no disponible, skip analysis');
    return null;
  }

  const { rows } = await db.query(
    `SELECT id, conversation_id, message_type, media_url, media_mime, media_filename,
            body, raw_payload, related_communication_id
       FROM wa_messages
      WHERE id = $1`,
    [messageId]
  );
  if (!rows.length) return null;
  const msg = rows[0];

  if (!msg.media_url) return null;
  // Si body ya contiene transcripcion previa, skip
  if (msg.body && msg.body.startsWith('[transcripción]')) return null;

  let result = null;
  try {
    if (msg.message_type === 'audio') {
      result = await transcribeAudio(msg);
    } else if (msg.message_type === 'image' || msg.message_type === 'document') {
      result = await analyzeImageOrDocument(msg);
    } else {
      return null;
    }
  } catch (err) {
    console.warn(`[wa-media] analysis failed for msg ${messageId}:`, err.message);
    return null;
  }

  if (!result) return null;

  await persistAnalysis({ msg, result });
  return result;
}

// ─────────────────────────────────────────────────────────────
// Audio → transcripción
// ─────────────────────────────────────────────────────────────

async function transcribeAudio(msg) {
  const buffer = await fs.readFile(msg.media_url);
  const base64 = buffer.toString('base64');

  const prompt = [
    { text: 'Transcribe esta nota de voz literalmente y resume en una frase lo que dijo el hablante. Devuelve JSON segun el schema.' },
    {
      inlineData: {
        mimeType: msg.media_mime || 'audio/ogg',
        data: base64,
      },
    },
  ];

  const out = await gemini.generateJson({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: TRANSCRIPTION_SCHEMA,
    temperature: 0.1,
  });
  if (!out?.analysis) return null;

  return {
    kind: 'audio',
    ...out.analysis,
  };
}

// ─────────────────────────────────────────────────────────────
// Imagen / documento → OCR + clasificación
// ─────────────────────────────────────────────────────────────

async function analyzeImageOrDocument(msg) {
  const buffer = await fs.readFile(msg.media_url);
  const base64 = buffer.toString('base64');
  const mime = msg.media_mime || (msg.message_type === 'image' ? 'image/jpeg' : 'application/pdf');

  const prompt = [
    { text: 'Extrae todo el texto visible y clasifica el tipo de documento. NO emitas opinion juridica. Devuelve JSON segun el schema.' },
    { inlineData: { mimeType: mime, data: base64 } },
  ];

  const out = await gemini.generateJson({
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
    schema: IMAGE_SCHEMA,
    temperature: 0.1,
  });
  if (!out?.analysis) return null;

  return {
    kind: msg.message_type,
    ...out.analysis,
  };
}

// ─────────────────────────────────────────────────────────────
// persistAnalysis
// ─────────────────────────────────────────────────────────────

async function persistAnalysis({ msg, result }) {
  // Construir body legible para mostrar en el inbox
  let bodyToSave = msg.body;
  let summary = '';

  if (result.kind === 'audio') {
    bodyToSave = `[transcripción] ${result.transcription || ''}`.trim();
    summary = result.speaker_summary || '';
  } else if (result.kind === 'image' || result.kind === 'document') {
    summary = `${result.document_type || 'documento'}: ${result.summary || ''}`.trim();
    if (result.extracted_text) {
      // Solo guardamos texto OCR en body si no hay caption original
      if (!msg.body) bodyToSave = `[OCR] ${truncate(result.extracted_text, 1500)}`;
    }
  }

  // Guardar el análisis crudo en raw_payload.analysis
  const newPayload = {
    ...(msg.raw_payload || {}),
    analysis: result,
  };

  await db.query(
    `UPDATE wa_messages
        SET body = $1,
            raw_payload = $2::jsonb,
            updated_at = NOW()
      WHERE id = $3`,
    [bodyToSave, JSON.stringify(newPayload), msg.id]
  );

  // Si hay communication vinculada, actualizar su content para que el resumen
  // aparezca en la timeline del caso
  if (msg.related_communication_id && summary) {
    const { rows } = await db.query(
      `SELECT content FROM communications WHERE id = $1`,
      [msg.related_communication_id]
    );
    if (rows.length) {
      const enriched = `${rows[0].content}\n→ ${summary}`;
      await db.query(
        `UPDATE communications SET content = $1 WHERE id = $2`,
        [enriched, msg.related_communication_id]
      );
    }
  }

  // Audit
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible)
       VALUES ('whatsapp.media_analysis', $1::jsonb, $2::jsonb, 'executed', true)`,
      [JSON.stringify({ wa_message_id: msg.id, kind: result.kind }),
       JSON.stringify({ summary, document_type: result.document_type || null })]
    );
  } catch (e) {
    // No bloquea
  }

  console.log(`[wa-media] analysis OK msg=${msg.id} kind=${result.kind}`);
}

function truncate(s, n) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n)}…`;
}

module.exports = {
  analyzeMessage,
};
