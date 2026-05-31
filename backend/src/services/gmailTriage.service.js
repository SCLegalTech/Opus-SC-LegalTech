/**
 * gmailTriage.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * RecepciÃ³n Inteligente â€” Fase 1.
 *
 * FilosofÃ­a:
 *   Cada correo entrante se transforma en una tarjeta de triage con
 *   cliente probable, caso probable, materia, urgencia y ruta sugerida.
 *   La asociaciÃ³n al caso o el descarte siempre los hace un humano.
 *
 * Este servicio NO envÃ­a correos ni mueve etiquetas en Gmail. Solo
 * clasifica y propone. Las acciones agÃ©nticas (responder, archivar)
 * pasan por la bandeja de aprobaciones aparte.
 *
 * Persiste en `inbox_triage` (cache) con UNIQUE(user_id, source, external_id)
 * â†’ idempotente: re-procesar el mismo correo no duplica filas.
 */

const db = require('../config/db');
const gemini = require('./gemini.service');

const SOURCE = 'gmail';

const TRIAGE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    service_type: {
      type: 'STRING',
      description: 'Materia jurÃ­dica inferida. Valores EXACTOS (mayÃºsculas): PQRS | TUTELA | CONTRATO | LABORAL | PENAL | SOCIETARIO | REGULATORIO | OTRO.',
    },
    urgency: {
      type: 'STRING',
      description: 'Nivel de urgencia inferido: alta | media | baja.',
    },
    summary: {
      type: 'STRING',
      description: 'Resumen ejecutivo en una frase, sin opiniÃ³n. MÃ¡ximo 220 caracteres.',
    },
    case_number_mentioned: {
      type: 'STRING',
      description: 'Si el correo menciona un nÃºmero de caso (formato SC-YYYY-NNNN), devuelvelo. Si no, string vacÃ­o.',
    },
    suggested_action: {
      type: 'STRING',
      description: 'Una de: associate_case | create_case | request_info | dismiss.',
    },
    confidence: {
      type: 'NUMBER',
      description: 'Confianza global del triage entre 0 y 1.',
    },
  },
  required: ['service_type', 'urgency', 'summary', 'suggested_action', 'confidence'],
};

const TRIAGE_SYSTEM_INSTRUCTION = `
Eres Phi, auxiliar administrativo de SC LegalTech (firma jurÃ­dica colombiana).
Tu tarea es triage de un correo entrante. NO emites concepto jurÃ­dico, solo clasificas.

Reglas:
- service_type debe ser EXACTAMENTE uno de los valores listados.
- summary debe ser sobrio, descriptivo, sin adjetivos.
- suggested_action es la prÃ³xima acciÃ³n operativa, no jurÃ­dica.
- Si el correo es spam, notificaciÃ³n automÃ¡tica o irrelevante, suggested_action="dismiss" y confidence baja.
- Devuelve JSON estricto.
`.trim();

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// API
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Triage idempotente de un correo de Gmail.
 *
 * @param {object} args
 * @param {number} args.userId
 * @param {number|null} args.organizationId
 * @param {object} args.parsed   parsed gmail message (subject, from, snippet, body, gmail_message_id, gmail_thread_id, date)
 * @param {boolean} [args.force] si true, re-corre Gemini aunque ya exista cache
 * @returns {Promise<object>}    fila de inbox_triage
 */
async function triageMessage({ userId, organizationId, parsed, force = false }) {
  const externalId = parsed.gmail_message_id;
  if (!externalId) throw new Error('triageMessage: parsed.gmail_message_id requerido');

  const existing = await findByExternalId({ userId, externalId });
  if (existing && !force) return existing;

  const fromAddress = parsed.from || null;
  const subject     = parsed.subject || '';
  const snippet     = parsed.snippet || '';
  const body        = parsed.body || '';
  const receivedAt  = parseDate(parsed.date);

  // 1. Resolver cliente por email (independiente de Gemini)
  const clientMatch = await matchClientByEmail(fromAddress, organizationId);

  // 2. Pasar a Gemini para clasificaciÃ³n
  const triage = await runGeminiTriage({ subject, snippet, body, from: fromAddress });

  // 3. Resolver caso (por nÃºmero mencionado o por cliente match)
  const caseMatch = await resolveCaseMatch({
    caseNumberMentioned: triage?.case_number_mentioned,
    clientId: clientMatch?.id,
    organizationId,
  });

  // 4. Persistir (UPSERT por user_id + source + external_id)
  const row = await upsertTriage({
    userId,
    organizationId,
    externalId,
    threadId: parsed.gmail_thread_id || null,
    subject,
    fromAddress,
    snippet,
    receivedAt,
    triage,
    clientMatch,
    caseMatch,
  });

  // 5. Auditar
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, params, result, status, reversible)
       VALUES ('inbox.gmail_triage', $1::jsonb, $2::jsonb, 'executed', true)`,
      [
        JSON.stringify({ user_id: userId, gmail_message_id: externalId }),
        JSON.stringify(triage || {}),
      ]
    );
  } catch (e) {
    console.warn('[gmail-triage] audit failed:', e.message);
  }

  return row;
}

// Las lecturas filtran por user_id (un usuario solo ve su propia
// bandeja). organization_id es defensa en profundidad: si un dÃ­a se
// cambia el modelo de membership o se introduce un usuario que pertenece
// a varias orgs, el filtro por org evita leak silencioso.
//
// Soporta filtros: rango temporal, bÃºsqueda full-text, urgencia.
// Por default ordena por confianza desc + recencia.
async function listPending({
  userId, organizationId,
  limit = 50, offset = 0,
  fromDate = null,    // ISO date YYYY-MM-DD
  toDate = null,
  urgency = null,     // alta|media|baja
  serviceType = null, // PQRS|TUTELA|...
  search = null,      // texto libre busca en subject + from_address + summary
  sortBy = 'confidence', // confidence | date | urgency
} = {}) {
  const conditions = ['user_id = $1', `status = 'pending'`];
  const params = [userId];

  if (organizationId) {
    conditions.push(`organization_id = $${params.length + 1}`);
    params.push(organizationId);
  }
  if (fromDate) {
    conditions.push(`(received_at >= $${params.length + 1} OR triaged_at >= $${params.length + 1})`);
    params.push(fromDate);
  }
  if (toDate) {
    conditions.push(`(received_at <= $${params.length + 1} OR triaged_at <= $${params.length + 1})`);
    params.push(toDate);
  }
  if (urgency) {
    conditions.push(`urgency = $${params.length + 1}`);
    params.push(urgency);
  }
  if (serviceType) {
    conditions.push(`service_type = $${params.length + 1}`);
    params.push(serviceType);
  }
  if (search) {
    conditions.push(`(subject ILIKE $${params.length + 1} OR from_address ILIKE $${params.length + 1} OR summary ILIKE $${params.length + 1})`);
    params.push(`%${search}%`);
  }

  // Orden: por defecto confianza desc + recencia.
  let orderBy;
  if (sortBy === 'date') {
    orderBy = 'received_at DESC NULLS LAST, triaged_at DESC';
  } else if (sortBy === 'urgency') {
    // alta primero (mapeo a entero para ordenar)
    orderBy = `CASE urgency WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, confidence DESC, triaged_at DESC`;
  } else {
    // confidence (default)
    orderBy = 'confidence DESC NULLS LAST, triaged_at DESC';
  }

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT * FROM inbox_triage
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

async function getById({ userId, organizationId, id }) {
  const params = [id, userId];
  let orgClause = '';
  if (organizationId) {
    orgClause = ' AND organization_id = $3';
    params.push(organizationId);
  }
  const { rows } = await db.query(
    `SELECT * FROM inbox_triage WHERE id = $1 AND user_id = $2${orgClause} LIMIT 1`,
    params
  );
  return rows[0] || null;
}

/**
 * Asocia el item a un caso: copia el correo a `communications` y marca
 * el item como associated.
 */
async function associateToCase({ userId, organizationId, id, caseId, communicationContent }) {
  const item = await getById({ userId, organizationId, id });
  if (!item) throw new Error('inbox_triage no encontrado');
  if (item.status !== 'pending') throw new Error(`item ya en estado ${item.status}`);

  const content = communicationContent || buildCommunicationContent(item);
  const metadata = {
    source: 'gmail',
    gmail_message_id: item.external_id,
    gmail_thread_id: item.thread_id,
    from: item.from_address,
    subject: item.subject,
    snippet: item.snippet,
    triage: {
      service_type: item.service_type,
      urgency: item.urgency,
      summary: item.summary,
      confidence: item.confidence ? Number(item.confidence) : null,
    },
  };

  const { rows: commRows } = await db.query(
    `INSERT INTO communications (case_id, type, content, metadata, created_by)
          VALUES ($1, 'email', $2, $3::jsonb, $4)
       RETURNING id`,
    [caseId, content, JSON.stringify(metadata), userId]
  );

  const communicationId = commRows[0].id;

  const { rows: updated } = await db.query(
    `UPDATE inbox_triage
        SET status = 'associated',
            associated_case_id = $1,
            associated_communication_id = $2,
            acted_at = NOW(),
            updated_at = NOW()
      WHERE id = $3 AND user_id = $4
      RETURNING *`,
    [caseId, communicationId, id, userId]
  );

  return updated[0];
}

async function dismiss({ userId, organizationId, id, reason }) {
  const params = [reason || null, id, userId];
  let orgClause = '';
  if (organizationId) {
    orgClause = ' AND organization_id = $4';
    params.push(organizationId);
  }
  const { rows } = await db.query(
    `UPDATE inbox_triage
        SET status = 'dismissed',
            dismissed_reason = $1,
            acted_at = NOW(),
            updated_at = NOW()
      WHERE id = $2 AND user_id = $3 AND status = 'pending'${orgClause}
      RETURNING *`,
    params
  );
  return rows[0] || null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Internals
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function findByExternalId({ userId, externalId }) {
  const { rows } = await db.query(
    `SELECT * FROM inbox_triage
      WHERE user_id = $1 AND source = $2 AND external_id = $3
      LIMIT 1`,
    [userId, SOURCE, externalId]
  );
  return rows[0] || null;
}

async function matchClientByEmail(fromHeader, organizationId) {
  const email = extractEmail(fromHeader);
  if (!email) return null;

  // Acotamos por organization_id si estÃ¡ presente (defensa en profundidad
  // por encima del AsyncLocalStorage tenant scope que ya filtra a nivel pool).
  const params = [email];
  let orgClause = '';
  if (organizationId) {
    orgClause = ' AND organization_id = $2';
    params.push(organizationId);
  }

  const { rows } = await db.query(
    `SELECT id, full_name FROM clients
      WHERE LOWER(email) = LOWER($1) ${orgClause}
      ORDER BY id DESC LIMIT 1`,
    params
  );
  if (!rows.length) return null;
  return { id: rows[0].id, full_name: rows[0].full_name, confidence: 0.9 };
}

async function resolveCaseMatch({ caseNumberMentioned, clientId, organizationId }) {
  // 1. Match exacto por nÃºmero de caso (SC-YYYY-NNNN)
  if (caseNumberMentioned && /^SC-\d{4}-\d{4}$/i.test(caseNumberMentioned)) {
    const params = [caseNumberMentioned.toUpperCase()];
    let orgClause = '';
    if (organizationId) {
      orgClause = ' AND organization_id = $2';
      params.push(organizationId);
    }
    const { rows } = await db.query(
      `SELECT id, case_number, title FROM cases
        WHERE UPPER(case_number) = $1 ${orgClause}
        LIMIT 1`,
      params
    );
    if (rows.length) {
      return { id: rows[0].id, case_number: rows[0].case_number, title: rows[0].title, confidence: 0.95 };
    }
  }

  // 2. Si hay cliente match y solo tiene 1 caso activo â†’ match probable
  if (clientId) {
    const { rows } = await db.query(
      `SELECT id, case_number, title FROM cases
        WHERE client_id = $1 AND status NOT IN ('CERRADO', 'ARCHIVADO', 'ANULADO')
        ORDER BY updated_at DESC LIMIT 2`,
      [clientId]
    );
    if (rows.length === 1) {
      return { id: rows[0].id, case_number: rows[0].case_number, title: rows[0].title, confidence: 0.7 };
    }
    if (rows.length > 1) {
      // Ambiguo: hay varios casos activos del mismo cliente
      return { id: rows[0].id, case_number: rows[0].case_number, title: rows[0].title, confidence: 0.4 };
    }
  }

  return null;
}

async function runGeminiTriage({ subject, snippet, body, from }) {
  if (!gemini.isAvailable()) {
    console.warn('[gmail-triage] Gemini no disponible â€” devolviendo triage minimal');
    return {
      service_type: 'OTRO',
      urgency: 'media',
      summary: subject ? `Correo de ${from || 'remitente desconocido'}: ${subject}` : 'Correo sin asunto',
      case_number_mentioned: '',
      suggested_action: 'request_info',
      confidence: 0.1,
    };
  }

  const truncatedBody = (body || snippet || '').slice(0, 4000);
  const prompt = `
Correo entrante:

De: ${from || '(sin remitente)'}
Asunto: ${subject || '(sin asunto)'}

Cuerpo:
${truncatedBody}

Clasifica el correo y devuelve JSON segÃºn el schema. Recuerda: service_type debe ser EXACTAMENTE uno de PQRS, TUTELA, CONTRATO, LABORAL, PENAL, SOCIETARIO, REGULATORIO, OTRO. Si menciona un caso con formato SC-YYYY-NNNN, devuÃ©lvelo en case_number_mentioned.
`.trim();

  try {
    const result = await gemini.generateJson({
      systemInstruction: TRIAGE_SYSTEM_INSTRUCTION,
      prompt,
      schema: TRIAGE_SCHEMA,
      temperature: 0.2,
    });
    const a = result?.analysis;
    if (!a) return null;
    return {
      service_type: mapServiceType(a.service_type),
      urgency: mapUrgency(a.urgency),
      summary: (a.summary || '').slice(0, 300),
      case_number_mentioned: a.case_number_mentioned || '',
      suggested_action: mapSuggestedAction(a.suggested_action),
      confidence: clampUnit(a.confidence),
    };
  } catch (err) {
    console.warn('[gmail-triage] Gemini fallÃ³:', err.message);
    return null;
  }
}

async function upsertTriage({
  userId, organizationId, externalId, threadId,
  subject, fromAddress, snippet, receivedAt,
  triage, clientMatch, caseMatch,
}) {
  const t = triage || {
    service_type: 'OTRO',
    urgency: 'media',
    summary: '(sin triage)',
    suggested_action: 'request_info',
    confidence: 0,
  };

  const { rows } = await db.query(
    `INSERT INTO inbox_triage (
       user_id, organization_id, source, external_id, thread_id,
       subject, from_address, snippet, received_at,
       service_type, urgency, summary,
       client_match_id, client_match_confidence,
       case_match_id, case_match_confidence,
       suggested_action, confidence,
       triaged_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12,
       $13, $14,
       $15, $16,
       $17, $18,
       NOW()
     )
     ON CONFLICT (user_id, source, external_id) DO UPDATE SET
       subject = EXCLUDED.subject,
       from_address = EXCLUDED.from_address,
       snippet = EXCLUDED.snippet,
       received_at = EXCLUDED.received_at,
       service_type = EXCLUDED.service_type,
       urgency = EXCLUDED.urgency,
       summary = EXCLUDED.summary,
       client_match_id = EXCLUDED.client_match_id,
       client_match_confidence = EXCLUDED.client_match_confidence,
       case_match_id = EXCLUDED.case_match_id,
       case_match_confidence = EXCLUDED.case_match_confidence,
       suggested_action = EXCLUDED.suggested_action,
       confidence = EXCLUDED.confidence,
       triaged_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [
      userId, organizationId || null, SOURCE, externalId, threadId,
      subject || null, fromAddress, snippet, receivedAt,
      t.service_type, t.urgency, t.summary,
      clientMatch?.id || null, clientMatch?.confidence || null,
      caseMatch?.id || null, caseMatch?.confidence || null,
      t.suggested_action, t.confidence,
    ]
  );
  return rows[0];
}

function buildCommunicationContent(item) {
  return [
    item.subject ? `Asunto: ${item.subject}` : null,
    item.from_address ? `De: ${item.from_address}` : null,
    item.received_at ? `Fecha: ${item.received_at}` : null,
    '',
    item.snippet || '(sin contenido)',
  ].filter((l) => l !== null).join('\n');
}

function extractEmail(header) {
  if (!header) return null;
  const m = header.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  const m2 = header.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  return m2 ? m2[0].toLowerCase() : null;
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function mapServiceType(raw) {
  const v = String(raw || '').toUpperCase().trim();
  const allowed = new Set(['PQRS', 'TUTELA', 'CONTRATO', 'LABORAL', 'PENAL', 'SOCIETARIO', 'REGULATORIO', 'OTRO']);
  if (allowed.has(v)) return v;
  if (['PETICION', 'PQR', 'DERECHO_PETICION'].includes(v)) return 'PQRS';
  if (['CIVIL', 'COMERCIAL'].includes(v)) return 'SOCIETARIO';
  if (['ADMINISTRATIVO', 'TRIBUTARIO'].includes(v)) return 'REGULATORIO';
  return 'OTRO';
}

function mapUrgency(raw) {
  const v = String(raw || '').toLowerCase();
  if (['alta', 'high', 'critica'].includes(v)) return 'alta';
  if (['baja', 'low'].includes(v)) return 'baja';
  return 'media';
}

function mapSuggestedAction(raw) {
  const v = String(raw || '').toLowerCase();
  const allowed = new Set(['associate_case', 'create_case', 'request_info', 'dismiss']);
  if (allowed.has(v)) return v;
  return 'request_info';
}

function clampUnit(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

module.exports = {
  triageMessage,
  listPending,
  getById,
  associateToCase,
  dismiss,
};
