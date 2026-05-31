/**
 * waOnboarding.service.js
 * ─────────────────────────────────────────────────────────────
 * Fase 4 — automatización interna de captación por WhatsApp.
 *
 * Filosofía:
 *   El agente NO responde directamente al prospecto. La automatización
 *   es 100% interna: crea registros en `prospects`, ejecuta triage con
 *   Gemini, y crea una tarea para que un humano califique el lead.
 *   El humano sigue siendo el primer punto de contacto saliente.
 *
 * Flujo:
 *   inbound msg → si no hay client/prospect vinculado → crear prospect
 *               → si ya hay prospect y aún no se ha hecho triage:
 *                   acumular contexto → al N-ésimo mensaje, correr
 *                   Gemini para inferir service_type + description
 *                   → crear tarea "Calificar prospecto X"
 *
 * Estado almacenado en wa_conversations.metadata.onboarding:
 *   {
 *     prospect_id: 42,
 *     triage_done: false,
 *     inbound_count_at_consent: 3
 *   }
 *
 * Nada de esto envia mensajes salientes. Si la firma quiere auto-acuse
 * de recibo, eso se configura aparte con plantillas HSM aprobadas.
 */

const db = require('../config/db');
const gemini = require('./gemini.service');

const TRIAGE_AFTER_INBOUND_COUNT = 2;     // espera 2 mensajes inbound antes de triage

const TRIAGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    service_type: {
      type: 'STRING',
      description: 'Servicio juridico inferido. Valores permitidos EXACTOS (mayusculas): PQRS | TUTELA | CONTRATO | LABORAL | PENAL | SOCIETARIO | REGULATORIO | OTRO. Si no esta claro, devuelve OTRO.',
    },
    urgency: {
      type: 'STRING',
      description: 'Nivel de urgencia inferido: alta | media | baja',
    },
    summary: {
      type: 'STRING',
      description: 'Resumen ejecutivo del asunto en una frase, en palabras del propio prospecto cuando sea posible. Maximo 220 caracteres.',
    },
    full_name_guess: {
      type: 'STRING',
      description: 'Si en algun mensaje el prospecto da su nombre completo, devuelve aqui el nombre. Si no esta claro, devuelve string vacio.',
    },
    confidence: {
      type: 'NUMBER',
      description: 'Confianza del triage entre 0 y 1.',
    },
  },
  required: ['service_type', 'urgency', 'summary', 'confidence'],
};

const TRIAGE_SYSTEM_INSTRUCTION = `
Eres Phi, auxiliar administrativo de SC LegalTech (firma juridica colombiana).
Tu tarea es triage de un nuevo prospecto que escribio por WhatsApp.

Reglas:
- NO emitas opinion juridica. Solo CLASIFICA.
- service_type debe ser EXACTAMENTE uno de los valores listados en el schema.
- Si la conversacion es saludo o aceptacion de consentimiento, marca service_type="consulta_general" y confidence baja.
- summary debe ser sobrio, sin adjetivos. Una frase, sin opinion.
- Devuelve JSON estricto.
`.trim();

// ─────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────

/**
 * Punto de entrada llamado por el webhook tras procesar cada inbound.
 * Idempotente: si el prospect ya existe y el triage ya se hizo, no hace nada.
 */
async function handleInbound({ conversation, message, contactName, contactPhone }) {
  if (!conversation) return;
  // Si ya hay client vinculado (cliente activo), no es onboarding
  if (conversation.client_id) return;

  const meta = conversation.metadata || {};
  const onboarding = meta.onboarding || {};

  // 1. Asegurar prospect
  let prospectId = onboarding.prospect_id || conversation.prospect_id;
  if (!prospectId) {
    prospectId = await ensureProspect({
      contactPhone,
      contactName,
      conversationId: conversation.id,
    });
    await db.query(
      `UPDATE wa_conversations
         SET prospect_id = $1,
             metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{onboarding}', $2::jsonb, true),
             updated_at = NOW()
       WHERE id = $3`,
      [prospectId, JSON.stringify({ ...onboarding, prospect_id: prospectId }), conversation.id]
    );
  }

  // 2. Si ya se hizo triage, salir
  if (onboarding.triage_done) return;

  // 3. Solo correr triage si tenemos consentimiento granted
  if (conversation.consent_status !== 'granted') return;

  // 4. Esperar a tener al menos N mensajes inbound antes de triage
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM wa_messages WHERE conversation_id = $1 AND direction = 'inbound'`,
    [conversation.id]
  );
  const inboundCount = rows[0]?.c || 0;
  if (inboundCount < TRIAGE_AFTER_INBOUND_COUNT) return;

  // 5. Triage con Gemini
  const triage = await runTriage(conversation.id);
  if (!triage) return;

  // 6. Persistir triage y crear tarea
  await applyTriage({ prospectId, conversationId: conversation.id, triage });
  await db.query(
    `UPDATE wa_conversations
       SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{onboarding}', $1::jsonb, true),
           updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ prospect_id: prospectId, triage_done: true, triage_at: new Date().toISOString() }),
     conversation.id]
  );

  console.log(`[wa-onboarding] triage completo prospect=${prospectId} service=${triage.service_type} urgency=${triage.urgency}`);
}

// ─────────────────────────────────────────────────────────────
// ensureProspect
// ─────────────────────────────────────────────────────────────

async function ensureProspect({ contactPhone, contactName, conversationId }) {
  // Si ya existe un prospect con ese telefono, reusar
  const { rows: existing } = await db.query(
    `SELECT id FROM prospects WHERE phone = $1 ORDER BY id DESC LIMIT 1`,
    [contactPhone]
  );
  if (existing.length) return existing[0].id;

  const { rows } = await db.query(
    `INSERT INTO prospects (full_name, phone, source, pipeline_status, jurisdiction, metadata)
     VALUES ($1, $2, 'whatsapp', 'nuevo', 'CO', $3::jsonb)
     RETURNING id`,
    [contactName || null, contactPhone, JSON.stringify({ wa_conversation_id: conversationId })]
  );
  return rows[0].id;
}

// ─────────────────────────────────────────────────────────────
// runTriage — usa Gemini para clasificar el asunto
// ─────────────────────────────────────────────────────────────

async function runTriage(conversationId) {
  if (!gemini.isAvailable()) {
    console.warn('[wa-onboarding] Gemini no disponible, skip triage');
    return null;
  }

  // Recolectar los ultimos 10 mensajes inbound (texto y captions)
  const { rows } = await db.query(
    `SELECT direction, body, media_caption, message_type, created_at
       FROM wa_messages
      WHERE conversation_id = $1 AND direction = 'inbound'
      ORDER BY created_at DESC
      LIMIT 10`,
    [conversationId]
  );
  const inbound = rows.reverse();

  const transcript = inbound.map((m) => {
    if (m.message_type === 'text' && m.body) return `[texto] ${m.body}`;
    if (m.media_caption) return `[${m.message_type}] ${m.media_caption}`;
    return `[${m.message_type}]`;
  }).join('\n');

  const prompt = `
Conversacion entrante de un prospecto en WhatsApp:

${transcript}

Clasifica el asunto y devuelve JSON segun el schema. service_type debe ser EXACTAMENTE uno de: PQRS, TUTELA, CONTRATO, LABORAL, PENAL, SOCIETARIO, REGULATORIO, OTRO.
  `.trim();

  try {
    const result = await gemini.generateJson({
      systemInstruction: TRIAGE_SYSTEM_INSTRUCTION,
      prompt,
      schema: TRIAGE_SCHEMA,
      temperature: 0.2,
    });
    return result?.analysis || null;
  } catch (err) {
    console.warn('[wa-onboarding] Gemini triage failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// applyTriage — guarda en prospects y crea tarea para humano
// ─────────────────────────────────────────────────────────────

async function applyTriage({ prospectId, conversationId, triage }) {
  // Mapear service_type a los enum de service_type del schema
  const serviceType = mapServiceType(triage.service_type);

  await db.query(
    `UPDATE prospects
        SET service_type = $1,
            description  = COALESCE($2, description),
            full_name    = COALESCE(full_name, $3),
            pipeline_status = CASE WHEN pipeline_status = 'nuevo' THEN 'contactado' ELSE pipeline_status END,
            updated_at = NOW()
      WHERE id = $4`,
    [serviceType, triage.summary || null, triage.full_name_guess || null, prospectId]
  );

  // Crear tarea para que un abogado califique
  // (sin asignar: queda en bandeja para que alguien la tome)
  await db.query(
    `INSERT INTO tareas (case_id, title, description, priority, status, created_at, updated_at)
     VALUES (NULL, $1, $2, $3, 'PENDIENTE', NOW(), NOW())`,
    [
      `Calificar prospecto WhatsApp #${prospectId}`,
      `Triage automatico de Phi:\n- Tipo de servicio: ${triage.service_type}\n- Urgencia: ${triage.urgency}\n- Resumen: ${triage.summary}\n- Confianza: ${triage.confidence}\n\nVer hilo: /whatsapp?c=${conversationId}`,
      mapUrgencyToPriority(triage.urgency),
    ]
  );

  // Auditar via agent_actions
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible)
       VALUES ('whatsapp.onboarding_triage', $1::jsonb, $2::jsonb, 'executed', true)`,
      [JSON.stringify({ prospect_id: prospectId, conversation_id: conversationId }),
       JSON.stringify(triage)]
    );
  } catch (e) {
    console.warn('[wa-onboarding] log audit failed:', e.message);
  }
}

// service_type ENUM exact values must match what the schema declares.
// Si el ENUM real difiere, ajustar el mapeo.
// service_type ENUM (schema.sql L18): PQRS | TUTELA | CONTRATO | LABORAL |
// PENAL | SOCIETARIO | REGULATORIO | OTRO. Mapeamos en mayusculas; si Gemini
// devuelve algo inesperado, caemos a 'OTRO' antes que romper el INSERT.
function mapServiceType(raw) {
  const v = String(raw || '').toUpperCase().trim();
  const allowed = new Set(['PQRS', 'TUTELA', 'CONTRATO', 'LABORAL', 'PENAL', 'SOCIETARIO', 'REGULATORIO', 'OTRO']);
  if (allowed.has(v)) return v;
  // Sinonimos comunes
  if (['DERECHO_PETICION', 'PETICION', 'PQR'].includes(v)) return 'PQRS';
  if (['CIVIL', 'COMERCIAL'].includes(v)) return 'SOCIETARIO';
  if (['ADMINISTRATIVO', 'TRIBUTARIO'].includes(v)) return 'REGULATORIO';
  return 'OTRO';
}

function mapUrgencyToPriority(urgency) {
  const u = String(urgency || '').toLowerCase();
  if (u === 'alta')  return 'ALTA';
  if (u === 'baja')  return 'BAJA';
  return 'MEDIA';
}

module.exports = {
  handleInbound,
  ensureProspect,
};
