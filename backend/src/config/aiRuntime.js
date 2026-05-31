/**
 * @deprecated DESDE FASE 3 — los providers del nuevo agentLoop leen sus propias
 * env vars (OLLAMA_AGENT_MODEL, GEMINI_MODEL). Este config sigue vivo solo para
 * caseIntelligence.service y proactiveAgent.service. No agregar perfiles nuevos.
 * Ver FASE5_MIGRATION.md para el camino de borrado.
 */

const DEFAULT_PROFILE = 'gemma4_litert_e2b';

const PROFILES = {
  gemma4_litert_e2b: {
    label: 'Gemma 4 official local',
    familyLabel: 'Gemma 4',
    provider: 'litert_lm',
    providerLabel: 'Official runtime',
    executor: 'docker',
    model: 'gemma-4-E2B-it.litertlm',
    modelLabel: 'Gemma 4 E2B',
    modelRef: 'sc-gemma4-e2b',
    hfRepo: 'litert-community/gemma-4-E2B-it-litert-lm',
    wslDistro: 'Ubuntu',
    installDir: '$HOME/.opus-litert',
    cacheDir: '$HOME/.cache/litert-lm',
    task: {
      temperature: 0,
      num_ctx: 1024,
      num_predict: 120,
    },
    chat: {
      temperature: 0.2,
      num_ctx: 2048,
      num_predict: 256,
    },
  },
  gemma4_ollama_q4: {
    label: 'Gemma 4 compatibility fallback',
    familyLabel: 'Gemma 4',
    provider: 'ollama',
    providerLabel: 'Compatibility runtime',
    model: 'batiai/gemma4-e2b:q4',
    modelLabel: 'Gemma 4 compatibility',
    keepAlive: '0s',
    task: {
      temperature: 0,
      num_ctx: 1024,
      num_predict: 180,
      num_thread: 4,
      num_batch: 64,
    },
    chat: {
      temperature: 0.2,
      num_ctx: 1536,
      num_predict: 256,
      num_thread: 4,
      num_batch: 64,
    },
  },
  gemma4_ollama_e2b: {
    label: 'Gemma 4 compatibility full',
    familyLabel: 'Gemma 4',
    provider: 'ollama',
    providerLabel: 'Compatibility runtime',
    model: 'gemma4:e2b',
    modelLabel: 'Gemma 4 E2B',
    keepAlive: '0s',
    task: {
      temperature: 0,
      num_ctx: 768,
      num_predict: 180,
      num_thread: 4,
      num_batch: 64,
    },
    chat: {
      temperature: 0.2,
      num_ctx: 1536,
      num_predict: 512,
      num_thread: 4,
      num_batch: 64,
    },
  },
  qwen2_5_1_5b: {
    label: 'Qwen 2.5 1.5B local',
    familyLabel: 'Qwen 2.5',
    provider: 'ollama',
    providerLabel: 'Ollama',
    model: 'qwen2.5:1.5b',
    modelLabel: 'Qwen 2.5 1.5B',
    keepAlive: '0s',
    task: {
      temperature: 0,
      num_ctx: 1536,
      num_predict: 220,
      num_thread: 4,
      num_batch: 64,
    },
    chat: {
      temperature: 0.3,
      num_ctx: 3072,
      num_predict: 900,
      num_thread: 4,
      num_batch: 64,
    },
  },
  qwen2_5_0_5b: {
    label: 'Qwen 2.5 0.5B local',
    familyLabel: 'Qwen 2.5',
    provider: 'ollama',
    providerLabel: 'Ollama',
    model: 'qwen2.5:0.5b',
    modelLabel: 'Qwen 2.5 0.5B',
    keepAlive: '0s',
    task: {
      temperature: 0,
      num_ctx: 1024,
      num_predict: 160,
      num_thread: 4,
      num_batch: 64,
    },
    chat: {
      temperature: 0.35,
      num_ctx: 2048,
      num_predict: 700,
      num_thread: 4,
      num_batch: 64,
    },
  },
};

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeProfileName(name) {
  return String(name || '').trim().toLowerCase();
}

function getProfileName(overrideName = null) {
  const requested = normalizeProfileName(overrideName || process.env.AI_LOCAL_PROFILE || DEFAULT_PROFILE);
  return PROFILES[requested] ? requested : DEFAULT_PROFILE;
}

function getFallbackProfileName(primaryName = getProfileName(), overrideFallbackName = null) {
  const explicitPrimary = getProfileName(primaryName);
  if (overrideFallbackName) {
    const requestedOverride = normalizeProfileName(overrideFallbackName);
    if (PROFILES[requestedOverride] && requestedOverride !== explicitPrimary) return requestedOverride;
  }
  const requested = normalizeProfileName(process.env.AI_FALLBACK_PROFILE || '');
  if (!requested || requested === explicitPrimary) return explicitPrimary;
  return PROFILES[requested] ? requested : explicitPrimary;
}

function getProfile() {
  const name = getProfileName();
  return { name, ...PROFILES[name] };
}

function getProfileByName(name) {
  const resolved = PROFILES[name] ? name : DEFAULT_PROFILE;
  return { name: resolved, ...PROFILES[resolved] };
}

function envPrefixFor(surface, provider) {
  if (provider === 'litert_lm') return surface === 'chat' ? 'LITERT_LM_CHAT' : 'LITERT_LM_TASK';
  return surface === 'chat' ? 'OLLAMA_CHAT' : 'OLLAMA_TASK';
}

function buildOllamaRuntime(profile, surface = 'task') {
  const defaults = profile[surface] || profile.task;
  const prefix = envPrefixFor(surface, 'ollama');

  return {
    profile: profile.name,
    profile_label: profile.label,
    family_label: profile.familyLabel || profile.modelLabel || profile.label,
    provider: 'ollama',
    provider_label: profile.providerLabel || 'Ollama',
    model: process.env.OLLAMA_MODEL_OVERRIDE || profile.model,
    model_label: process.env.OLLAMA_MODEL_LABEL_OVERRIDE || profile.modelLabel || profile.model,
    baseUrl: (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, ''),
    keep_alive: process.env.OLLAMA_KEEP_ALIVE || profile.keepAlive || '0s',
    timeout_ms: intEnv(`${prefix}_TIMEOUT_MS`, intEnv('OLLAMA_TIMEOUT_MS', 90000)),
    source_max_chars: intEnv('OLLAMA_SOURCE_MAX_CHARS', intEnv('AI_SOURCE_MAX_CHARS', 900)),
    options: {
      temperature: floatEnv(`${prefix}_TEMPERATURE`, floatEnv('OLLAMA_TEMPERATURE', defaults.temperature)),
      num_ctx: intEnv(`${prefix}_NUM_CTX`, intEnv('OLLAMA_NUM_CTX', defaults.num_ctx)),
      num_predict: intEnv(`${prefix}_NUM_PREDICT`, intEnv('OLLAMA_NUM_PREDICT', defaults.num_predict)),
      num_thread: intEnv(`${prefix}_NUM_THREAD`, intEnv('OLLAMA_NUM_THREAD', defaults.num_thread)),
      num_batch: intEnv(`${prefix}_NUM_BATCH`, intEnv('OLLAMA_NUM_BATCH', defaults.num_batch)),
    },
  };
}

function buildLiteRtRuntime(profile, surface = 'task') {
  const defaults = profile[surface] || profile.task;
  const prefix = envPrefixFor(surface, 'litert_lm');

  return {
    profile: profile.name,
    profile_label: profile.label,
    family_label: profile.familyLabel || profile.modelLabel || profile.label,
    provider: 'litert_lm',
    provider_label: profile.providerLabel || 'LiteRT-LM',
    model: process.env.LITERT_LM_MODEL_FILE_OVERRIDE || profile.model,
    model_label: process.env.LITERT_LM_MODEL_LABEL_OVERRIDE || profile.modelLabel || profile.model,
    model_ref: process.env.LITERT_LM_MODEL_REF_OVERRIDE || process.env.LITERT_LM_MODEL_REF || profile.modelRef || null,
    hf_repo: process.env.LITERT_LM_HF_REPO_OVERRIDE || profile.hfRepo,
    executor: process.env.LITERT_LM_EXECUTOR || profile.executor || 'wsl',
    docker_image: process.env.LITERT_LM_DOCKER_IMAGE || 'opus-litert-lm:latest',
    docker_home_volume: process.env.LITERT_LM_DOCKER_HOME_VOLUME || 'opus_litert_home',
    wsl_distro: process.env.LITERT_LM_WSL_DISTRO || profile.wslDistro || 'Ubuntu',
    install_dir: process.env.LITERT_LM_INSTALL_DIR || profile.installDir || '$HOME/.opus-litert',
    cache_dir: process.env.LITERT_LM_CACHE_DIR || profile.cacheDir || '$HOME/.cache/litert-lm',
    timeout_ms: intEnv(`${prefix}_TIMEOUT_MS`, intEnv('LITERT_LM_TIMEOUT_MS', 180000)),
    source_max_chars: intEnv('LITERT_LM_SOURCE_MAX_CHARS', intEnv('AI_SOURCE_MAX_CHARS', 900)),
    options: {
      temperature: floatEnv(`${prefix}_TEMPERATURE`, floatEnv('LITERT_LM_TEMPERATURE', defaults.temperature)),
      num_ctx: intEnv(`${prefix}_NUM_CTX`, intEnv('LITERT_LM_NUM_CTX', defaults.num_ctx)),
      num_predict: intEnv(`${prefix}_NUM_PREDICT`, intEnv('LITERT_LM_NUM_PREDICT', defaults.num_predict)),
    },
  };
}

function buildRuntimeFromProfile(profile, surface = 'task') {
  if (profile.provider === 'litert_lm') return buildLiteRtRuntime(profile, surface);
  return buildOllamaRuntime(profile, surface);
}

function getRuntime(surface = 'task', profileName = null) {
  const profile = profileName ? getProfileByName(getProfileName(profileName)) : getProfile();
  return buildRuntimeFromProfile(profile, surface);
}

function getFallbackRuntime(surface = 'task', primaryProfileName = null) {
  const primaryName = getProfileName(primaryProfileName);
  const fallbackName = getFallbackProfileName(primaryName);
  return buildRuntimeFromProfile(getProfileByName(fallbackName), surface);
}

function listProfiles() {
  return Object.entries(PROFILES).map(([id, profile]) => ({
    id,
    label: profile.label,
    family_label: profile.familyLabel || profile.modelLabel || profile.label,
    provider: profile.provider,
    provider_label: profile.providerLabel || profile.provider,
    model_label: profile.modelLabel || profile.model,
    recommended: id === DEFAULT_PROFILE,
  }));
}

function getAiRuntimeSummary(profileName = null) {
  const task = getRuntime('task', profileName);
  const chat = getRuntime('chat', profileName);
  const fallback = getFallbackRuntime('task', profileName);

  return {
    provider: task.provider,
    provider_label: task.provider_label,
    strict: boolEnv('AI_STRICT', false),
    local_profile: task.profile,
    local_profile_label: task.profile_label,
    family_label: task.family_label || task.model_label || task.model,
    model: task.model,
    model_label: task.model_label || task.model,
    fallback_profile: fallback.profile !== task.profile ? fallback.profile : null,
    fallback_model: fallback.profile !== task.profile ? fallback.model : null,
    ollama_base_url: task.provider === 'ollama' ? task.baseUrl || null : null,
    ollama_model: task.provider === 'ollama' ? task.model : null,
    ollama_keep_alive: task.provider === 'ollama' ? task.keep_alive : null,
    litert_lm_hf_repo: task.provider === 'litert_lm' ? task.hf_repo : null,
    litert_lm_model_ref: task.provider === 'litert_lm' ? task.model_ref : null,
    litert_lm_executor: task.provider === 'litert_lm' ? task.executor : null,
    litert_lm_docker_image: task.provider === 'litert_lm' ? task.docker_image : null,
    litert_lm_docker_home_volume: task.provider === 'litert_lm' ? task.docker_home_volume : null,
    litert_lm_wsl_distro: task.provider === 'litert_lm' ? task.wsl_distro : null,
    task_options: task.options,
    chat_options: chat.options,
  };
}

module.exports = {
  PROFILES,
  boolEnv,
  listProfiles,
  getAiRuntimeSummary,
  getFallbackRuntime,
  getProfile,
  getProfileByName,
  getProfileName,
  getRuntime,
  intEnv,
};
