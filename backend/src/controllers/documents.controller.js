/**
 * documents.controller.js
 * ─────────────────────────────────────────────────────────────
 * Plantillas jurídicas (document_templates) y documentos
 * redactados (documents). El agente (MCP) puede:
 *   - Listar plantillas activas.
 *   - Redactar un documento a partir de una plantilla + caso.
 *   - Leer documentos de un caso.
 *   - Actualizar / cambiar estado (solo humano debería pasar a
 *     'firmado' o 'enviado', pero el endpoint no lo fuerza —
 *     la Constitución § VI exige revisión previa).
 *
 * Renderizado: sustitución literal de {{variable}}.
 * Sin ejecución de código. Si falta una variable requerida,
 * se devuelve 400 con la lista.
 */

const db = require('../config/db');
const crypto = require('crypto');
const { hasOperationalScope } = require('../middleware/authz');
const googleWorkspace = require('../modules/google-workspace/googleWorkspace.service');

const VALID_STATUSES = ['borrador', 'revision', 'firmado', 'enviado', 'archivado'];
const MUTABLE_TEXT_FIELDS = ['title', 'body'];

function buildDocumentAccessFilter(user, offset = 1) {
  if (hasOperationalScope(user?.role)) return { clause: '', params: [], next: offset };

  const role = String(user?.role || '').toLowerCase();
  if (role === 'client') {
    return {
      clause: `(d.created_by = $${offset} OR (d.case_id IS NOT NULL AND LOWER(cl.email) = LOWER($${offset + 1})))`,
      params: [user.id, user.email || ''],
      next: offset + 2,
    };
  }

  return {
    clause: `(d.created_by = $${offset} OR (
      d.case_id IS NOT NULL
      AND (cs.assigned_to = $${offset + 1} OR cs.created_by = $${offset + 2} OR _m.lead_lawyer = $${offset + 3})
    ))`,
    params: [user.id, user.id, user.id, user.id],
    next: offset + 4,
  };
}

async function getAccessibleDocument(id, user, fields = 'd.*') {
  const access = buildDocumentAccessFilter(user, 2);
  const { rows } = await db.query(
    `SELECT ${fields},
            cs.case_number,
            cs.title AS case_title
       FROM documents d
       LEFT JOIN cases cs ON cs.id = d.case_id
       LEFT JOIN clients cl ON cl.id = cs.client_id
       LEFT JOIN macrocasos _m ON cs.macrocaso_id = _m.id
      WHERE d.id = $1
        ${access.clause ? `AND ${access.clause}` : ''}
      LIMIT 1`,
    [id, ...access.params]
  );
  return rows[0] || null;
}

// ─── Renderizado ──────────────────────────────────────────────

function renderTemplate(body, variables) {
  // Reemplaza todas las apariciones de {{name}} por variables[name].
  // Si name no está en variables, deja el marcador para que el abogado
  // lo note al revisar. No interpreta ninguna otra sintaxis.
  return String(body).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, name) => {
    const v = variables[name];
    return v === undefined || v === null ? match : String(v);
  });
}

function collectMissingRequired(templateVars, providedValues) {
  const missing = [];
  for (const spec of Array.isArray(templateVars) ? templateVars : []) {
    if (spec.required && (providedValues[spec.name] === undefined || providedValues[spec.name] === null || providedValues[spec.name] === '')) {
      missing.push(spec.name);
    }
  }
  return missing;
}

// Contexto auto-derivado desde el caso, cliente y usuario.
// El usuario puede sobreescribir cualquiera pasando la variable explícitamente.
async function buildCaseContext(caseId, userId) {
  const { rows } = await db.query(
    `SELECT c.id, c.case_number, c.title, c.entity, c.jurisdiction, c.service_type,
            cl.full_name   AS client_name,
            cl.document_type AS client_doc_type,
            cl.document_number AS client_doc,
            cl.email       AS client_email,
            cl.phone       AS client_phone,
            cl.city        AS client_city,
            u.name         AS lawyer_name,
            u.email        AS lawyer_email
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users   u  ON u.id  = $2
      WHERE c.id = $1
      LIMIT 1`,
    [caseId, userId]
  );
  return rows[0] || null;
}

function autoVariablesFromContext(ctx) {
  if (!ctx) return {};
  const today = new Date();
  const fechaEs = today.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
  return {
    radicado:             ctx.case_number || '',
    titulo_caso:          ctx.title || '',
    accionante:           ctx.client_name || '',
    accionado:            ctx.entity || '',
    nombre_cliente:       ctx.client_name || '',
    tipo_documento_cliente: ctx.client_doc_type || 'C.C.',
    documento_cliente:    ctx.client_doc || '',
    correo_cliente:       ctx.client_email || '',
    telefono_cliente:     ctx.client_phone || '',
    ciudad_cliente:       ctx.client_city || '',
    nombre_abogado:       ctx.lawyer_name || '',
    correo_abogado:       ctx.lawyer_email || '',
    fecha:                fechaEs,
  };
}

// ─── Handlers ─────────────────────────────────────────────────

async function listTemplates(req, res) {
  const { service_type, jurisdiction, active } = req.query;
  const conditions = [];
  const params = [];
  let i = 1;
  if (service_type) { conditions.push(`service_type = $${i++}`); params.push(service_type); }
  if (jurisdiction) { conditions.push(`jurisdiction = $${i++}`); params.push(jurisdiction); }
  if (active === undefined || active === 'true') conditions.push(`active = TRUE`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await db.query(
      `SELECT id, code, name, description, variables, service_type, jurisdiction, active, updated_at
         FROM document_templates
         ${where}
         ORDER BY name`,
      params
    );
    res.json({ templates: rows });
  } catch (err) {
    console.error('[documents] listTemplates error:', err);
    res.status(500).json({ error: 'Error listando plantillas' });
  }
}

async function getTemplate(req, res) {
  const { code } = req.params;
  try {
    const { rows } = await db.query(
      `SELECT * FROM document_templates WHERE code = $1 LIMIT 1`,
      [code]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plantilla no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function draftDocument(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });

  const { template_code, variables: userVars, title } = req.body || {};
  if (!template_code) return res.status(400).json({ error: 'template_code es requerido' });

  try {
    const { rows: tplRows } = await db.query(
      `SELECT id, code, name, body, variables
         FROM document_templates
        WHERE code = $1 AND active = TRUE
        LIMIT 1`,
      [template_code]
    );
    const tpl = tplRows[0];
    if (!tpl) return res.status(404).json({ error: `Plantilla '${template_code}' no encontrada o inactiva` });

    const ctx = await buildCaseContext(caseId, req.user.id);
    if (!ctx) return res.status(404).json({ error: 'Caso no encontrado' });

    // Orden de precedencia: defaults plantilla < auto contexto < usuario
    const defaults = {};
    for (const spec of Array.isArray(tpl.variables) ? tpl.variables : []) {
      if (spec.default !== undefined && spec.default !== null) defaults[spec.name] = spec.default;
    }
    const auto = autoVariablesFromContext(ctx);
    const merged = { ...defaults, ...auto, ...(userVars && typeof userVars === 'object' ? userVars : {}) };

    const missing = collectMissingRequired(tpl.variables, merged);

    const rendered = renderTemplate(tpl.body, merged);
    const computedTitle = title && String(title).trim()
      ? String(title).trim()
      : `${tpl.name} — ${ctx.case_number || caseId}`;

    const { rows: docRows } = await db.query(
      `INSERT INTO documents (
          case_id, name, title, template_id, body, variables,
          status, document_type, created_by, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'borrador', $7, $8, NOW(), NOW())
        RETURNING id, case_id, name, title, template_id, body, variables, status, document_type, created_at, updated_at`,
      [
        caseId,
        computedTitle.slice(0, 255),
        computedTitle.slice(0, 500),
        tpl.id,
        rendered,
        JSON.stringify(merged),
        tpl.code,
        req.user.id,
      ]
    );

    res.status(201).json({
      document: docRows[0],
      template: { code: tpl.code, name: tpl.name },
      missing_required: missing,
      message: missing.length
        ? `Borrador creado con ${missing.length} variable(s) requerida(s) sin valor: ${missing.join(', ')}. Revisa el documento antes de firmar.`
        : 'Borrador creado. Revísalo antes de firmar o enviar.',
    });
  } catch (err) {
    console.error('[documents] draftDocument error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function listCaseDocuments(req, res) {
  const caseId = Number(req.params.caseId);
  if (!caseId) return res.status(400).json({ error: 'caseId inválido' });
  try {
    const { rows } = await db.query(
      `SELECT id, case_id, name, title, template_id, document_type, status,
              drive_file_id, created_by, created_at, updated_at
         FROM documents
        WHERE case_id = $1
        ORDER BY created_at DESC, id DESC`,
      [caseId]
    );
    res.json({ documents: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getDocument(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  try {
    const doc = await getAccessibleDocument(id, req.user);
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateDocument(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });

  const body = req.body || {};
  const sets = [];
  const params = [];
  let i = 1;

  for (const field of MUTABLE_TEXT_FIELDS) {
    if (body[field] !== undefined) {
      sets.push(`${field} = $${i++}`);
      params.push(body[field]);
    }
  }
  if (body.variables !== undefined && typeof body.variables === 'object') {
    sets.push(`variables = $${i++}::jsonb`);
    params.push(JSON.stringify(body.variables));
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return res.status(400).json({ error: `status inválido. Permitidos: ${VALID_STATUSES.join(', ')}` });
    }
    sets.push(`status = $${i++}`);
    params.push(body.status);
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  sets.push(`updated_at = NOW()`);
  params.push(id);

  try {
    const allowed = await getAccessibleDocument(id, req.user, 'd.id');
    if (!allowed) return res.status(404).json({ error: 'Documento no encontrado' });

    const { rows } = await db.query(
      `UPDATE documents SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    if (!rows[0]) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function exportDocumentToDrive(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { subfolder, filename } = req.body || {};

  try {
    const allowed = await getAccessibleDocument(id, req.user, 'd.id');
    if (!allowed) return res.status(404).json({ error: 'Documento no encontrado' });

    const result = await googleWorkspace.exportDocumentToDrive({
      userId: req.user.id,
      documentId: id,
      subfolderName: subfolder === null ? null : (subfolder || '06_Borradores'),
      filename,
    });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === 'DOC_NOT_FOUND')            return res.status(404).json({ error: err.message });
    if (err.code === 'CASE_DRIVE_NOT_ORGANIZED') return res.status(409).json({ error: err.message, code: err.code });
    if (err.code === 'GOOGLE_NOT_CONNECTED' || err.code === 'GOOGLE_NOT_CONFIGURED') {
      return res.status(409).json({ error: err.message, code: err.code });
    }
    console.error('[documents] exportDocumentToDrive error:', err);
    res.status(500).json({ error: err.message });
  }
}

async function markDocumentSigned(req, res) {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'id inválido' });
  const { signer_name, signer_document, method, signed_at } = req.body || {};
  if (!signer_name) return res.status(400).json({ error: 'signer_name es requerido' });

  try {
    const doc = await getAccessibleDocument(id, req.user, 'd.id, d.body, d.status');
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    // Hash del body congelado al momento de firmar — trazabilidad.
    const bodyHash = crypto
      .createHash('sha256')
      .update(String(doc.body || ''))
      .digest('hex');

    const signedAtIso = signed_at ? new Date(signed_at).toISOString() : new Date().toISOString();

    const { rows } = await db.query(
      `UPDATE documents
          SET status = 'firmado',
              signed_at = $2,
              updated_at = NOW(),
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $1
      RETURNING *`,
      [
        id,
        signedAtIso,
        JSON.stringify({
          signature: {
            signer_name,
            signer_document: signer_document || null,
            method: method || 'registro-logico',
            body_sha256: bodyHash,
            signed_at: signedAtIso,
            recorded_by_user_id: req.user.id,
          },
        }),
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[documents] markDocumentSigned error:', err);
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  listTemplates,
  getTemplate,
  draftDocument,
  listCaseDocuments,
  getDocument,
  updateDocument,
  exportDocumentToDrive,
  markDocumentSigned,
};
