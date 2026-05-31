/**
 * whatsapp.controller.js
 * ─────────────────────────────────────────────────────────────
 * API de la bandeja WhatsApp para el frontend interno.
 *
 * Endpoints (todos bajo /api/whatsapp/*, requieren JWT):
 *
 *   GET  /conversations                 lista hilos (con filtros)
 *   GET  /conversations/:id             detalle de un hilo
 *   GET  /conversations/:id/messages    mensajes de un hilo
 *   POST /conversations/:id/read        marcar todos como leidos
 *   POST /conversations/:id/assign      asignar a un usuario
 *   POST /conversations/:id/link-case   vincular a un caso
 *   POST /conversations/:id/link-client vincular a un cliente
 *   POST /conversations/:id/send-text   enviar texto libre (ventana 24h)
 *   POST /conversations/:id/send-template enviar plantilla HSM
 *
 *   GET  /templates                     catalogo de plantillas
 *   POST /templates/sync                sincronizar con Meta
 *
 *   GET  /numbers                       numeros WABA configurados
 *   GET  /numbers/:id/status            quality_rating en vivo
 *
 * Politica:
 *   - send-text valida que isWithin24hWindow(last_inbound_at) sea true.
 *   - Si esta fuera de ventana, fuerza el uso de send-template.
 *   - Cada envio se registra en wa_messages, communications (si hay caso)
 *     y agent_actions (auditoria).
 */

const db = require('../config/db');
const wa = require('../services/whatsapp.service');
const { hasOperationalScope } = require('../middleware/authz');

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

async function logWaAction({ actionType, conversationId, caseId, userId, params, result, status = 'executed', reversible = false }) {
  try {
    await db.query(
      `INSERT INTO agent_actions (action_type, case_id, user_id, params, result, status, reversible, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())`,
      [actionType, caseId || null, userId || null,
       JSON.stringify({ ...params, conversation_id: conversationId }),
       JSON.stringify(result || {}), status, reversible]
    );
  } catch (err) {
    console.error('[wa] logWaAction failed:', err.message);
  }
}

async function loadConversationOr404(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'id invalido' });
    return null;
  }
  const { rows } = await db.query(
    `SELECT c.*, p.display_phone AS our_phone, p.display_name AS our_name
       FROM wa_conversations c
       JOIN wa_phone_numbers p ON p.id = c.phone_number_id
      WHERE c.id = $1`,
    [id]
  );
  if (!rows.length) {
    res.status(404).json({ error: 'conversacion no encontrada' });
    return null;
  }
  return rows[0];
}

// ─────────────────────────────────────────────────────────────
// GET /conversations
// ─────────────────────────────────────────────────────────────

const listConversations = async (req, res) => {
  const {
    status = 'open',          // open | snoozed | closed | all
    assigned_to,              // userId numerico o 'me' o 'unassigned'
    case_id,
    has_case,                 // 'true' | 'false'
    has_client,
    search,                   // texto en contact_name o contact_phone
    limit = 50,
    offset = 0,
  } = req.query;

  const where = ['1=1'];
  const params = [];

  if (status !== 'all') {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }

  if (assigned_to === 'me') {
    params.push(req.user.id);
    where.push(`c.assigned_to = $${params.length}`);
  } else if (assigned_to === 'unassigned') {
    where.push('c.assigned_to IS NULL');
  } else if (assigned_to) {
    params.push(parseInt(assigned_to, 10));
    where.push(`c.assigned_to = $${params.length}`);
  }

  if (case_id) {
    params.push(parseInt(case_id, 10));
    where.push(`c.case_id = $${params.length}`);
  }

  if (has_case === 'true')  where.push('c.case_id IS NOT NULL');
  if (has_case === 'false') where.push('c.case_id IS NULL');
  if (has_client === 'true')  where.push('c.client_id IS NOT NULL');
  if (has_client === 'false') where.push('c.client_id IS NULL AND c.prospect_id IS NULL');

  if (search) {
    params.push(`%${String(search).toLowerCase()}%`);
    where.push(`(LOWER(c.contact_name) LIKE $${params.length} OR c.contact_phone LIKE $${params.length})`);
  }

  // Visibilidad por rol: operacionales ven todo, internos ven los suyos.
  if (!hasOperationalScope(req.user?.role)) {
    params.push(req.user.id);
    where.push(`(
      c.assigned_to = $${params.length}
      OR (c.case_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM cases _c LEFT JOIN macrocasos _m ON _c.macrocaso_id = _m.id
        WHERE _c.id = c.case_id
          AND (_c.assigned_to = $${params.length} OR _c.created_by = $${params.length} OR _m.lead_lawyer = $${params.length})
      ))
    )`);
  }

  params.push(Math.min(parseInt(limit, 10) || 50, 200));
  params.push(parseInt(offset, 10) || 0);

  const sql = `
    SELECT
      c.id, c.uuid, c.contact_phone, c.contact_name, c.status,
      c.unread_count, c.last_message_at, c.last_inbound_at, c.consent_status,
      c.client_id, c.prospect_id, c.case_id, c.assigned_to,
      cl.full_name AS client_name,
      ca.case_number,
      u.name AS assigned_name,
      (
        SELECT json_build_object(
          'id', m.id, 'direction', m.direction, 'message_type', m.message_type,
          'body', m.body, 'created_at', m.created_at
        )
        FROM wa_messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1
      ) AS last_message
    FROM wa_conversations c
    LEFT JOIN clients  cl ON cl.id = c.client_id
    LEFT JOIN cases    ca ON ca.id = c.case_id
    LEFT JOIN users    u  ON u.id  = c.assigned_to
    WHERE ${where.join(' AND ')}
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `;
  const { rows } = await db.query(sql, params);
  res.json({ conversations: rows, count: rows.length });
};

// ─────────────────────────────────────────────────────────────
// GET /conversations/:id
// ─────────────────────────────────────────────────────────────

const getConversation = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;
  res.json({
    conversation: conv,
    within_24h_window: wa.isWithin24hWindow(conv.last_inbound_at),
  });
};

// ─────────────────────────────────────────────────────────────
// GET /conversations/:id/messages
// ─────────────────────────────────────────────────────────────

const listMessages = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;

  const limit  = Math.min(parseInt(req.query.limit, 10)  || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const { rows } = await db.query(
    `SELECT id, uuid, wa_message_id, direction, message_type, body,
            media_url, media_mime, media_filename, media_caption,
            template_name, template_lang, template_variables,
            status, failure_reason, sent_by, related_communication_id,
            sent_at, delivered_at, read_at, created_at
       FROM wa_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3`,
    [conv.id, limit, offset]
  );

  res.json({ messages: rows.reverse(), count: rows.length });
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/read
// ─────────────────────────────────────────────────────────────

const markRead = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;
  await db.query('UPDATE wa_conversations SET unread_count = 0, updated_at = NOW() WHERE id = $1', [conv.id]);
  res.json({ ok: true });
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/assign
// ─────────────────────────────────────────────────────────────

const assignConversation = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;

  // El target sale del body, pero solo lo aceptamos en dos casos:
  //   - null/ausente → desasignar
  //   - igual a req.user.id → autoasignación (claim)
  //   - otro id → requiere rol operativo (admin/partner) y target activo + interno
  // Antes el body.user_id se aceptaba sin validar: cualquier interno podía asignar
  // conversaciones a abogados terceros, contaminando su bandeja.
  const rawTarget = req.body?.user_id;
  let targetId = null;
  if (rawTarget !== null && rawTarget !== undefined && rawTarget !== '') {
    const parsed = parseInt(String(rawTarget), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'user_id inválido' });
    }
    targetId = parsed;
  }

  if (targetId !== null && targetId !== req.user.id) {
    const isOperational = ['admin', 'partner'].includes(String(req.user.role || '').toLowerCase());
    if (!isOperational) {
      return res.status(403).json({
        error: 'Solo admin/partner pueden asignar a otro usuario. Puedes autoasignarte o desasignar.',
      });
    }
    const { rows } = await db.query(
      `SELECT id FROM users WHERE id = $1 AND active = TRUE
        AND COALESCE(account_category, 'internal') IN ('internal', 'admin', 'partner_lawyer')
       LIMIT 1`,
      [targetId]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Usuario destino no existe o no es interno activo' });
    }
  }

  await db.query(
    'UPDATE wa_conversations SET assigned_to = $1, updated_at = NOW() WHERE id = $2',
    [targetId, conv.id]
  );
  await logWaAction({
    actionType: 'whatsapp.assign',
    conversationId: conv.id,
    caseId: conv.case_id,
    userId: req.user.id,
    params: { assigned_to: targetId },
    reversible: true,
  });
  res.json({ ok: true });
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/link-case
// ─────────────────────────────────────────────────────────────

const linkCase = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;
  const caseId = parseInt(req.body?.case_id, 10);
  if (Number.isNaN(caseId)) return res.status(400).json({ error: 'case_id requerido' });

  // Validar que el caso existe
  const exists = await db.query('SELECT id, client_id FROM cases WHERE id = $1', [caseId]);
  if (!exists.rows.length) return res.status(404).json({ error: 'caso no existe' });

  await db.query(
    `UPDATE wa_conversations
        SET case_id = $1, client_id = COALESCE(client_id, $2), updated_at = NOW()
      WHERE id = $3`,
    [caseId, exists.rows[0].client_id, conv.id]
  );

  await logWaAction({
    actionType: 'whatsapp.link_case',
    conversationId: conv.id,
    caseId,
    userId: req.user.id,
    params: { case_id: caseId },
    reversible: true,
  });

  res.json({ ok: true });
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/link-client
// ─────────────────────────────────────────────────────────────

const linkClient = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;
  const clientId = parseInt(req.body?.client_id, 10);
  if (Number.isNaN(clientId)) return res.status(400).json({ error: 'client_id requerido' });

  await db.query(
    'UPDATE wa_conversations SET client_id = $1, updated_at = NOW() WHERE id = $2',
    [clientId, conv.id]
  );

  await logWaAction({
    actionType: 'whatsapp.link_client',
    conversationId: conv.id,
    caseId: conv.case_id,
    userId: req.user.id,
    params: { client_id: clientId },
    reversible: true,
  });

  res.json({ ok: true });
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/send-text
// ─────────────────────────────────────────────────────────────

const sendText = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;

  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'body requerido' });

  if (!wa.isWithin24hWindow(conv.last_inbound_at)) {
    return res.status(409).json({
      error: 'fuera_de_ventana_24h',
      message: 'Fuera de la ventana de 24h. Usa una plantilla aprobada para escribir.',
    });
  }

  if (!wa.isConfigured()) {
    return res.status(503).json({ error: 'wa_no_configurado', message: 'Falta configurar WHATSAPP_ACCESS_TOKEN o PHONE_NUMBER_ID en el entorno.' });
  }

  try {
    const { wa_message_id, raw } = await wa.sendText({ to: conv.contact_phone, body });

    const inserted = await db.query(
      `INSERT INTO wa_messages
         (conversation_id, wa_message_id, direction, message_type, body, status, sent_by, raw_payload)
       VALUES ($1, $2, 'outbound', 'text', $3, 'sent', $4, $5::jsonb)
       RETURNING *`,
      [conv.id, wa_message_id, body, req.user.id, JSON.stringify(raw || {})]
    );
    const messageRow = inserted.rows[0];

    await db.query(
      'UPDATE wa_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [conv.id]
    );

    if (conv.case_id) {
      const summary = `WhatsApp enviado a ${conv.contact_name || conv.contact_phone}: ${body.slice(0, 1000)}`;
      const comm = await db.query(
        `INSERT INTO communications (case_id, type, content, metadata, created_by)
         VALUES ($1, 'whatsapp', $2, $3::jsonb, $4)
         RETURNING id`,
        [conv.case_id, summary, JSON.stringify({
          wa_message_id, wa_conversation_id: conv.id, to: conv.contact_phone, message_type: 'text',
        }), req.user.id]
      );
      await db.query('UPDATE wa_messages SET related_communication_id = $1 WHERE id = $2', [comm.rows[0].id, messageRow.id]);
    }

    await logWaAction({
      actionType: 'whatsapp.send_text',
      conversationId: conv.id,
      caseId: conv.case_id,
      userId: req.user.id,
      params: { to: conv.contact_phone, body_preview: body.slice(0, 200) },
      result: { wa_message_id },
      reversible: false,
    });

    res.json({ ok: true, message: messageRow });
  } catch (err) {
    console.error('[wa] sendText failed:', err);
    res.status(502).json({ error: 'envio_fallido', message: err.message, code: err.code || null });
  }
};

// ─────────────────────────────────────────────────────────────
// POST /conversations/:id/send-template
// ─────────────────────────────────────────────────────────────

const sendTemplate = async (req, res) => {
  const conv = await loadConversationOr404(req, res);
  if (!conv) return;

  const { template_name, language = 'es', body_variables = [], header_variables = null, button_variables = null } = req.body || {};
  if (!template_name) return res.status(400).json({ error: 'template_name requerido' });

  if (!wa.isConfigured()) {
    return res.status(503).json({ error: 'wa_no_configurado' });
  }

  // Validar plantilla local (debe estar approved)
  const tmpl = await db.query(
    'SELECT * FROM wa_templates WHERE name = $1 AND language = $2',
    [template_name, language]
  );
  if (!tmpl.rows.length) {
    return res.status(404).json({ error: 'plantilla no encontrada en catalogo local' });
  }
  if (tmpl.rows[0].status !== 'approved') {
    return res.status(409).json({
      error: 'plantilla_no_aprobada',
      message: `La plantilla esta en estado ${tmpl.rows[0].status}. Solo plantillas APPROVED se pueden enviar.`,
    });
  }

  try {
    const { wa_message_id, raw } = await wa.sendTemplate({
      to: conv.contact_phone,
      templateName: template_name,
      languageCode: language,
      bodyVariables: body_variables,
      headerVariables: header_variables,
      buttonVariables: button_variables,
    });

    const inserted = await db.query(
      `INSERT INTO wa_messages
         (conversation_id, wa_message_id, direction, message_type, body,
          template_name, template_lang, template_variables, status, sent_by, raw_payload)
       VALUES ($1, $2, 'outbound', 'template', $3, $4, $5, $6::jsonb, 'sent', $7, $8::jsonb)
       RETURNING *`,
      [conv.id, wa_message_id, renderTemplatePreview(tmpl.rows[0].body, body_variables),
       template_name, language, JSON.stringify(body_variables || []),
       req.user.id, JSON.stringify(raw || {})]
    );
    const messageRow = inserted.rows[0];

    await db.query(
      'UPDATE wa_conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1',
      [conv.id]
    );

    if (conv.case_id) {
      const summary = `WhatsApp [plantilla ${template_name}] enviada a ${conv.contact_name || conv.contact_phone}`;
      const comm = await db.query(
        `INSERT INTO communications (case_id, type, content, metadata, created_by)
         VALUES ($1, 'whatsapp', $2, $3::jsonb, $4)
         RETURNING id`,
        [conv.case_id, summary, JSON.stringify({
          wa_message_id, wa_conversation_id: conv.id, to: conv.contact_phone,
          message_type: 'template', template_name, body_variables,
        }), req.user.id]
      );
      await db.query('UPDATE wa_messages SET related_communication_id = $1 WHERE id = $2', [comm.rows[0].id, messageRow.id]);
    }

    await logWaAction({
      actionType: 'whatsapp.send_template',
      conversationId: conv.id,
      caseId: conv.case_id,
      userId: req.user.id,
      params: { template_name, language, body_variables },
      result: { wa_message_id },
      reversible: false,
    });

    res.json({ ok: true, message: messageRow });
  } catch (err) {
    console.error('[wa] sendTemplate failed:', err);
    res.status(502).json({ error: 'envio_fallido', message: err.message, code: err.code || null });
  }
};

function renderTemplatePreview(body, variables) {
  let out = String(body || '');
  (variables || []).forEach((v, idx) => {
    out = out.replace(new RegExp(`\\{\\{${idx + 1}\\}\\}`, 'g'), String(v));
  });
  return out;
}

// ─────────────────────────────────────────────────────────────
// GET /templates
// ─────────────────────────────────────────────────────────────

const listTemplates = async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, name, category, language, body, variables, status, meta_template_id, use_case, updated_at
       FROM wa_templates ORDER BY name, language`
  );
  res.json({ templates: rows });
};

// ─────────────────────────────────────────────────────────────
// POST /templates/sync — sincroniza estados desde Meta
// ─────────────────────────────────────────────────────────────

const syncTemplatesFromMeta = async (req, res) => {
  if (!wa.isConfigured()) return res.status(503).json({ error: 'wa_no_configurado' });
  try {
    const meta = await wa.listMetaTemplates();
    const items = meta?.data || [];
    let updated = 0;
    for (const t of items) {
      const status = String(t.status || '').toLowerCase();        // approved | pending | rejected | paused | disabled
      const language = t.language || 'es';
      const result = await db.query(
        `UPDATE wa_templates
            SET status = $1, meta_template_id = $2, rejection_reason = $3, updated_at = NOW()
          WHERE name = $4 AND language = $5`,
        [status, t.id || null, t.rejected_reason || null, t.name, language]
      );
      if (result.rowCount === 0) {
        // Plantilla en Meta que no existe localmente: insertar como referencia
        await db.query(
          `INSERT INTO wa_templates (name, category, language, body, status, meta_template_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (name, language) DO NOTHING`,
          [t.name, (t.category || 'UTILITY').toUpperCase(), language,
           extractTemplateBody(t), status, t.id || null]
        );
      }
      updated++;
    }
    res.json({ ok: true, synced: updated, total: items.length });
  } catch (err) {
    console.error('[wa] syncTemplates failed:', err);
    res.status(502).json({ error: 'sync_fallido', message: err.message });
  }
};

function extractTemplateBody(metaTemplate) {
  const components = metaTemplate?.components || [];
  const body = components.find((c) => String(c.type).toUpperCase() === 'BODY');
  return body?.text || '';
}

// ─────────────────────────────────────────────────────────────
// GET /numbers — lista de numeros WABA
// ─────────────────────────────────────────────────────────────

const listNumbers = async (req, res) => {
  const { rows } = await db.query('SELECT * FROM wa_phone_numbers ORDER BY id');
  res.json({ numbers: rows, configured: wa.isConfigured() });
};

const getNumberStatus = async (req, res) => {
  if (!wa.isConfigured()) return res.status(503).json({ error: 'wa_no_configurado' });
  try {
    const status = await wa.getPhoneNumberStatus();
    // Sincroniza el quality_rating en BD
    if (status?.quality_rating) {
      await db.query(
        'UPDATE wa_phone_numbers SET quality_rating = $1, updated_at = NOW() WHERE phone_number_id = $2',
        [status.quality_rating, wa.getConfig().phoneNumberId]
      );
    }
    res.json({ status });
  } catch (err) {
    res.status(502).json({ error: 'status_fallido', message: err.message });
  }
};

module.exports = {
  listConversations,
  getConversation,
  listMessages,
  markRead,
  assignConversation,
  linkCase,
  linkClient,
  sendText,
  sendTemplate,
  listTemplates,
  syncTemplatesFromMeta,
  listNumbers,
  getNumberStatus,
};
