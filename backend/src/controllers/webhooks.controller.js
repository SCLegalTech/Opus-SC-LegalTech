const db = require('../config/db');
const { timingSafeEqual } = require('node:crypto');

// ──────────────────────────────────────────────────────────
// Autenticación por shared secret (header X-Webhook-Secret)
// ──────────────────────────────────────────────────────────
// Usamos timingSafeEqual con buffers de igual longitud. La comparación
// directa con `===` permite a un atacante medir la latencia de respuesta
// para inferir el secreto byte a byte.
const validateSecret = (req, res) => {
  const rawSecret = req.headers['x-webhook-secret'];
  const expected = process.env.WORKFLOW_WEBHOOK_SECRET;
  if (!expected) {
    res.status(500).json({ error: 'WORKFLOW_WEBHOOK_SECRET no esta configurado en el servidor' });
    return false;
  }
  const secret = typeof rawSecret === 'string' ? rawSecret : '';
  const expectedBuf = Buffer.from(expected);
  const secretBuf = Buffer.from(secret);
  const ok = secretBuf.length === expectedBuf.length
    && timingSafeEqual(secretBuf, expectedBuf);
  if (!ok) {
    res.status(401).json({ error: 'Webhook secret inválido' });
    return false;
  }
  return true;
};

// ──────────────────────────────────────────────────────────
// POST /api/webhooks/workflow
// workflow envía eventos hacia Opus
// Payload esperado: { event_type, source, case_id?, data }
// ──────────────────────────────────────────────────────────
const receiveWorkflowEvent = async (req, res) => {
  if (!validateSecret(req, res)) return;

  const { event_type, source, case_id, data } = req.body;

  if (!event_type) return res.status(400).json({ error: 'event_type es requerido' });

  try {
    // Registrar el evento
    const { rows } = await db.query(`
      INSERT INTO workflow_events (direction, event_type, source, case_id, payload)
      VALUES ('inbound', $1, $2, $3, $4)
      RETURNING id
    `, [event_type, source || 'workflow', case_id || null, JSON.stringify(data || {})]);

    const eventId = rows[0].id;

    // Procesar según tipo
    let processed = false;
    let error = null;

    try {
      processed = await processEvent(event_type, case_id, data);
    } catch (err) {
      error = err.message;
    }

    // Actualizar estado del evento
    await db.query(`
      UPDATE workflow_events
      SET processed = $1, processed_at = NOW(), error = $2
      WHERE id = $3
    `, [processed, error, eventId]);

    res.json({
      ok: true,
      event_id: eventId,
      processed,
      error: error || undefined,
    });
  } catch (err) {
    console.error('[webhook] Error procesando evento:', err);
    res.status(500).json({ error: 'Error interno procesando evento' });
  }
};

// ──────────────────────────────────────────────────────────
// Procesadores por tipo de evento
// ──────────────────────────────────────────────────────────
async function processEvent(event_type, case_id, data) {
  switch (event_type) {

    // Gmail recibió un email → registrar en comunicaciones del caso
    case 'gmail.received': {
      if (!case_id) return false;
      const { from, subject, snippet } = data || {};
      await db.query(`
        INSERT INTO communications (case_id, type, content, metadata)
        VALUES ($1, 'email', $2, $3)
      `, [
        case_id,
        `Email recibido de ${from || 'desconocido'}: ${subject || '(sin asunto)'}${snippet ? '\n' + snippet : ''}`,
        JSON.stringify({ from, subject, snippet }),
      ]);
      return true;
    }

    // Vencimiento se aproxima → marcar urgencia
    case 'deadline.approaching': {
      if (!case_id || !data?.vencimiento_id) return false;
      const { urgency } = data;
      if (urgency) {
        await db.query(
          'UPDATE vencimientos SET urgency = $1 WHERE id = $2 AND case_id = $3',
          [urgency, data.vencimiento_id, case_id]
        );
      }
      return true;
    }

    // Documento llegó a Drive → registrar en documents del caso
    case 'drive.file_received': {
      if (!case_id) return false;
      const { name, drive_file_id, document_type } = data || {};
      if (!name) return false;
      await db.query(`
        INSERT INTO documents (case_id, name, drive_file_id, document_type, pending_classification)
        VALUES ($1, $2, $3, $4, TRUE)
      `, [case_id, name, drive_file_id || null, document_type || null]);
      await db.query(`
        INSERT INTO communications (case_id, type, content, metadata)
        VALUES ($1, 'system', $2, $3)
      `, [
        case_id,
        `Documento recibido vía Drive: ${name}${document_type ? ' · ' + document_type : ''} · Pendiente de clasificación`,
        JSON.stringify({ drive_file_id }),
      ]);
      return true;
    }

    // Caso actualizado desde workflow (estado, next_action)
    case 'case.update': {
      if (!case_id || !data) return false;
      const allowed = ['status', 'next_action', 'next_action_date', 'drive_folder_id'];
      const updates = Object.fromEntries(
        Object.entries(data).filter(([k]) => allowed.includes(k))
      );
      if (!Object.keys(updates).length) return false;

      const sets   = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
      const values = [case_id, ...Object.values(updates)];
      await db.query(
        `UPDATE cases SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
        values
      );
      return true;
    }

    // Ping de diagnóstico
    case 'ping':
      return true;

    default:
      // Evento desconocido: se registró pero no se procesó
      return false;
  }
}

// ──────────────────────────────────────────────────────────
// GET /api/webhooks/workflow/pending
// workflow consulta eventos outbound no procesados (polling)
// ──────────────────────────────────────────────────────────
const getPendingEvents = async (req, res) => {
  if (!validateSecret(req, res)) return;

  const { limit = 50 } = req.query;
  try {
    const { rows } = await db.query(`
      SELECT id, event_type, source, case_id, payload, created_at
      FROM workflow_events
      WHERE direction = 'outbound' AND processed = FALSE
      ORDER BY created_at ASC
      LIMIT $1
    `, [parseInt(limit)]);

    // Marcar como procesados (consumo único — at-least-once)
    if (rows.length > 0) {
      const ids = rows.map(r => r.id);
      await db.query(
        `UPDATE workflow_events SET processed = TRUE, processed_at = NOW()
         WHERE id = ANY($1::int[])`,
        [ids]
      );
    }

    res.json({ events: rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error obteniendo eventos pendientes' });
  }
};

// ──────────────────────────────────────────────────────────
// GET /api/webhooks/workflow/health
// Diagnóstico rápido de la integración
// ──────────────────────────────────────────────────────────
const getHealth = async (req, res) => {
  if (!validateSecret(req, res)) return;
  try {
    const { rows } = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'inbound'  AND processed = FALSE) AS inbound_pending,
        COUNT(*) FILTER (WHERE direction = 'outbound' AND processed = FALSE) AS outbound_pending,
        MAX(created_at) FILTER (WHERE direction = 'inbound')  AS last_inbound,
        MAX(created_at) FILTER (WHERE direction = 'outbound') AS last_outbound
      FROM workflow_events
    `);
    res.json({ ok: true, stats: rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

module.exports = { receiveWorkflowEvent, getPendingEvents, getHealth };
