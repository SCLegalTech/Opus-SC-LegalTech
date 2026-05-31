const db = require('../config/db');
const { buildCasesFilter } = require('../middleware/authz');
const { analyzeCase } = require('./caseIntelligence.service');
const { runProactiveSweep } = require('./proactiveAgent.service');

function getDataApiBaseUrl() {
  if (process.env.AGENT_DATA_API_BASE_URL) {
    return String(process.env.AGENT_DATA_API_BASE_URL).replace(/\/$/, '');
  }
  if (String(process.env.PORT || '4000') !== '4000') {
    return 'http://127.0.0.1:4000/api';
  }
  return null;
}

async function fetchPlatformJson(pathname, authorizationHeader, { method = 'GET', body, timeoutMs = 15000 } = {}) {
  const baseUrl = getDataApiBaseUrl();
  if (!baseUrl) return null;

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(authorizationHeader ? { Authorization: authorizationHeader } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Platform API ${response.status}: ${text}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function latestUserMessage(messages = []) {
  return [...messages].reverse().find((message) => message?.role === 'user' && message?.content?.trim()) || null;
}

function latestAssistantMessage(messages = []) {
  return [...messages].reverse().find((message) => message?.role === 'assistant' && message?.content?.trim()) || null;
}

function formatDate(value) {
  if (!value) return 'sin fecha';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatCaseLabel(row) {
  return `${row.case_number} | ${row.title} | ${row.client_name || 'sin cliente'} | ${row.status || 'sin estado'}`;
}

function extractCaseHints(text, { forceRawHint = false } = {}) {
  const raw = String(text || '').trim();
  const hints = new Set();
  const caseNumber = raw.match(/\bSC-\d{4}-\d{3,6}\b/i);
  if (caseNumber) hints.add(caseNumber[0]);

  const patterns = [
    /(?:caso|expediente)\s+(?:de|del|sobre)?\s*([a-z0-9][^.,;\n]+)/i,
    /(?:revisa|revisemos|analiza|analicemos|prioriza|prioricemos)\s+(?:el\s+)?(?:caso|expediente)\s+(?:de|del|sobre)?\s*([a-z0-9][^.,;\n]+)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    let candidate = match[1]
      .replace(/\b(para|con|y|que|por favor|porfa|porfis|gracias)\b.*$/i, '')
      .trim();
    if (candidate.length >= 2) hints.add(candidate);
  }

  if (forceRawHint) {
    const candidate = raw
      .replace(/^(?:es|es el|es la|se llama|cliente|del cliente|caso de|el caso de|expediente de)\s+/i, '')
      .replace(/[.?!]+$/g, '')
      .trim();
    if (candidate.length >= 2) hints.add(candidate);
  }

  return [...hints];
}

async function findCasesByHint(user, hint, limit = 5, authorizationHeader = null) {
  const apiBase = getDataApiBaseUrl();
  if (apiBase && authorizationHeader) {
    const params = new URLSearchParams({
      search: String(hint || '').trim(),
      limit: String(limit),
    });
    const payload = await fetchPlatformJson(`/cases?${params.toString()}`, authorizationHeader);
    return Array.isArray(payload?.cases) ? payload.cases : [];
  }

  const scope = buildCasesFilter(user.id, user.role, 1);
  const params = [...scope.params];
  let index = scope.next;
  const normalizedHint = String(hint || '').trim();
  const where = [];

  if (scope.clause) where.push(scope.clause);

  if (/^SC-\d{4}-\d{3,6}$/i.test(normalizedHint)) {
    where.push(`c.case_number ILIKE $${index++}`);
    params.push(normalizedHint);
  } else {
    where.push(`(
      c.case_number ILIKE $${index}
      OR c.title ILIKE $${index + 1}
      OR cl.full_name ILIKE $${index + 2}
    )`);
    params.push(`%${normalizedHint}%`, `%${normalizedHint}%`, `%${normalizedHint}%`);
    index += 3;
  }

  params.push(limit);

  const { rows } = await db.query(
    `SELECT
       c.id,
       c.uuid,
       c.case_number,
       c.title,
       c.status,
       c.service_type,
       cl.full_name AS client_name
     FROM cases c
     LEFT JOIN clients cl ON cl.id = c.client_id
     WHERE ${where.length ? where.join(' AND ') : '1=1'}
     ORDER BY c.updated_at DESC, c.id DESC
     LIMIT $${index}`,
    params
  );

  return rows;
}

async function resolveCaseContext(user, text, artifacts = [], authorizationHeader = null, options = {}) {
  const caseArtifact = artifacts.find((artifact) => artifact?.type === 'case' && artifact?.id);
  if (caseArtifact) {
    return {
      kind: 'resolved',
      caseId: String(caseArtifact.id),
      source: 'artifact',
    };
  }

  const hints = extractCaseHints(text, options);
  for (const hint of hints) {
    const matches = await findCasesByHint(user, hint, 5, authorizationHeader);
    if (matches.length === 1) {
      return {
        kind: 'resolved',
        caseId: String(matches[0].id),
        source: 'search',
      };
    }
    if (matches.length > 1) {
      return {
        kind: 'ambiguous',
        hint,
        matches,
      };
    }
  }

  return { kind: 'none' };
}

function userIsClarifyingCase(messages = [], text = '') {
  const previousAssistant = latestAssistantMessage(messages);
  if (!previousAssistant?.content) return false;

  const previousNormalized = normalizeText(previousAssistant.content);
  const current = String(text || '').trim();
  if (!current || current.length > 80) return false;

  return previousNormalized.includes('dime el numero sc-')
    || previousNormalized.includes('arrastra el expediente')
    || previousNormalized.includes('no logre identificar cual es');
}

// Escanea el historial para saber si ya entregamos una lectura operativa del
// mismo caso. Si ya la dimos, turnos siguientes deben pasar al loop de Gemini
// (que tiene las herramientas `propose_*`) en vez de repetir el brief.
function caseAlreadyBriefedInHistory(messages = [], caseRecord = null) {
  const caseNumber = caseRecord?.case_number;
  if (!caseNumber) return false;
  const normalizedCaseNumber = normalizeText(caseNumber);

  return messages.some((message) => {
    if (message?.role !== 'assistant') return false;
    const content = String(message?.content || '');
    if (!content) return false;
    const normalizedContent = normalizeText(content);
    // Firma distintiva de formatCaseReview()
    return normalizedContent.includes(`revise el caso ${normalizedCaseNumber}`);
  });
}

// El usuario pide explicitamente un brief/re-brief (vs. una accion de seguimiento)
function isExplicitBriefRequest(normalized) {
  return (
    normalized.includes('dame el brief')
    || normalized.includes('brief del')
    || normalized.includes('brief de ')
    || normalized.includes('dame un brief')
    || normalized.includes('dame una lectura')
    || normalized.includes('lectura operativa')
    || normalized.includes('revision operativa')
    || normalized.includes('revisa de nuevo')
    || normalized.includes('revisemos de nuevo')
    || normalized.includes('analiza de nuevo')
    || normalized.includes('actualiza el diagnostic')
    || normalized.includes('actualiza el analisis')
    || normalized.includes('resumen del caso')
    || normalized.includes('resumen del expediente')
  );
}

// Detecta pedidos de accion concreta (crear tareas, actualizar caso, etc.)
// donde debemos dejar que Gemini use sus herramientas en vez de repetir el brief.
function looksLikeFollowUpAction(normalized) {
  // Verbos de accion que indican "hazlo", no "explicame"
  const actionVerbs = [
    'agrega', 'agregar', 'agregame', 'agregale',
    'crea', 'crear', 'creame',
    'pon', 'poner', 'ponle',
    'registra', 'registrar',
    'anota', 'anotar', 'anotame',
    'actualiza', 'actualizar', 'actualizame',
    'ajusta', 'ajustar', 'ajustame',
    'modifica', 'modificar',
    'cambia', 'cambiar',
    'mueve', 'mover',
    'marca', 'marcar',
    'completa', 'completar',
    'cierra una tarea', 'cerrar tarea',
    'redacta', 'redactar',
    'prepara', 'preparar',
    'envia', 'enviar', 'manda', 'mandar',
    'propon', 'proponer',
    'sube', 'subir', 'baja', 'bajar', // prioridad
  ];

  // Sustantivos que indican objeto operativo
  const operativeNouns = [
    'tarea', 'nota', 'recordatorio',
    'vencimiento', 'plazo', 'fecha',
    'siguiente accion', 'next action',
    'estado', 'prioridad',
    'correo', 'email', 'mensaje',
    'borrador',
  ];

  const hasVerb = actionVerbs.some((v) => normalized.includes(v));
  const hasNoun = operativeNouns.some((n) => normalized.includes(n));

  // Patrones especiales que ya implican accion sin verbo+sustantivo separados
  const directPatterns = [
    'eso como tarea',
    'como tarea',
    'pon como tarea',
    'puedes agregar',
    'puedes crear',
    'puedes redactar',
    'puedes preparar',
    'puedes actualizar',
    'lista pendientes',
  ];

  return (hasVerb && hasNoun) || directPatterns.some((p) => normalized.includes(p));
}

// Recupera el case_number mas reciente mencionado por el propio agente en el
// historial para poder arrastrar contexto sin pedir el numero cada vez.
function lastBriefedCaseNumber(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !message?.content) continue;
    const match = String(message.content).match(/Revise el caso\s+(SC-\d{4}-\d{3,6})/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
}

function buildCasePromptGuidance(normalized) {
  if (normalized.includes('drive') || normalized.includes('gmail') || normalized.includes('correo')) {
    return 'Apenas ubique el expediente, te propongo un plan de Drive y Gmail con acciones de bajo riesgo.';
  }
  if (normalized.includes('riesgo') || normalized.includes('diagnostic') || normalized.includes('tarea')) {
    return 'Apenas ubique el expediente, te devuelvo diagnostico, riesgos y tareas concretas.';
  }
  if (normalized.includes('clasificar') || normalized.includes('barrido')) {
    return 'Apenas ubique el expediente, te digo que falta por clasificar, completar o revisar.';
  }
  return 'Apenas ubique el expediente, sigo con la revision operativa completa.';
}

function wantsCaseUpdate(normalized) {
  return (
    normalized.includes('actualizacion')
    || normalized.includes('actualizar')
    || normalized.includes('agregar una actualizacion')
    || normalized.includes('agrega una actualizacion')
    || normalized.includes('agregar actualizacion')
    || normalized.includes('registra una nota')
    || normalized.includes('agrega una nota')
    || normalized.includes('deja una nota')
    || normalized.includes('anota que')
  );
}

function sentenceCase(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildCaseArtifact(caseRecord) {
  return {
    type: 'case',
    id: String(caseRecord.id),
    title: `${caseRecord.case_number} · ${caseRecord.title}`,
    summary: `${caseRecord.client_name || 'sin cliente'} · ${caseRecord.status || 'sin estado'}`,
    data: {
      case_number: caseRecord.case_number,
      status: caseRecord.status,
      client_name: caseRecord.client_name || null,
      service_type: caseRecord.service_type || null,
    },
  };
}

function formatCaseUpdateGuidance(workspace, userText) {
  const { caseRecord } = workspace;
  const cleaned = sentenceCase(String(userText || '')
    .replace(/^(?:agregar|agrega|registrar|registra|anotar|anota)\s+(?:una\s+)?(?:actualizacion|nota)\s*(?:respecto\s+de|sobre|de)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim());

  const note = cleaned || sentenceCase(userText);
  return [
    `Tengo ubicado el expediente ${caseRecord.case_number}: ${caseRecord.title}.`,
    'Puedo dejar esta novedad como nota interna del caso, pero antes te propongo el texto para que lo confirmes:',
    '',
    `- Nota sugerida: ${note}`,
    `- Impacto operativo: revisar si esto cambia la siguiente accion del expediente (${caseRecord.next_action || 'sin siguiente accion registrada'}).`,
    '- Siguiente paso sugerido: si quieres, te preparo la redaccion final o la convierto en tarea concreta.',
  ].join('\n');
}

function buildWorkspaceFallbackAnalysis(workspace) {
  const { caseRecord, summary, tasks, deadlines, communications, driveFiles } = workspace;
  const topTask = tasks[0] || null;
  const topDeadline = deadlines[0] || null;
  const nextActionTitle = caseRecord.next_action || topTask?.title || topDeadline?.title || 'Precisar la siguiente actuacion del expediente';
  const missingDocuments = [];
  const risks = [];

  if ((summary.overdue_tasks || 0) > 0) {
    risks.push(`Hay ${summary.overdue_tasks} tarea(s) vencida(s) que requieren priorizacion inmediata.`);
  }
  if ((summary.overdue_deadlines || 0) > 0) {
    risks.push(`Hay ${summary.overdue_deadlines} vencimiento(s) vencido(s) o criticos que deben verificarse hoy.`);
  }
  if ((summary.unclassified_drive_files || 0) > 0) {
    risks.push(`Drive tiene ${summary.unclassified_drive_files} archivo(s) sin clasificar, lo que puede ocultar soportes clave.`);
  }
  if (!caseRecord.next_action) {
    risks.push('El expediente no tiene siguiente accion registrada, asi que conviene definirla y dejar rastro.');
  }
  if (!communications.length) {
    risks.push('No encontre comunicaciones recientes asociadas al caso; conviene verificar si falta recepcion o sincronizacion.');
  }

  if (!driveFiles.length) {
    missingDocuments.push('Verificar si el expediente ya tiene soportes en Drive o si falta sincronizacion documental.');
  }
  if (!communications.length) {
    missingDocuments.push('Confirmar si ya existen correos o comunicaciones relevantes del caso.');
  }
  if (!topTask && !topDeadline && !caseRecord.next_action) {
    missingDocuments.push('Precisar la proxima actuacion operativa con fecha o responsable.');
  }

  const suggestedTasks = [];
  if (topTask) {
    suggestedTasks.push({
      title: `Destrabar tarea prioritaria: ${topTask.title}`,
      priority: topTask.priority || 'ALTA',
      due_date: topTask.due_date || null,
    });
  }
  if (topDeadline) {
    suggestedTasks.push({
      title: `Verificar vencimiento: ${topDeadline.title}`,
      priority: 'ALTA',
      due_date: topDeadline.due_date || null,
    });
  }
  if ((summary.unclassified_drive_files || 0) > 0) {
    suggestedTasks.push({
      title: 'Clasificar archivos recientes del expediente en Drive',
      priority: 'MEDIA',
      due_date: null,
    });
  }
  if (!suggestedTasks.length) {
    suggestedTasks.push({
      title: 'Registrar siguiente accion concreta para el expediente',
      priority: 'MEDIA',
      due_date: caseRecord.next_action_date || null,
    });
  }

  return {
    executive_summary: caseRecord.next_action
      ? `El expediente ya sugiere como siguiente frente: ${caseRecord.next_action}.`
      : 'Cruce rapido del expediente listo con base en tareas, vencimientos, comunicaciones y Drive.',
    suggested_next_action: {
      title: nextActionTitle,
      due_date: caseRecord.next_action_date || topTask?.due_date || topDeadline?.due_date || null,
    },
    suggested_tasks: suggestedTasks,
    risks,
    missing_documents: missingDocuments,
  };
}

async function analyzeCaseWithSoftTimeout(params, timeoutMs = 12000) {
  let timer = null;

  try {
    return await Promise.race([
      analyzeCase(params),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error('Analisis local lento');
          err.code = 'SOFT_TIMEOUT';
          reject(err);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function summarizeWorkspaceFromApi({ caseRecord, tasks, deadlines, communications, driveFiles }) {
  const activeTasks = tasks.filter((task) => !['COMPLETADA', 'CANCELADA'].includes(task.status));
  const activeDeadlines = deadlines.filter((deadline) => !deadline.resolved);
  const today = new Date();
  const gmailMessages = communications.filter((entry) => entry.type === 'email').length;
  const unclassifiedDriveFiles = driveFiles.filter((file) => (file.category || 'sin_clasificar') === 'sin_clasificar').length;

  return {
    caseRecord,
    summary: {
      open_tasks: activeTasks.length,
      overdue_tasks: activeTasks.filter((task) => task.due_date && new Date(task.due_date) < today).length,
      open_deadlines: activeDeadlines.length,
      overdue_deadlines: activeDeadlines.filter((deadline) => deadline.due_date && new Date(deadline.due_date) < today).length,
      drive_files: driveFiles.length,
      unclassified_drive_files: unclassifiedDriveFiles,
      gmail_messages: gmailMessages,
    },
    tasks: activeTasks.slice(0, 10),
    deadlines: activeDeadlines.slice(0, 10),
    communications: communications.slice(0, 12),
    driveFiles: driveFiles.slice(0, 12),
  };
}

async function fetchCaseWorkspace(caseId, authorizationHeader = null) {
  const apiBase = getDataApiBaseUrl();
  if (apiBase && authorizationHeader) {
    const [caseRecord, tasks, deadlines, communications, drivePayload] = await Promise.all([
      fetchPlatformJson(`/cases/${caseId}`, authorizationHeader),
      fetchPlatformJson(`/cases/${caseId}/tareas?limit=10`, authorizationHeader),
      fetchPlatformJson(`/cases/${caseId}/vencimientos`, authorizationHeader),
      fetchPlatformJson(`/cases/${caseId}/communications`, authorizationHeader),
      fetchPlatformJson(`/cases/${caseId}/drive/files`, authorizationHeader).catch(() => ({ files: [] })),
    ]);

    return summarizeWorkspaceFromApi({
      caseRecord,
      tasks: Array.isArray(tasks) ? tasks : [],
      deadlines: Array.isArray(deadlines) ? deadlines : [],
      communications: Array.isArray(communications) ? communications : [],
      driveFiles: Array.isArray(drivePayload?.files) ? drivePayload.files : [],
    });
  }

  const [caseResult, summaryResult, tasksResult, deadlinesResult, communicationsResult, driveFilesResult] = await Promise.all([
    db.query(
      `SELECT
         c.*,
         cl.full_name AS client_name,
         cl.document_number AS client_document,
         cl.email AS client_email,
         cl.phone AS client_phone,
         u.name AS assigned_to_name
       FROM cases c
       LEFT JOIN clients cl ON cl.id = c.client_id
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id = $1
       LIMIT 1`,
      [caseId]
    ),
    db.query(
      `SELECT
         (SELECT COUNT(*)::int
            FROM tareas t
           WHERE t.case_id = $1
             AND t.status NOT IN ('COMPLETADA', 'CANCELADA')) AS open_tasks,
         (SELECT COUNT(*)::int
            FROM tareas t
           WHERE t.case_id = $1
             AND t.status NOT IN ('COMPLETADA', 'CANCELADA')
             AND t.due_date IS NOT NULL
             AND t.due_date < CURRENT_DATE) AS overdue_tasks,
         (SELECT COUNT(*)::int
            FROM vencimientos v
           WHERE v.case_id = $1
             AND v.resolved = FALSE) AS open_deadlines,
         (SELECT COUNT(*)::int
            FROM vencimientos v
           WHERE v.case_id = $1
             AND v.resolved = FALSE
             AND v.due_date < CURRENT_DATE) AS overdue_deadlines,
         (SELECT COUNT(*)::int
            FROM case_drive_files f
           WHERE f.case_id = $1) AS drive_files,
         (SELECT COUNT(*)::int
            FROM case_drive_files f
           WHERE f.case_id = $1
             AND COALESCE(f.category, 'sin_clasificar') = 'sin_clasificar') AS unclassified_drive_files,
         (SELECT COUNT(*)::int
            FROM communications cm
           WHERE cm.case_id = $1
             AND cm.type = 'email'
             AND COALESCE(cm.metadata->>'source', '') = 'gmail') AS gmail_messages`,
      [caseId]
    ),
    db.query(
      `SELECT
         t.id,
         t.title,
         t.status,
         t.priority,
         t.due_date,
         u.name AS assigned_to_name
       FROM tareas t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.case_id = $1
         AND t.status NOT IN ('COMPLETADA', 'CANCELADA')
       ORDER BY
         CASE t.priority
           WHEN 'CRITICA' THEN 0
           WHEN 'ALTA' THEN 1
           WHEN 'MEDIA' THEN 2
           ELSE 3
         END,
         t.due_date ASC NULLS LAST,
         t.id DESC
       LIMIT 10`,
      [caseId]
    ),
    db.query(
      `SELECT
         v.id,
         v.title,
         v.due_date,
         v.urgency,
         v.resolved
       FROM vencimientos v
       WHERE v.case_id = $1
         AND v.resolved = FALSE
       ORDER BY v.due_date ASC, v.id DESC
       LIMIT 10`,
      [caseId]
    ),
    db.query(
      `SELECT
         cm.id,
         cm.type,
         cm.content,
         cm.metadata,
         cm.created_at
       FROM communications cm
       WHERE cm.case_id = $1
       ORDER BY cm.created_at DESC, cm.id DESC
       LIMIT 12`,
      [caseId]
    ),
    db.query(
      `SELECT
         f.id,
         f.name,
         f.category,
         f.modified_time,
         f.mime_type,
         f.web_view_link
       FROM case_drive_files f
       WHERE f.case_id = $1
       ORDER BY f.modified_time DESC NULLS LAST, f.id DESC
       LIMIT 12`,
      [caseId]
    ),
  ]);

  return {
    caseRecord: caseResult.rows[0] || null,
    summary: summaryResult.rows[0] || {},
    tasks: tasksResult.rows,
    deadlines: deadlinesResult.rows,
    communications: communicationsResult.rows,
    driveFiles: driveFilesResult.rows,
  };
}

function buildCaseSourceText(workspace) {
  const { caseRecord, summary, tasks, deadlines, communications, driveFiles } = workspace;
  const lines = [
    `Caso ${caseRecord.case_number}: ${caseRecord.title}`,
    `Cliente: ${caseRecord.client_name || 'sin cliente registrado'}`,
    `Estado: ${caseRecord.status || 'sin estado'}`,
    `Tipo: ${caseRecord.service_type || 'sin tipo'}`,
    `Entidad: ${caseRecord.entity || 'sin entidad'}`,
    `Siguiente accion actual: ${caseRecord.next_action || 'sin siguiente accion'}`,
    `Fecha siguiente accion: ${formatDate(caseRecord.next_action_date)}`,
    `Vencimiento de respuesta: ${formatDate(caseRecord.response_deadline)}`,
    `Tareas abiertas: ${summary.open_tasks || 0}`,
    `Tareas vencidas: ${summary.overdue_tasks || 0}`,
    `Vencimientos abiertos: ${summary.open_deadlines || 0}`,
    `Vencimientos vencidos: ${summary.overdue_deadlines || 0}`,
    `Archivos Drive: ${summary.drive_files || 0}`,
    `Archivos sin clasificar: ${summary.unclassified_drive_files || 0}`,
    `Correos Gmail ingestados: ${summary.gmail_messages || 0}`,
  ];

  if (tasks.length) {
    lines.push('Tareas abiertas relevantes:');
    tasks.forEach((task) => {
      lines.push(`- [${task.priority}] ${task.title} | estado ${task.status} | vence ${formatDate(task.due_date)}`);
    });
  }

  if (deadlines.length) {
    lines.push('Vencimientos abiertos:');
    deadlines.forEach((deadline) => {
      lines.push(`- [${deadline.urgency}] ${deadline.title} | vence ${formatDate(deadline.due_date)}`);
    });
  }

  const recentComms = communications.slice(0, 6);
  if (recentComms.length) {
    lines.push('Comunicaciones recientes:');
    recentComms.forEach((communication) => {
      const snippet = String(communication.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      lines.push(`- [${communication.type}] ${formatDate(communication.created_at)} | ${snippet || 'sin contenido'}`);
    });
  }

  const recentFiles = driveFiles.slice(0, 6);
  if (recentFiles.length) {
    lines.push('Archivos Drive recientes:');
    recentFiles.forEach((file) => {
      lines.push(`- [${file.category || 'sin_clasificar'}] ${file.name} | ${formatDate(file.modified_time)}`);
    });
  }

  return lines.join('\n');
}

function formatCaseReview(workspace, aiResult, options = {}) {
  const { caseRecord, summary, tasks, deadlines, driveFiles } = workspace;
  const fallbackAnalysis = buildWorkspaceFallbackAnalysis(workspace);
  const analysis = aiResult?.analysis || fallbackAnalysis;
  const suggestedTasks = Array.isArray(analysis.suggested_tasks) ? analysis.suggested_tasks.slice(0, 4) : [];
  const risks = Array.isArray(analysis.risks) ? analysis.risks.slice(0, 4) : [];
  const missingDocuments = Array.isArray(analysis.missing_documents) ? analysis.missing_documents.slice(0, 4) : [];

  const sections = [
    `Revise el caso ${caseRecord.case_number}: ${caseRecord.title}.`,
    `Cliente: ${caseRecord.client_name || 'sin cliente'} | Estado: ${caseRecord.status || 'sin estado'} | Tipo: ${caseRecord.service_type || 'sin tipo'}.`,
    `Tareas abiertas: ${summary.open_tasks || 0} | Vencidas: ${summary.overdue_tasks || 0} | Vencimientos abiertos: ${summary.open_deadlines || 0} | Archivos sin clasificar: ${summary.unclassified_drive_files || 0}.`,
    '',
    'Lectura operativa:',
    `- ${analysis.executive_summary || 'No encontre una lectura operativa clara con la informacion actual.'}`,
    `- Siguiente accion sugerida: ${analysis.suggested_next_action?.title || 'sin sugerencia concreta'}${analysis.suggested_next_action?.due_date ? ` | fecha sugerida ${analysis.suggested_next_action.due_date}` : ''}`,
  ];

  if (tasks.length) {
    sections.push('- Tareas abiertas clave:');
    tasks.slice(0, 4).forEach((task) => {
      sections.push(`  ${task.priority} | ${task.title} | vence ${formatDate(task.due_date)}`);
    });
  }

  if (deadlines.length) {
    sections.push('- Vencimientos a tener presentes:');
    deadlines.slice(0, 4).forEach((deadline) => {
      sections.push(`  ${deadline.urgency} | ${deadline.title} | vence ${formatDate(deadline.due_date)}`);
    });
  }

  if (risks.length) {
    sections.push('- Riesgos:');
    risks.forEach((risk) => sections.push(`  ${risk}`));
  }

  if (suggestedTasks.length) {
    sections.push('- Tareas sugeridas por Phi:');
    suggestedTasks.forEach((task) => {
      sections.push(`  ${task.priority || 'MEDIA'} | ${task.title}${task.due_date ? ` | ${task.due_date}` : ''}`);
    });
  }

  if (missingDocuments.length) {
    sections.push('- Soportes o verificaciones pendientes:');
    missingDocuments.forEach((item) => sections.push(`  ${item}`));
  }

  if (driveFiles.length) {
    sections.push(`- Drive del expediente: ${summary.drive_files || driveFiles.length} archivo(s) registrados, ${summary.unclassified_drive_files || 0} sin clasificar.`);
  }

  if (options.fallbackReason) {
    sections.push('', `Nota operativa: no espere mas por el runtime local y te devolvi una lectura rapida con datos reales del sistema. Motivo: ${options.fallbackReason}.`);
  }

  sections.push('', aiResult
    ? `Analisis generado por ${aiResult.provider} (${aiResult.model}).`
    : 'Analisis generado con lectura operativa rapida del sistema.');
  return sections.join('\n');
}

async function fetchGlobalWorkqueue(user, authorizationHeader = null) {
  const apiBase = getDataApiBaseUrl();
  if (apiBase && authorizationHeader) {
    const [tasks, deadlines] = await Promise.all([
      fetchPlatformJson('/tareas?limit=8', authorizationHeader),
      fetchPlatformJson('/vencimientos?days=14', authorizationHeader),
    ]);

    return {
      tasks: Array.isArray(tasks) ? tasks.slice(0, 8) : [],
      deadlines: Array.isArray(deadlines) ? deadlines.slice(0, 8) : [],
    };
  }

  const scope = buildCasesFilter(user.id, user.role, 3);
  const taskWhere = [];
  const taskParams = [];
  let taskIndex = 1;

  if (user.role !== 'admin') {
    taskWhere.push(`(
      t.assigned_to = $${taskIndex}
      OR t.created_by = $${taskIndex + 1}
      OR (t.case_id IS NOT NULL AND ${scope.clause})
    )`);
    taskParams.push(user.id, user.id, ...scope.params);
    taskIndex = scope.next;
  }

  taskWhere.push(`t.status NOT IN ('COMPLETADA', 'CANCELADA')`);
  taskParams.push(8);

  const deadlineParams = [];
  let deadlineIndex = 1;
  const deadlineWhere = [`v.resolved = FALSE`, `v.due_date <= CURRENT_DATE + INTERVAL '14 days'`];
  if (user.role !== 'admin') {
    deadlineWhere.push(`(c.assigned_to = $${deadlineIndex} OR c.created_by = $${deadlineIndex + 1} OR EXISTS (
      SELECT 1 FROM macrocasos _m WHERE _m.id = c.macrocaso_id AND _m.lead_lawyer = $${deadlineIndex + 2}
    ))`);
    deadlineParams.push(user.id, user.id, user.id);
    deadlineIndex += 3;
  }
  deadlineParams.push(8);

  const [tasksResult, deadlinesResult] = await Promise.all([
    db.query(
      `SELECT
         t.id,
         t.title,
         t.priority,
         t.status,
         t.due_date,
         c.case_number,
         c.title AS case_title
       FROM tareas t
       LEFT JOIN cases c ON c.id = t.case_id
       WHERE ${taskWhere.join(' AND ')}
       ORDER BY
         CASE t.priority
           WHEN 'CRITICA' THEN 0
           WHEN 'ALTA' THEN 1
           WHEN 'MEDIA' THEN 2
           ELSE 3
         END,
         t.due_date ASC NULLS LAST,
         t.id DESC
       LIMIT $${taskIndex}`,
      taskParams
    ),
    db.query(
      `SELECT
         v.id,
         v.title,
         v.due_date,
         v.urgency,
         c.case_number,
         c.title AS case_title
       FROM vencimientos v
       JOIN cases c ON c.id = v.case_id
       WHERE ${deadlineWhere.join(' AND ')}
       ORDER BY v.due_date ASC, v.id DESC
       LIMIT $${deadlineIndex}`,
      deadlineParams
    ),
  ]);

  return {
    tasks: tasksResult.rows,
    deadlines: deadlinesResult.rows,
  };
}

function formatGlobalWorkqueue(data) {
  const lines = ['Te resumo la carga operativa visible en este momento.'];

  if (data.tasks.length) {
    lines.push('', 'Tareas prioritarias:');
    data.tasks.forEach((task) => {
      lines.push(`- ${task.priority} | ${task.title} | ${task.case_number || 'sin caso'} | vence ${formatDate(task.due_date)}`);
    });
  } else {
    lines.push('', 'No encontre tareas abiertas en tu bandeja accesible.');
  }

  if (data.deadlines.length) {
    lines.push('', 'Vencimientos proximos o vencidos:');
    data.deadlines.forEach((deadline) => {
      lines.push(`- ${deadline.urgency} | ${deadline.title} | ${deadline.case_number} | vence ${formatDate(deadline.due_date)}`);
    });
  } else {
    lines.push('', 'No encontre vencimientos abiertos en los proximos 14 dias.');
  }

  return lines.join('\n');
}

function formatProactiveSweep(result) {
  const lines = [
    `Ejecute un barrido proactivo${result.dry_run ? ' en modo previsualizacion' : ''}.`,
    `Casos evaluados: ${result.candidates}. Planes propuestos: ${result.created_count}. Omitidos: ${result.skipped.length}.`,
  ];

  if (result.created?.length) {
    lines.push('', 'Casos con propuesta de plan:');
    result.created.slice(0, 5).forEach((entry) => {
      const summary = entry.analysis?.executive_summary || 'sin resumen';
      lines.push(`- ${entry.case_number}: ${summary}`);
    });
  }

  if (result.errors?.length) {
    lines.push('', 'Errores detectados:');
    result.errors.slice(0, 3).forEach((entry) => {
      lines.push(`- ${entry.case_number}: ${entry.error}`);
    });
  }

  return lines.join('\n');
}

async function routeAgentRequest({ user, messages, artifacts = [], authorizationHeader = null, onStatus = null, profileName = null }) {
  const current = latestUserMessage(messages);
  if (!current) return { handled: false };

  const text = String(current.content || '').trim();
  if (!text) return { handled: false };

  const normalized = normalizeText(text);
  const forceHint = userIsClarifyingCase(messages, text);
  const asksProactive = normalized.includes('proactivo') || normalized.includes('autopiloto');
  const asksGlobalQueue =
    (normalized.includes('prioriza') ||
      normalized.includes('prioridad') ||
      normalized.includes('vencimiento') ||
      normalized.includes('tareas')) &&
    !normalized.includes('caso') &&
    !normalized.includes('expediente');

  onStatus?.({ id: 'intent', label: 'Interpretando tu solicitud y buscando contexto en Opus', state: 'running' });

  const followUpAction = looksLikeFollowUpAction(normalized);
  const explicitBriefRequest = isExplicitBriefRequest(normalized);
  const previouslyBriefed = lastBriefedCaseNumber(messages);
  const explicitCaseNumber = text.match(/\bSC-\d{4}-\d{3,6}\b/i);
  const dropzoneCaseArtifact = artifacts.find((artifact) => artifact?.type === 'case' && artifact?.id);

  // Deferral por accion explicita: si el usuario pide una accion concreta
  // (crear tarea, actualizar caso, redactar correo, etc) y NO esta pidiendo
  // un brief, pasamos directo a Gemini. El router no es mas eficiente que
  // las tools cuando el intent es "hazlo".
  if (followUpAction && !explicitBriefRequest) {
    onStatus?.({
      id: 'intent',
      label: previouslyBriefed
        ? `Continuo con ${previouslyBriefed} y uso herramientas (no repito el brief)`
        : 'Detecto pedido de accion concreta; ejecuto con herramientas',
      state: 'done',
    });
    return { handled: false };
  }

  const caseContext = await resolveCaseContext(user, text, artifacts, authorizationHeader, { forceRawHint: forceHint });

  if (caseContext.kind === 'ambiguous') {
    onStatus?.({ id: 'case_lookup', label: 'Encontre varios expedientes posibles; necesito que escojas uno', state: 'warn' });
    return {
      handled: true,
      text: [
        `Encontre varios casos posibles para "${caseContext.hint}".`,
        ...caseContext.matches.slice(0, 5).map((row) => `- ${formatCaseLabel(row)}`),
        '',
        'Dime cual quieres o arrastra el expediente al panel y lo reviso directo.',
      ].join('\n'),
    };
  }

  if (caseContext.kind === 'resolved') {
    onStatus?.({ id: 'case_lookup', label: 'Expediente identificado. Estoy cruzando su contexto operativo', state: 'done' });
    onStatus?.({ id: 'case_workspace', label: 'Revisando tareas, vencimientos, correos y Drive del expediente', state: 'running' });
    const workspace = await fetchCaseWorkspace(caseContext.caseId, authorizationHeader);
    if (!workspace.caseRecord) {
      onStatus?.({ id: 'case_workspace', label: 'No pude abrir el expediente con el contexto actual', state: 'error' });
      return {
        handled: true,
        text: 'No pude encontrar el caso en el sistema con el contexto actual.',
      };
    }

    // Continuidad conversacional: si el brief del mismo caso ya esta en el
    // historial y el usuario no pide re-brief, delegamos en Gemini para que
    // use sus herramientas (`create_task`, `update_case`, etc) en vez de repetir.
    const alreadyBriefed = caseAlreadyBriefedInHistory(messages, workspace.caseRecord);
    if (alreadyBriefed && !explicitBriefRequest && !wantsCaseUpdate(normalized)) {
      onStatus?.({
        id: 'case_review',
        label: `Ya tienes el brief de ${workspace.caseRecord.case_number}; paso al modo accion`,
        state: 'done',
      });
      return { handled: false };
    }

    const sourceText = buildCaseSourceText(workspace);
    onStatus?.({ id: 'case_review', label: 'Preparando lectura operativa del expediente', state: 'running' });

    let aiResult = null;
    let fallbackReason = null;

    try {
        aiResult = await analyzeCaseWithSoftTimeout({
          caseData: workspace.caseRecord,
          sourceText,
          sourceType: 'agent_router_case_workspace',
          profileName,
        });
        onStatus?.({ id: 'case_review', label: 'Lectura operativa lista', state: 'done' });
      } catch (err) {
      fallbackReason = err.code === 'SOFT_TIMEOUT'
        ? 'Gemma 4 local esta tardando mas de lo deseable para chat'
        : (err.message || 'analisis local no disponible');
      onStatus?.({
        id: 'case_review',
        label: 'El runtime local esta lento; sigo con una lectura operativa rapida del sistema',
        state: 'warn',
      });
      }

      if (wantsCaseUpdate(normalized)) {
        return {
          handled: true,
          text: formatCaseUpdateGuidance(workspace, text),
          meta: {
            type: 'case_update_guidance',
            case_id: workspace.caseRecord.id,
            case_number: workspace.caseRecord.case_number,
          },
          context_artifact: buildCaseArtifact(workspace.caseRecord),
        };
      }

    return {
      handled: true,
      text: formatCaseReview(workspace, aiResult, { fallbackReason }),
      meta: {
        type: 'case_review',
        case_id: workspace.caseRecord.id,
        case_number: workspace.caseRecord.case_number,
      },
      context_artifact: buildCaseArtifact(workspace.caseRecord),
    };
  }

  if (asksProactive) {
    onStatus?.({ id: 'proactive', label: 'Corriendo barrido proactivo en modo seguro', state: 'running' });
    const apiBase = getDataApiBaseUrl();
    const result = apiBase && authorizationHeader
      ? await fetchPlatformJson('/agent/proactive/run', authorizationHeader, {
          method: 'POST',
          body: { dry_run: true, limit: 5 },
          timeoutMs: 30000,
        })
      : await runProactiveSweep({ userId: user.id, dryRun: true, limit: 5 });
    return {
      handled: true,
      text: formatProactiveSweep(result),
      meta: { type: 'proactive_sweep' },
    };
  }

  if (asksGlobalQueue) {
    onStatus?.({ id: 'workqueue', label: 'Revisando tu carga operativa y vencimientos visibles', state: 'running' });
    const workqueue = await fetchGlobalWorkqueue(user, authorizationHeader);
    return {
      handled: true,
      text: formatGlobalWorkqueue(workqueue),
      meta: { type: 'global_workqueue' },
    };
  }

  if (normalized.includes('caso') || normalized.includes('expediente') || forceHint) {
    // Si ya hay un brief previo en la conversacion, no volvemos a pedir el
    // numero: delegamos en Gemini que tiene el historial y puede hilar la accion.
    const previouslyBriefed = lastBriefedCaseNumber(messages);
    if (previouslyBriefed) {
      onStatus?.({
        id: 'case_lookup',
        label: `Asumo que sigues con ${previouslyBriefed}; continuo con las herramientas`,
        state: 'done',
      });
      return { handled: false };
    }

    onStatus?.({ id: 'case_lookup', label: 'Necesito una referencia minima para ubicar el expediente correcto', state: 'warn' });
    return {
      handled: true,
      text: [
        'Puedo hacerlo, pero primero necesito ubicar el expediente correcto en el sistema.',
        'Dime el numero SC-YYYY-NNNN, el nombre del cliente o arrastra el expediente al panel.',
        buildCasePromptGuidance(normalized),
      ].join('\n'),
    };
  }

  return { handled: false };
}

module.exports = {
  routeAgentRequest,
};
