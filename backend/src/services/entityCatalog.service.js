const ENTITY_GROUP = [
  {
    key: 'paimon',
    n: 9,
    name: 'Paimon',
    stage: 'nigredo',
    rank: 'Rey',
    domain: 'Direccion juridica integral, gobierno del despacho, estrategia transversal y vision de conjunto.',
    purpose: 'Priorizar la operacion completa de la firma y convertir el estado del despacho en decisiones revisables.',
    ritual: 'Requiere verdad operacional: casos activos, vencimientos, tareas, responsables, planes y riesgos visibles.',
    currentCapabilities: ['get_stats', 'get_bandeja', 'get_priority_score', 'list_cases', 'agent_plan_create', 'agent_action_log'],
    missingCapabilities: [],
    allowedTools: ['get_stats', 'get_bandeja', 'get_priority_score', 'list_cases', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'monitoring_and_plans',
    monitors: ['cases_without_next_action', 'overdue_work', 'active_plans'],
    complements: ['seere', 'belial', 'valac'],
    keywords: ['gobierno', 'prioridad', 'despacho', 'comando', 'vision', 'estrategia', 'global'],
  },
  {
    key: 'marax',
    n: 21,
    name: 'Marax',
    stage: 'albedo',
    rank: 'Presidente',
    domain: 'Terminos procesales, prescripcion, caducidad, calendario judicial, dias habiles y festivos.',
    purpose: 'Vigilar fechas criticas, vencimientos y riesgo temporal de los casos.',
    ritual: 'Requiere fecha base, tipo de termino, jurisdiccion, calendario aplicable y fuente del plazo.',
    currentCapabilities: ['list_upcoming_deadlines', 'list_pending_tasks', 'get_case_brief', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'business_days_deadline_calculator',
        suggestedEndpoint: 'POST /api/v1/deadlines/calculate-business-days',
        alsoUsefulFor: ['seere', 'paimon', 'belial'],
        priority: 'alta',
      },
    ],
    allowedTools: ['list_upcoming_deadlines', 'list_pending_tasks', 'get_case_brief', 'agent_plan_create'],
    autonomy: 'monitoring_and_plans',
    monitors: ['upcoming_deadlines', 'overdue_deadlines', 'cases_without_next_action_date'],
    complements: ['seere', 'belial', 'paimon'],
    keywords: ['termino', 'vencimiento', 'plazo', 'caducidad', 'prescripcion', 'calendario', 'fecha'],
  },
  {
    key: 'barbatos',
    n: 8,
    name: 'Barbatos',
    stage: 'nigredo',
    rank: 'Duque',
    domain: 'Lectura de senales, analisis de comunicaciones, prueba indiciaria e interpretacion de indicios.',
    purpose: 'Detectar senales utiles en correos, notas, comunicaciones y patrones del caso.',
    ritual: 'Requiere comunicaciones completas, contexto sin filtrar y relacion con el expediente.',
    currentCapabilities: ['list_case_communications', 'analyze_text', 'add_case_note'],
    missingCapabilities: [
      {
        capability: 'communication_signal_extractor',
        suggestedEndpoint: 'POST /api/v1/communications/analyze-signals',
        alsoUsefulFor: ['dantalion', 'foras', 'purson'],
        priority: 'media',
      },
    ],
    allowedTools: ['list_case_communications', 'analyze_text', 'add_case_note', 'agent_action_log'],
    autonomy: 'internal_notes_and_plans',
    monitors: ['recent_case_communications'],
    complements: ['foras', 'purson', 'paimon'],
    keywords: ['senal', 'comunicacion', 'correo', 'indicio', 'patron', 'tono', 'mensaje'],
  },
  {
    key: 'ronove',
    n: 27,
    name: 'Ronove',
    stage: 'albedo',
    rank: 'Marques',
    domain: 'Redaccion juridica, alegatos, memoriales, conceptos, opiniones legales y teoria del caso escrita.',
    purpose: 'Convertir contexto del expediente en borradores y piezas juridicas revisables.',
    ritual: 'Requiere hechos, pretension, destinatario, fuente, plantilla y revision humana antes de salida externa.',
    currentCapabilities: ['get_case_brief', 'list_case_communications', 'document_draft', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'source_grounded_document_drafting',
        suggestedEndpoint: 'POST /api/v1/documents/draft-with-sources',
        alsoUsefulFor: ['gusion', 'foras', 'orobas'],
        priority: 'alta',
      },
    ],
    allowedTools: ['get_case_brief', 'list_case_communications', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'plans_require_approval',
    monitors: ['draftable_documents'],
    complements: ['orobas', 'belial', 'astaroth'],
    keywords: ['redacta', 'borrador', 'memorial', 'concepto', 'oficio', 'alegato', 'documento'],
  },
  {
    key: 'astaroth',
    n: 29,
    name: 'Astaroth',
    stage: 'albedo',
    rank: 'Duque',
    domain: 'Gestion del conocimiento, memoria institucional, banco de argumentos y lecciones aprendidas.',
    purpose: 'Convertir decisiones, argumentos y correcciones en memoria reutilizable de la firma.',
    ritual: 'Requiere fuente, caso asociado, criterio validado y version aprobada por abogado.',
    currentCapabilities: ['agent_action_list', 'list_case_communications', 'add_case_note'],
    missingCapabilities: [
      {
        capability: 'knowledge_base_entry_create',
        suggestedEndpoint: 'POST /api/v1/knowledge/entries',
        alsoUsefulFor: ['ronove', 'kimaris', 'gusion'],
        priority: 'alta',
      },
    ],
    allowedTools: ['agent_action_log', 'agent_action_list', 'add_case_note'],
    autonomy: 'knowledge_gap_detection',
    monitors: ['accepted_actions', 'repeated_notes'],
    complements: ['kimaris', 'ronove', 'paimon'],
    keywords: ['memoria', 'criterio', 'argumento', 'leccion', 'conocimiento', 'plantilla'],
  },
  {
    key: 'foras',
    n: 31,
    name: 'Foras',
    stage: 'albedo',
    rank: 'Presidente',
    domain: 'Derecho probatorio, admisibilidad, cadena de custodia, prueba digital, peritaje y licitud de la prueba.',
    purpose: 'Evaluar solidez probatoria, faltantes, admisibilidad y riesgos de evidencia.',
    ritual: 'Requiere inventario probatorio, origen de cada prueba, metadatos, cadena de custodia y finalidad procesal.',
    currentCapabilities: ['get_case_brief', 'list_case_communications', 'analyze_text', 'add_case_note'],
    missingCapabilities: [
      {
        capability: 'evidence_inventory',
        suggestedEndpoint: 'GET /api/v1/cases/:caseId/evidence',
        alsoUsefulFor: ['purson', 'orobas', 'barbatos'],
        priority: 'alta',
      },
      {
        capability: 'extract_document_metadata',
        suggestedEndpoint: 'POST /api/v1/documents/:id/metadata/extract',
        alsoUsefulFor: ['purson', 'orobas', 'barbatos'],
        priority: 'alta',
      },
    ],
    allowedTools: ['get_case_brief', 'list_case_communications', 'analyze_text', 'add_case_note', 'agent_plan_create'],
    autonomy: 'gap_detection_and_plans',
    monitors: ['cases_with_unclassified_documents', 'evidence_gaps'],
    complements: ['purson', 'orobas', 'barbatos'],
    keywords: ['prueba', 'probatorio', 'cadena de custodia', 'metadatos', 'evidencia', 'peritaje', 'admisibilidad'],
  },
  {
    key: 'purson',
    n: 20,
    name: 'Purson',
    stage: 'albedo',
    rank: 'Rey',
    domain: 'Descubrimiento probatorio, exhibicion de documentos, inspeccion judicial y cadena de custodia.',
    purpose: 'Identificar documentos, evidencias y diligencias necesarias para completar el expediente probatorio.',
    ritual: 'Requiere hipotesis probatoria, lista de documentos esperados, fuente y mecanismo de obtencion.',
    currentCapabilities: ['get_case_brief', 'list_case_communications', 'drive_list_case_files', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'evidence_request_matrix',
        suggestedEndpoint: 'POST /api/v1/cases/:caseId/evidence/request-matrix',
        alsoUsefulFor: ['foras', 'ronove', 'belial'],
        priority: 'alta',
      },
    ],
    allowedTools: ['get_case_brief', 'list_case_communications', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'gap_detection_and_plans',
    monitors: ['document_gaps', 'unclassified_drive_files'],
    complements: ['foras', 'orobas', 'barbatos'],
    keywords: ['descubrimiento', 'exhibicion', 'inspeccion', 'documentos faltantes', 'pruebas faltantes'],
  },
  {
    key: 'orobas',
    n: 55,
    name: 'Orobas',
    stage: 'rubedo',
    rank: 'Principe',
    domain: 'Etica profesional, integridad del expediente, verdad procesal y lealtad.',
    purpose: 'Vigilar coherencia, integridad, trazabilidad y riesgos eticos del expediente.',
    ritual: 'Requiere rastro de acciones, fuente de documentos, responsable y version verificable.',
    currentCapabilities: ['agent_action_list', 'get_case_brief', 'list_case_communications'],
    missingCapabilities: [
      {
        capability: 'case_integrity_audit',
        suggestedEndpoint: 'GET /api/v1/cases/:caseId/integrity-audit',
        alsoUsefulFor: ['foras', 'belial', 'valac'],
        priority: 'alta',
      },
    ],
    allowedTools: ['agent_action_list', 'get_case_brief', 'add_case_note', 'agent_action_log'],
    autonomy: 'monitoring_and_warnings',
    monitors: ['irreversible_actions', 'missing_traceability'],
    complements: ['belial', 'valac', 'foras'],
    keywords: ['etica', 'integridad', 'trazabilidad', 'expediente', 'verdad', 'lealtad', 'auditoria'],
  },
  {
    key: 'valac',
    n: 62,
    name: 'Valac',
    stage: 'rubedo',
    rank: 'Presidente',
    domain: 'Gestion de riesgos, auditoria legal, pasivos contingentes, due diligence preventiva y compliance.',
    purpose: 'Detectar riesgos juridicos y operativos antes de que se vuelvan dano.',
    ritual: 'Requiere hechos, estado, fuente, probabilidad, impacto y accion mitigante.',
    currentCapabilities: ['get_case_brief', 'list_upcoming_deadlines', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'legal_risk_matrix',
        suggestedEndpoint: 'POST /api/v1/cases/:caseId/risk-matrix',
        alsoUsefulFor: ['paimon', 'belial', 'seere'],
        priority: 'alta',
      },
    ],
    allowedTools: ['get_case_brief', 'list_upcoming_deadlines', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'risk_signals_and_plans',
    monitors: ['overdue_work', 'cases_without_next_action', 'high_risk_deadlines'],
    complements: ['paimon', 'orobas', 'belial'],
    keywords: ['riesgo', 'contingencia', 'auditoria', 'compliance', 'mitigar', 'pasivo'],
  },
  {
    key: 'belial',
    n: 68,
    name: 'Belial',
    stage: 'rubedo',
    rank: 'Rey',
    domain: 'Gobierno corporativo, aprobaciones, politicas de la firma, delegacion de autoridad y rendicion de cuentas.',
    purpose: 'Gobernar aprobaciones humanas sobre acciones sensibles o irreversibles.',
    ritual: 'Requiere matriz de autoridad, preview de accion, riesgo, responsable y rastro de decision.',
    currentCapabilities: ['agent_plan_list', 'agent_plan_get', 'agent_plan_update_step', 'agent_action_log'],
    missingCapabilities: [
      {
        capability: 'approval_policy_matrix',
        suggestedEndpoint: 'GET /api/v1/approvals/policy-matrix',
        alsoUsefulFor: ['paimon', 'orobas', 'ronove'],
        priority: 'alta',
      },
    ],
    allowedTools: ['agent_plan_list', 'agent_plan_get', 'agent_plan_update_step', 'agent_action_log'],
    autonomy: 'approval_governance',
    monitors: ['pending_approvals', 'irreversible_steps'],
    complements: ['orobas', 'paimon', 'seere'],
    keywords: ['aprobar', 'aprobacion', 'autorizar', 'gobierno', 'permiso', 'firmar', 'enviar', 'sensible'],
  },
  {
    key: 'vapula',
    n: 60,
    name: 'Vapula',
    stage: 'rubedo',
    rank: 'Duque',
    domain: 'Legal operations, automatizacion, productividad, optimizacion de procesos y eficiencia operativa.',
    purpose: 'Detectar trabajo repetible y proponer automatizaciones internas reutilizables.',
    ritual: 'Requiere flujo actual, pasos repetidos, responsable, frecuencia y efecto esperado.',
    currentCapabilities: ['get_bandeja', 'list_pending_tasks', 'agent_action_list', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'workflow_candidate_detector',
        suggestedEndpoint: 'GET /api/v1/operations/workflow-candidates',
        alsoUsefulFor: ['kimaris', 'seere', 'paimon'],
        priority: 'media',
      },
    ],
    allowedTools: ['get_bandeja', 'agent_action_list', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'workflow_gap_detection',
    monitors: ['repeated_tasks', 'manual_bottlenecks'],
    complements: ['seere', 'kimaris', 'paimon'],
    keywords: ['automatizar', 'workflow', 'operaciones', 'productividad', 'repetitivo', 'eficiencia'],
  },
  {
    key: 'seere',
    n: 70,
    name: 'Seere',
    stage: 'rubedo',
    rank: 'Principe',
    domain: 'Velocidad de servicio, SLA, entrega agil, experiencia del cliente, productizacion y eficiencia temporal.',
    purpose: 'Medir velocidad, detectar cuellos de botella y proponer aceleraciones sin sacrificar calidad.',
    ritual: 'Requiere fecha de entrada, fecha objetivo, responsable, estado actual y SLA aplicable.',
    currentCapabilities: ['get_stats', 'get_bandeja', 'list_pending_tasks', 'agent_plan_create'],
    missingCapabilities: [
      {
        capability: 'sla_tracker',
        suggestedEndpoint: 'GET /api/v1/operations/sla',
        alsoUsefulFor: ['paimon', 'vapula', 'andrealphus'],
        priority: 'alta',
      },
    ],
    allowedTools: ['get_stats', 'get_bandeja', 'list_pending_tasks', 'agent_plan_create', 'agent_action_log'],
    autonomy: 'sla_signals_and_plans',
    monitors: ['overdue_tasks', 'slow_cases', 'pending_response_deadlines'],
    complements: ['vapula', 'paimon', 'marax'],
    keywords: ['sla', 'velocidad', 'cuello de botella', 'rapido', 'demora', 'tiempo', 'productizacion'],
  },
];

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function publicEntity(entity) {
  if (!entity) return null;
  const { keywords, ...safe } = entity;
  return safe;
}

function listEntities() {
  return ENTITY_GROUP.map(publicEntity);
}

function getEntity(keyOrName) {
  const needle = normalize(keyOrName);
  const entity = ENTITY_GROUP.find((item) => normalize(item.key) === needle || normalize(item.name) === needle);
  return publicEntity(entity);
}

function resolveEntities({ instruction = '', limit = 4 } = {}) {
  const text = normalize(instruction);
  const scored = ENTITY_GROUP.map((entity) => {
    let score = 0;
    if (text.includes(normalize(entity.name)) || text.includes(normalize(entity.key))) score += 50;
    for (const keyword of entity.keywords || []) {
      if (text.includes(normalize(keyword))) score += 10;
    }
    for (const fragment of normalize(entity.domain).split(/[, ]+/)) {
      if (fragment.length > 5 && text.includes(fragment)) score += 1;
    }
    return { entity, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matches = scored.length
    ? scored.slice(0, limit).map((item) => ({ ...publicEntity(item.entity), score: item.score }))
    : [{ ...publicEntity(ENTITY_GROUP[0]), score: 0 }];

  return {
    lead_entity: matches[0],
    supporting_entities: matches.slice(1),
    confidence: matches[0]?.score >= 50 ? 'explicit' : (matches[0]?.score > 0 ? 'semantic' : 'fallback'),
  };
}

module.exports = {
  ENTITY_GROUP,
  listEntities,
  getEntity,
  resolveEntities,
  normalize,
};
