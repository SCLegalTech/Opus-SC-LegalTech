const { getAiRuntimeSummary, getRuntime, listProfiles } = require('../config/aiRuntime');
const { getLiteRtHealth } = require('../services/litertLm.service');
const proactiveAgent = require('../services/proactiveAgent.service');
const geminiService = require('../services/gemini.service');
const agentTools = require('../services/agentTools.service');

async function getProviderHealth(profileName = null) {
  const runtime = getRuntime('task', profileName);

  if (runtime.provider === 'litert_lm') {
    return getLiteRtHealth(runtime);
  }

  if (runtime.provider === 'ollama') {
    if (!runtime.baseUrl) {
      return { ok: false, error: 'OLLAMA_BASE_URL no configurado' };
    }

    try {
      const res = await fetch(`${runtime.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        return { ok: false, error: `Ollama HTTP ${res.status}` };
      }
      const data = await res.json();
      const models = Array.isArray(data.models) ? data.models.map((model) => model.name) : [];
      return {
        ok: true,
        runtime: 'ollama',
        model_configured: runtime.model,
        model_available: models.includes(runtime.model),
        models,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { ok: false, error: `Proveedor no soportado: ${runtime.provider}` };
}

async function status(req, res) {
  const includeHealth = req.query.health === 'true';
  const profileName = req.query.profile || null;
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  // Filtrar profiles: solo dejar los que tienen modelo realmente instalado en Ollama.
  // Asi el selector del header del chat nunca muestra un perfil que daria 404.
  let installedOllamaModels = new Set();
  const summary = getAiRuntimeSummary(profileName);
  if (summary.ollama_base_url) {
    try {
      const r = await fetch(`${summary.ollama_base_url}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) {
        const data = await r.json();
        installedOllamaModels = new Set((data.models || []).map((m) => m.name));
      }
    } catch {
      // si Ollama no responde, devolvemos todos los profiles igual; el frontend
      // mostrara el aviso "runtime local no disponible"
      installedOllamaModels = null;
    }
  }

  const allProfiles = listProfiles();
  const availableProfiles = installedOllamaModels === null ? allProfiles : allProfiles
    .map((p) => {
      // listProfiles devuelve metadata; necesitamos el modelo real para chequear.
      const runtime = getRuntime('chat', p.id);
      const hasModel = runtime.provider === 'ollama'
        ? installedOllamaModels.has(runtime.model)
        : true; // litert_lm asume health propio
      return { ...p, available: hasModel, model: runtime.model };
    })
    .filter((p) => p.available);

  // Opcion "Gemini" como provider seleccionable (cuando hay API key y circuito no abierto).
  const circuit = geminiService.getCircuitState();
  const providerOptions = [];
  if (geminiService.isAvailable()) {
    providerOptions.push({
      id: 'gemini',
      kind: 'remote',
      family_label: 'Gemini',
      model_label: geminiService.DEFAULT_MODEL,
      available: true,
      recommended: true,
    });
  } else if (process.env.GEMINI_API_KEY && circuit.open) {
    providerOptions.push({
      id: 'gemini',
      kind: 'remote',
      family_label: 'Gemini',
      model_label: `${geminiService.DEFAULT_MODEL} (cuota agotada)`,
      available: false,
      recommended: false,
    });
  }
  availableProfiles.forEach((p) => providerOptions.push({
    id: p.id,
    kind: 'local',
    family_label: p.family_label,
    model_label: p.model_label,
    available: true,
    recommended: !providerOptions.some((x) => x.recommended),
  }));

  const payload = {
    provider,
    primary_provider: provider,
    gemini: {
      available: geminiService.isAvailable(),
      model: geminiService.DEFAULT_MODEL,
      circuit,
    },
    runtime: summary,
    profiles: availableProfiles,
    provider_options: providerOptions,
    tools: {
      total: agentTools.getToolManifest().length,
      manifest: agentTools.getToolManifest(),
    },
    autopilot: {
      enabled: ['1', 'true', 'yes', 'on'].includes(String(process.env.AGENT_AUTOPILOT_ENABLED || '').toLowerCase()),
      interval_minutes: parseInt(process.env.AGENT_AUTOPILOT_INTERVAL_MINUTES || '60', 10),
      batch_limit: parseInt(process.env.AGENT_AUTOPILOT_BATCH_LIMIT || '5', 10),
      min_plan_gap_hours: parseInt(process.env.AGENT_AUTOPILOT_MIN_PLAN_GAP_HOURS || '18', 10),
    },
  };

  if (includeHealth) {
    const providerHealth = await getProviderHealth(profileName);
    payload.provider_health = providerHealth;
    if (payload.runtime.provider === 'ollama') {
      payload.ollama = providerHealth;
    }
  }

  res.json(payload);
}

async function toolsManifest(req, res) {
  res.json({
    total: agentTools.getToolManifest().length,
    tools: agentTools.getToolManifest(),
  });
}

async function runProactive(req, res) {
  const { dry_run = false, limit } = req.body || {};
  const result = await proactiveAgent.runProactiveSweep({
    userId: req.user?.id || null,
    dryRun: Boolean(dry_run),
    limit,
  });
  res.json(result);
}

module.exports = {
  runProactive,
  status,
  toolsManifest,
};
