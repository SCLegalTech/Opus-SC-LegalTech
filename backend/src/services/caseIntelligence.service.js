const crypto = require('crypto');
const { getFallbackRuntime, getRuntime } = require('../config/aiRuntime');
const { runLiteRtPrompt } = require('./litertLm.service');
const geminiService = require('./gemini.service');

const PROMPT_VERSION = 'case_sala_v1_gemini';
const OLLAMA_PROMPT_VERSION = 'case_sala_local_v0';

function inputHash(text) {
  return crypto.createHash('sha256').update(text || '').digest('hex');
}

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}

function compactCaseContext(caseData) {
  return {
    id: caseData.id,
    case_number: caseData.case_number,
    title: caseData.title,
    service_type: caseData.service_type,
    status: caseData.status,
    entity: caseData.entity,
    client_name: caseData.client_name,
    client_document: caseData.client_document,
    next_action: caseData.next_action,
    next_action_date: caseData.next_action_date,
    response_deadline: caseData.response_deadline,
  };
}

function normalizeDate(raw) {
  if (!raw) return null;
  const value = String(raw).trim();
  let match = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  match = value.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
  if (match) {
    const [, d, m, y] = match;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;:])\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function hasAny(lower, terms) {
  return terms.some(term => lower.includes(term));
}

function classifyInput(lower) {
  const matches = [];

  const rules = [
    {
      key: 'radicacion',
      terms: ['radicar', 'radicacion', 'presentar tutela', 'presentar pqrs', 'interponer'],
      nextAction: 'Preparar y verificar radicacion con soportes completos',
      taskTitle: 'Preparar paquete de radicacion',
      priority: 'ALTA',
    },
    {
      key: 'respuesta',
      terms: ['respuesta', 'respondio', 'contestacion', 'oficio', 'requerimiento'],
      nextAction: 'Revisar respuesta recibida y definir si procede replica o seguimiento',
      taskTitle: 'Analizar respuesta recibida',
      priority: 'MEDIA',
    },
    {
      key: 'silencio',
      terms: ['sin respuesta', 'no respond', 'silencio', 'vencido', 'vencio', 'termino'],
      nextAction: 'Verificar vencimiento de termino y preparar actuacion por falta de respuesta',
      taskTitle: 'Verificar termino vencido y ruta de reaccion',
      priority: 'ALTA',
    },
    {
      key: 'contacto_cliente',
      terms: ['llamar', 'llamada', 'contactar', 'whatsapp', 'cliente pregunta', 'cliente solicita'],
      nextAction: 'Contactar al cliente y cerrar informacion pendiente',
      taskTitle: 'Contactar al cliente para confirmar informacion',
      priority: 'MEDIA',
    },
    {
      key: 'documentos',
      terms: ['cedula', 'contrato', 'poder', 'factura', 'historia clinica', 'certificado', 'anexo', 'soporte'],
      nextAction: 'Completar revision documental antes de definir actuacion',
      taskTitle: 'Revisar documentos y soportes del expediente',
      priority: 'MEDIA',
    },
    {
      key: 'audiencia',
      terms: ['audiencia', 'diligencia', 'citacion', 'juzgado', 'despacho'],
      nextAction: 'Preparar actuacion para audiencia o diligencia programada',
      taskTitle: 'Preparar audiencia o diligencia',
      priority: 'ALTA',
    },
    {
      key: 'pago',
      terms: ['honorarios', 'pago', 'factura', 'cobro', 'cuota'],
      nextAction: 'Verificar estado de pago y coordinar comunicacion con cliente',
      taskTitle: 'Revisar estado de honorarios del caso',
      priority: 'MEDIA',
    },
  ];

  for (const rule of rules) {
    if (hasAny(lower, rule.terms)) matches.push(rule);
  }

  return matches;
}

function localAnalysis({ caseData, sourceText, sourceType }) {
  const text = String(sourceText || '').trim();
  const lower = text.toLowerCase();
  const sentences = splitSentences(text);
  const facts = sentences.slice(0, 6);
  const inputSignals = classifyInput(lower);

  const dateMatches = [...text.matchAll(/\b(?:20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/g)]
    .map(m => normalizeDate(m[0]))
    .filter(Boolean);

  const serviceType =
    lower.includes('tutela') ? 'TUTELA' :
    lower.includes('pqrs') || lower.includes('peticion') || lower.includes('queja') ? 'PQRS' :
    caseData.service_type || 'OTRO';

  const risks = [];
  if (lower.includes('vencio') || lower.includes('vencido') || lower.includes('termino')) {
    risks.push('Revisar termino o vencimiento mencionado en la conversacion.');
  }
  if (lower.includes('sin respuesta') || lower.includes('no respond')) {
    risks.push('Hay senal de falta de respuesta de entidad, contraparte o cliente.');
  }
  if (lower.includes('urgente') || lower.includes('inmediato')) {
    risks.push('El asunto fue descrito como urgente; validar prioridad y fecha critica.');
  }

  const documents = [];
  ['cedula', 'contrato', 'poder', 'factura', 'historia clinica', 'correo', 'certificado'].forEach(term => {
    if (lower.includes(term)) documents.push(`Verificar o solicitar ${term}.`);
  });

  const tasks = inputSignals.map(signal => ({
    title: signal.taskTitle,
    description: `Detectado por senales del insumo: ${signal.key}.`,
    priority: signal.priority,
    due_date: dateMatches[0] || null,
    confidence: 0.58,
  }));
  if (documents.length) {
    tasks.push({
      title: 'Revisar documentos faltantes o mencionados',
      description: documents.join(' '),
      priority: 'MEDIA',
      due_date: null,
      confidence: 0.55,
    });
  }
  if (!tasks.length) {
    tasks.push({
      title: 'Precisar insumo antes de crear actuacion',
      description: 'La Sala no detecto una accion operativa concreta en el texto. Conviene agregar fecha, entidad, respuesta recibida o documento faltante.',
      priority: 'BAJA',
      due_date: null,
      confidence: 0.35,
    });
  }

  const nextAction = inputSignals[0]?.nextAction || 'Solicitar o registrar mas contexto antes de cambiar la siguiente actuacion';
  const nextActionRationale = inputSignals.length
    ? `Sugerencia basada en senales detectadas: ${inputSignals.map(s => s.key).join(', ')}.`
    : 'No se detectaron senales suficientes para proponer una actuacion juridica concreta.';

  return {
    mode: 'local_fallback',
    source_type: sourceType,
    input_signals: inputSignals.map(s => s.key),
    executive_summary: facts[0] || `Analisis preliminar para ${caseData.case_number}.`,
    relevant_facts: facts.length ? facts : ['No se identificaron hechos suficientes en el texto ingresado.'],
    detected_parties: [],
    suggested_case_type: serviceType,
    suggested_status: caseData.status || 'EN_PROCESO',
    suggested_next_action: {
      title: nextAction,
      due_date: dateMatches[0] || null,
      rationale: nextActionRationale,
    },
    suggested_tasks: tasks,
    suggested_deadlines: dateMatches.map(date => ({
      title: 'Fecha detectada en insumo de Sala',
      due_date: date,
      urgency: 'MEDIO',
    })),
    missing_documents: documents,
    risks,
    open_questions: [
      'Confirmar si existe termino legal vigente.',
      'Confirmar documentos ya disponibles en expediente.',
      'Confirmar si la siguiente actuacion requiere aprobacion del abogado.',
    ],
    confidence: inputSignals.length ? 0.55 : 0.35,
  };
}

function buildSuggestions(analysis) {
  const suggestions = [];

  const hasConcreteSignal = Array.isArray(analysis.input_signals) && analysis.input_signals.length > 0;
  if (analysis.suggested_next_action?.title && hasConcreteSignal) {
    suggestions.push({
      suggestion_type: 'next_action',
      title: analysis.suggested_next_action.title,
      payload: {
        next_action: analysis.suggested_next_action.title,
        next_action_date: analysis.suggested_next_action.due_date || null,
        rationale: analysis.suggested_next_action.rationale || null,
      },
      confidence: analysis.confidence || 0.5,
    });
  }

  (analysis.suggested_tasks || []).slice(0, 8).forEach(task => {
    if (!task?.title) return;
    suggestions.push({
      suggestion_type: 'task',
      title: task.title,
      payload: {
        title: task.title,
        description: task.description || 'Sugerida por Sala de analisis.',
        priority: task.priority || 'MEDIA',
        due_date: task.due_date || null,
      },
      confidence: task.confidence || analysis.confidence || 0.5,
    });
  });

  (analysis.suggested_deadlines || []).slice(0, 8).forEach(deadline => {
    if (!deadline?.title || !deadline?.due_date) return;
    suggestions.push({
      suggestion_type: 'deadline',
      title: deadline.title,
      payload: {
        title: deadline.title,
        due_date: deadline.due_date,
        urgency: deadline.urgency || 'MEDIO',
      },
      confidence: deadline.confidence || analysis.confidence || 0.5,
    });
  });

  if (analysis.executive_summary) {
    suggestions.push({
      suggestion_type: 'communication',
      title: 'Guardar resumen de Sala en linea de tiempo',
      payload: {
        type: 'note',
        content: `Sala - resumen: ${analysis.executive_summary}`,
      },
      confidence: analysis.confidence || 0.5,
    });
  }

  return suggestions;
}

function normalizeAiAnalysis({ analysis, caseData, sourceText, sourceType }) {
  const fallback = localAnalysis({ caseData, sourceText, sourceType });
  const value = analysis && typeof analysis === 'object' ? analysis : {};

  return {
    ...fallback,
    ...value,
    executive_summary: value.executive_summary || fallback.executive_summary,
    relevant_facts: Array.isArray(value.relevant_facts) && value.relevant_facts.length
      ? value.relevant_facts
      : fallback.relevant_facts,
    detected_parties: Array.isArray(value.detected_parties) ? value.detected_parties : fallback.detected_parties,
    suggested_case_type: value.suggested_case_type || fallback.suggested_case_type,
    suggested_status: value.suggested_status || fallback.suggested_status,
    suggested_next_action: value.suggested_next_action?.title
      ? value.suggested_next_action
      : fallback.suggested_next_action,
    suggested_tasks: Array.isArray(value.suggested_tasks) && value.suggested_tasks.length
      ? value.suggested_tasks
      : fallback.suggested_tasks,
    suggested_deadlines: Array.isArray(value.suggested_deadlines) ? value.suggested_deadlines : fallback.suggested_deadlines,
    missing_documents: Array.isArray(value.missing_documents) ? value.missing_documents : fallback.missing_documents,
    risks: Array.isArray(value.risks) ? value.risks : fallback.risks,
    open_questions: Array.isArray(value.open_questions) && value.open_questions.length
      ? value.open_questions
      : fallback.open_questions,
    confidence: typeof value.confidence === 'number' ? value.confidence : fallback.confidence,
  };
}

function normalizeProviderResult({ providerResult, caseData, sourceText, sourceType }) {
  return {
    ...providerResult,
    analysis: normalizeAiAnalysis({
      analysis: providerResult.analysis,
      caseData,
      sourceText,
      sourceType,
    }),
  };
}

function buildPrompt({ caseData, sourceText, sourceType }) {
  return [
    {
      role: 'system',
      content: [
        'Eres la Sala de analisis juridico-operativo de Opus.',
        'Hablas como apoyo interno para abogados colombianos.',
        'No decides ni ejecutas actos juridicos. Solo produces sugerencias revisables.',
        'Devuelve exclusivamente JSON valido, sin markdown.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        prompt_version: PROMPT_VERSION,
        task: 'Analiza el insumo y convierte informacion dispersa en estructura operativa del caso.',
        expected_json_shape: {
          executive_summary: 'string',
          relevant_facts: ['string'],
          detected_parties: ['string'],
          suggested_case_type: 'string',
          suggested_status: 'string',
          suggested_next_action: { title: 'string', due_date: 'YYYY-MM-DD|null', rationale: 'string' },
          suggested_tasks: [{ title: 'string', description: 'string', priority: 'CRITICA|ALTA|MEDIA|BAJA', due_date: 'YYYY-MM-DD|null' }],
          suggested_deadlines: [{ title: 'string', due_date: 'YYYY-MM-DD', urgency: 'CRITICO|ALTO|MEDIO|BAJO' }],
          missing_documents: ['string'],
          risks: ['string'],
          open_questions: ['string'],
          confidence: 0.0,
        },
        case_context: compactCaseContext(caseData),
        source_type: sourceType,
        source_text: sourceText,
      }),
    },
  ];
}

function truncateText(text, maxLength = 900) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}...`;
}

function buildLocalPromptPayload({ caseData, sourceText, sourceType, runtime }) {
  const context = compactCaseContext(caseData);
  return {
    prompt_version: OLLAMA_PROMPT_VERSION,
    tarea: 'Analiza este texto concreto. No repitas acciones genericas. Si no hay accion clara, dilo en open_questions.',
    caso: {
      numero: context.case_number,
      titulo: context.title,
      tipo: context.service_type,
    },
    fuente: sourceType,
    texto: truncateText(sourceText, runtime.source_max_chars),
    json_obligatorio: {
      executive_summary: 'frase corta',
      relevant_facts: ['hecho corto'],
      input_signals: ['radicacion|respuesta|silencio|contacto_cliente|documentos|audiencia|pago'],
      suggested_next_action: { title: 'accion concreta segun texto', due_date: null, rationale: 'por que sale del texto' },
      suggested_tasks: [{ title: 'tarea concreta segun texto', priority: 'MEDIA', due_date: null }],
      open_questions: ['pregunta si falta informacion'],
      confidence: 0.4,
    },
  };
}

function buildOllamaPrompt({ caseData, sourceText, sourceType }) {
  const runtime = getRuntime('task');
  const payload = buildLocalPromptPayload({ caseData, sourceText, sourceType, runtime });
  return [
    {
      role: 'system',
      content: [
        'Eres Gemma Local, capa operativa de Opus.',
        'Tu trabajo es convertir insumos concretos en tareas, fechas, riesgos y siguientes acciones revisables.',
        'No redactas conceptos juridicos extensos ni ejecutas acciones.',
        'Si una accion no se desprende claramente del texto, dilo en open_questions.',
        'Responde SOLO JSON valido y breve.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(payload),
    },
  ];
}

function buildLiteRtPrompt({ caseData, sourceText, sourceType, runtime }) {
  const payload = buildLocalPromptPayload({ caseData, sourceText, sourceType, runtime });
  return {
    systemInstruction: [
      'Eres Gemma Local, capa operativa de Opus.',
      'Tu trabajo es convertir insumos concretos en tareas, fechas, riesgos y siguientes acciones revisables.',
      'No redactas conceptos juridicos extensos ni ejecutas acciones.',
      'Si una accion no se desprende claramente del texto, dilo en open_questions.',
      'Responde SOLO JSON valido y breve.',
    ].join(' '),
    prompt: JSON.stringify(payload),
  };
}

function buildGeminiPrompt({ caseData, sourceText, sourceType }) {
  return JSON.stringify({
    prompt_version: PROMPT_VERSION,
    task: 'Analiza el insumo y convierte informacion dispersa en estructura operativa del caso.',
    instructions: [
      'Extrae hechos concretos, partes, fechas y riesgos del texto.',
      'No inventes datos que no esten en el texto o el contexto del caso.',
      'Si el texto no contiene una accion clara, declaralo en open_questions.',
      'Las fechas deben estar en formato YYYY-MM-DD.',
      'Cada tarea sugerida debe ser accionable, no generica.',
    ],
    case_context: compactCaseContext(caseData),
    source_type: sourceType,
    source_text: sourceText,
  });
}

async function callGemini({ caseData, sourceText, sourceType }) {
  if (!geminiService.isAvailable()) return null;

  const systemInstruction = [
    'Eres la Sala de analisis juridico-operativo de Opus, para SC LegalTech (firma juridica colombiana).',
    'Tu trabajo es convertir insumos concretos en tareas, fechas, riesgos y siguientes acciones revisables.',
    'No decides ni ejecutas actos juridicos. Solo produces sugerencias que el abogado humano aprueba.',
    'No rellenes con generalidades. Si falta informacion, reporta en open_questions.',
    'Tu salida debe cumplir exactamente el schema JSON solicitado.',
  ].join(' ');

  const result = await geminiService.generateJson({
    systemInstruction,
    prompt: buildGeminiPrompt({ caseData, sourceText, sourceType }),
    temperature: 0.2,
  });

  return result;
}

async function callOpenAI({ caseData, sourceText, sourceType }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: buildPrompt({ caseData, sourceText, sourceType }),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
  if (!parsed) throw new Error('El proveedor IA no devolvio JSON valido');

  return {
    provider: 'openai',
    model,
    analysis: parsed,
    usage: data.usage || null,
  };
}

async function callOllama({ caseData, sourceText, sourceType, runtime, fallbackRuntime = null }) {
  const activePrimaryRuntime = runtime || getRuntime('task');
  if (activePrimaryRuntime.provider !== 'ollama') return null;
  if (!activePrimaryRuntime.baseUrl) return null;

  const messages = buildOllamaPrompt({ caseData, sourceText, sourceType });

  const callRuntime = async (candidate) => fetch(`${candidate.baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(candidate.timeout_ms),
    body: JSON.stringify({
      model: candidate.model,
      messages,
      stream: false,
      format: 'json',
      keep_alive: candidate.keep_alive,
      options: candidate.options,
    }),
  });

  let activeRuntime = activePrimaryRuntime;
  let response = await callRuntime(activeRuntime);

  if (!response.ok) {
    const errorText = await response.text();
    const memoryIssue = response.status >= 500 && /requires more system memory|out of memory|not enough memory/i.test(errorText);
    if (memoryIssue) {
      const fallback = fallbackRuntime || getFallbackRuntime('task', activePrimaryRuntime.profile);
      if (fallback.provider === 'ollama' && fallback.model !== activeRuntime.model) {
        activeRuntime = fallback;
        response = await callRuntime(activeRuntime);
      }
    }
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Ollama error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.message?.content || data.response;
  let parsed;
  try {
    parsed = extractJson(content);
  } catch (err) {
    parsed = null;
  }

  return {
    provider: 'ollama',
    model: activeRuntime.model,
    analysis: parsed || {
      provider_error: 'Ollama respondio, pero no devolvio JSON valido completo',
      ollama_raw: truncateText(content, 300),
    },
    usage: {
      prompt_tokens: null,
      completion_tokens: null,
      total_duration: data.total_duration || null,
      eval_count: data.eval_count || null,
      prompt_eval_count: data.prompt_eval_count || null,
    },
  };
}

async function callLiteRt({ caseData, sourceText, sourceType, runtime }) {
  const activeRuntime = runtime || getRuntime('task');
  if (activeRuntime.provider !== 'litert_lm') return null;

  const liteRtPrompt = buildLiteRtPrompt({ caseData, sourceText, sourceType, runtime: activeRuntime });
  const result = await runLiteRtPrompt({
    runtime: activeRuntime,
    systemInstruction: liteRtPrompt.systemInstruction,
    prompt: liteRtPrompt.prompt,
  });

  const parsed = extractJson(result.text);
  return {
    provider: 'litert_lm',
    model: result.model,
    analysis: parsed || {
      provider_error: 'LiteRT-LM respondio, pero no devolvio JSON valido completo',
      litert_raw: truncateText(result.text, 300),
    },
    usage: {
      prompt_tokens: null,
      completion_tokens: null,
    },
  };
}

async function callConfiguredProvider({ caseData, sourceText, sourceType, profileName = null }) {
  const primaryRuntime = getRuntime('task', profileName);
  const fallbackRuntime = getFallbackRuntime('task', profileName);
  const provider = profileName
    ? primaryRuntime.provider
    : (process.env.AI_PROVIDER || primaryRuntime.provider || 'gemini').toLowerCase();
  const strict = process.env.AI_STRICT === 'true';

  const callPrimaryLocal = async () => {
    if (primaryRuntime.provider === 'litert_lm') return callLiteRt({ caseData, sourceText, sourceType, runtime: primaryRuntime });
    if (primaryRuntime.provider === 'ollama') return callOllama({ caseData, sourceText, sourceType, runtime: primaryRuntime, fallbackRuntime });
    return null;
  };

  const callFallbackLocal = async () => {
    if (fallbackRuntime.profile === primaryRuntime.profile) return null;
    if (fallbackRuntime.provider === 'litert_lm') {
      return runLiteRtPrompt({
        runtime: fallbackRuntime,
        ...buildLiteRtPrompt({ caseData, sourceText, sourceType, runtime: fallbackRuntime }),
      }).then((result) => ({
        provider: 'litert_lm',
        model: result.model,
        analysis: extractJson(result.text) || {
          provider_error: 'LiteRT-LM respondio, pero no devolvio JSON valido completo',
          litert_raw: truncateText(result.text, 300),
        },
        usage: { prompt_tokens: null, completion_tokens: null },
      }));
    }
    if (fallbackRuntime.provider === 'ollama') {
      return callOllama({ caseData, sourceText, sourceType, runtime: fallbackRuntime, fallbackRuntime });
    }
    return null;
  };

  // Gemini es el motor primario del agente. Tiene prioridad sobre cualquier
  // proveedor local salvo que AI_PROVIDER se fije explicitamente a otra cosa.
  if (provider === 'gemini') {
    try {
      const gemini = await callGemini({ caseData, sourceText, sourceType });
      if (gemini) return gemini;
    } catch (err) {
      console.warn('[caseIntelligence] Gemini fallo:', err.message);
      if (strict) throw err;
    }
    // Fallback: OpenAI si esta configurado
    try {
      const openai = await callOpenAI({ caseData, sourceText, sourceType });
      if (openai) return openai;
    } catch (err) {
      console.warn('[caseIntelligence] OpenAI fallo:', err.message);
      if (strict) throw err;
    }
    return null;
  }

  if (provider === 'openai') {
    const openai = await callOpenAI({ caseData, sourceText, sourceType });
    if (openai) return openai;
    if (strict) throw new Error('OpenAI no disponible y AI_STRICT=true');
    return null;
  }

  if (provider === 'auto') {
    // Cascada completa: Gemini → OpenAI → local primario → local fallback
    try {
      const gemini = await callGemini({ caseData, sourceText, sourceType });
      if (gemini) return gemini;
    } catch (err) {
      if (strict) throw err;
    }
    try {
      const openai = await callOpenAI({ caseData, sourceText, sourceType });
      if (openai) return openai;
    } catch (err) {
      if (strict) throw err;
    }
    try {
      const primary = await callPrimaryLocal();
      if (primary) return primary;
    } catch (err) {
      if (strict) throw err;
    }
    try {
      const fallback = await callFallbackLocal();
      if (fallback) return fallback;
    } catch (err) {
      if (strict) throw err;
    }
    return null;
  }

  // provider === 'litert_lm' | 'ollama' : flujo local legacy
  try {
    const primary = await callPrimaryLocal();
    if (primary) return primary;
  } catch (err) {
    if (strict) throw err;
  }

  const fallback = await callFallbackLocal();
  if (fallback) return fallback;

  return null;
}

async function analyzeCase({ caseData, sourceText, sourceType = 'nota', profileName = null }) {
  const cleanText = String(sourceText || '').trim();
  if (cleanText.length < 20) {
    const err = new Error('El texto para analizar debe tener al menos 20 caracteres');
    err.status = 400;
    throw err;
  }

  try {
    const providerResult = await callConfiguredProvider({ caseData, sourceText: cleanText, sourceType, profileName });
    if (providerResult) {
      const normalizedResult = normalizeProviderResult({
        providerResult,
        caseData,
        sourceText: cleanText,
        sourceType,
      });
      return {
        provider: normalizedResult.provider,
        model: normalizedResult.model,
        prompt_version: PROMPT_VERSION,
        input_hash: inputHash(cleanText),
        usage: normalizedResult.usage,
        analysis: normalizedResult.analysis,
        suggestions: buildSuggestions(normalizedResult.analysis),
      };
    }
  } catch (err) {
    if (process.env.AI_STRICT === 'true') throw err;
    const fallback = localAnalysis({ caseData, sourceText: cleanText, sourceType });
    fallback.provider_error = err.message;
    return {
      provider: 'local',
      model: 'fallback-rules',
      prompt_version: PROMPT_VERSION,
      input_hash: inputHash(cleanText),
      usage: null,
      analysis: fallback,
      suggestions: buildSuggestions(fallback),
      provider_error: err.message,
    };
  }

  const fallback = localAnalysis({ caseData, sourceText: cleanText, sourceType });
  return {
    provider: 'local',
    model: 'fallback-rules',
    prompt_version: PROMPT_VERSION,
    input_hash: inputHash(cleanText),
    usage: null,
    analysis: fallback,
    suggestions: buildSuggestions(fallback),
  };
}

module.exports = {
  analyzeCase,
  PROMPT_VERSION,
};
