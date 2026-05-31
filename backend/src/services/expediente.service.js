/**
 * expediente.service.js
 * ─────────────────────────────────────────────────────────────
 * Expediente Vivo (plan-estrategico §7.7).
 *
 * Una vista del caso como grafo operativo: correos, documentos,
 * actuaciones, vencimientos, tareas y borradores con sus relaciones,
 * en vez de listas planas.
 *
 * Devuelve { nodes, edges, summary }:
 *   - nodes: cada entidad con tipo, título, fecha, estado, refs
 *   - edges: relaciones tipadas (origin -> derived; produces; references)
 *   - summary: conteos por tipo para overlays
 *
 * Lectura solo. No muta nada.
 */

const db = require('../config/db');

async function getExpediente(caseId) {
  const [
    caseRow,
    communications,
    documents,
    actuaciones,
    vencimientos,
    tareas,
    cpnuActuaciones,
  ] = await Promise.all([
    loadCase(caseId),
    loadCommunications(caseId),
    loadDocuments(caseId),
    loadActuaciones(caseId),
    loadVencimientos(caseId),
    loadTareas(caseId),
    loadCpnuActuaciones(caseId),
  ]);

  if (!caseRow) return null;

  const nodes = [
    ...communications.map(commToNode),
    ...documents.map(docToNode),
    ...actuaciones.map(actuacionToNode),
    ...vencimientos.map(vencimientoToNode),
    ...tareas.map(tareaToNode),
    ...cpnuActuaciones.map(cpnuActuacionToNode),
  ];

  // Ordenar por timestamp descendente (lo más reciente primero)
  nodes.sort((a, b) => timeOf(b) - timeOf(a));

  // Edges: relaciones explícitas que se pueden inferir
  const edges = buildEdges({ tareas, vencimientos, actuaciones, communications });

  // Summary por tipo
  const summary = nodes.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] || 0) + 1;
    return acc;
  }, {});

  return {
    case: {
      id: caseRow.id,
      case_number: caseRow.case_number,
      title: caseRow.title,
    },
    nodes,
    edges,
    summary,
    total_nodes: nodes.length,
    generated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────

async function loadCase(caseId) {
  const { rows } = await db.query(`SELECT id, case_number, title FROM cases WHERE id = $1`, [caseId]);
  return rows[0] || null;
}

async function loadCommunications(caseId) {
  const { rows } = await db.query(
    `SELECT id, type, content, metadata, created_at, created_by
       FROM communications
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT 100`,
    [caseId]
  );
  return rows;
}

async function loadDocuments(caseId) {
  try {
    const { rows } = await db.query(
      `SELECT id, name, drive_file_id, drive_file_url, file_type, file_size, created_at, metadata
         FROM documents
        WHERE case_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [caseId]
    );
    return rows;
  } catch {
    // fallback si el schema difiere
    const { rows } = await db.query(
      `SELECT id, name, created_at FROM documents WHERE case_id = $1 LIMIT 100`,
      [caseId]
    );
    return rows;
  }
}

async function loadActuaciones(caseId) {
  const { rows } = await db.query(
    `SELECT id, type, title, description, scheduled_at, completed_at, result, radicado, created_at
       FROM actuaciones
      WHERE case_id = $1
      ORDER BY COALESCE(completed_at, scheduled_at, created_at) DESC
      LIMIT 100`,
    [caseId]
  );
  return rows;
}

async function loadVencimientos(caseId) {
  const { rows } = await db.query(
    `SELECT id, title, due_date, urgency, resolved, created_at
       FROM vencimientos
      WHERE case_id = $1
      ORDER BY due_date DESC NULLS LAST
      LIMIT 100`,
    [caseId]
  );
  return rows;
}

async function loadTareas(caseId) {
  try {
    const { rows } = await db.query(
      `SELECT id, title, description, priority, status, due_date, actuacion_id, communication_id, created_at
         FROM tareas
        WHERE case_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [caseId]
    );
    return rows;
  } catch {
    const { rows } = await db.query(
      `SELECT id, title, priority, status, due_date, created_at
         FROM tareas WHERE case_id = $1 LIMIT 100`,
      [caseId]
    );
    return rows;
  }
}

async function loadCpnuActuaciones(caseId) {
  try {
    const { rows } = await db.query(
      `SELECT a.id, a.fecha_actuacion, a.fecha_registro, a.actuacion, a.anotacion, a.is_new,
              l.platform_key, l.external_process_number
         FROM judicial_actuaciones a
         JOIN judicial_case_links l ON l.id = a.case_link_id
        WHERE l.case_id = $1
        ORDER BY a.fecha_actuacion DESC NULLS LAST, a.id DESC
        LIMIT 60`,
      [caseId]
    );
    return rows;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// Mappers (entity → node)
// ─────────────────────────────────────────────────────────────

function commToNode(c) {
  const meta = typeof c.metadata === 'string' ? safeJson(c.metadata) : (c.metadata || {});
  const isGmail = c.type === 'email' && meta.source === 'gmail';
  return {
    id: `comm:${c.id}`,
    raw_id: c.id,
    type: isGmail ? 'email' : (c.type || 'note'),
    icon: isGmail ? '✉' : 'N',
    title: meta.subject || truncate(c.content, 70),
    summary: isGmail
      ? `De ${meta.from || 'desconocido'} · ${truncate(c.content, 140)}`
      : truncate(c.content, 200),
    timestamp: c.created_at,
    status: null,
    refs: {
      from: meta.from || null,
      gmail_thread_id: meta.gmail_thread_id || null,
    },
  };
}

function docToNode(d) {
  return {
    id: `doc:${d.id}`,
    raw_id: d.id,
    type: 'document',
    icon: 'D',
    title: d.name,
    summary: d.file_type ? `${d.file_type}${d.file_size ? ` · ${formatBytes(d.file_size)}` : ''}` : 'Documento',
    timestamp: d.created_at,
    status: null,
    refs: {
      drive_url: d.drive_file_url || null,
    },
  };
}

function actuacionToNode(a) {
  const status = a.completed_at ? 'completada' : (a.scheduled_at ? 'agendada' : 'sin_agenda');
  return {
    id: `actuacion:${a.id}`,
    raw_id: a.id,
    type: 'actuacion',
    icon: 'A',
    title: a.title,
    summary: a.description ? truncate(a.description, 200) : (a.type || 'Actuación'),
    timestamp: a.completed_at || a.scheduled_at || a.created_at,
    status,
    refs: {
      radicado: a.radicado || null,
    },
  };
}

function vencimientoToNode(v) {
  return {
    id: `vencimiento:${v.id}`,
    raw_id: v.id,
    type: 'vencimiento',
    icon: '⏰',
    title: v.title,
    summary: 'Vencimiento procesal',
    timestamp: v.due_date || v.created_at,
    status: v.resolved ? 'resuelto' : 'abierto',
    urgency: v.urgency,
    refs: {},
  };
}

function tareaToNode(t) {
  return {
    id: `tarea:${t.id}`,
    raw_id: t.id,
    type: 'tarea',
    icon: '☐',
    title: t.title,
    summary: t.description ? truncate(t.description, 200) : `Prioridad ${t.priority || 'MEDIA'}`,
    timestamp: t.due_date || t.created_at,
    status: t.status,
    priority: t.priority,
    refs: {
      actuacion_id: t.actuacion_id || null,
      communication_id: t.communication_id || null,
    },
  };
}

function cpnuActuacionToNode(a) {
  return {
    id: `cpnu:${a.id}`,
    raw_id: a.id,
    type: 'cpnu_actuacion',
    icon: '◈',
    title: a.actuacion,
    summary: a.anotacion ? truncate(a.anotacion, 200) : `Actuación externa · ${a.platform_key.toUpperCase()}`,
    timestamp: a.fecha_actuacion || a.fecha_registro,
    status: a.is_new ? 'nueva' : 'vista',
    refs: {
      radicado: a.external_process_number || null,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Edges
// ─────────────────────────────────────────────────────────────

function buildEdges({ tareas, actuaciones, vencimientos, communications }) {
  const edges = [];

  // Tarea → Actuación (link FK explícito)
  for (const t of tareas) {
    if (t.actuacion_id) {
      edges.push({ from: `tarea:${t.id}`, to: `actuacion:${t.actuacion_id}`, kind: 'derived_from' });
    }
    if (t.communication_id) {
      edges.push({ from: `tarea:${t.id}`, to: `comm:${t.communication_id}`, kind: 'origin' });
    }
  }

  // Vencimiento → Actuación por radicado coincidente (best effort)
  for (const v of vencimientos) {
    const titleLower = String(v.title || '').toLowerCase();
    const linked = actuaciones.find((a) => {
      if (!a.title) return false;
      const aTitle = String(a.title).toLowerCase();
      return titleLower.includes(aTitle.slice(0, 12)) || aTitle.includes(titleLower.slice(0, 12));
    });
    if (linked) {
      edges.push({ from: `vencimiento:${v.id}`, to: `actuacion:${linked.id}`, kind: 'references' });
    }
  }

  // Communication → Document (si metadata referencia el doc — heurística simple)
  for (const c of communications) {
    const meta = typeof c.metadata === 'string' ? safeJson(c.metadata) : (c.metadata || {});
    if (Array.isArray(meta.linked_document_ids)) {
      for (const docId of meta.linked_document_ids) {
        edges.push({ from: `comm:${c.id}`, to: `doc:${docId}`, kind: 'attachment' });
      }
    }
  }

  return edges;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function timeOf(node) {
  if (!node.timestamp) return 0;
  const t = new Date(node.timestamp).getTime();
  return Number.isFinite(t) ? t : 0;
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function safeJson(s) {
  try { return JSON.parse(s); } catch { return {}; }
}

function formatBytes(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '';
  if (x < 1024) return `${x} B`;
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
  return `${(x / 1024 / 1024).toFixed(1)} MB`;
}

module.exports = { getExpediente };
