/**
 * @deprecated DESDE FASE 3 — el agente Phi del chat ya no usa LiteRT. Los proveedores
 * locales viven en `agentProviders/qwen.provider.js` (Ollama). Sigue aquí solo
 * para `caseIntelligence.service` y `agentProactive.controller`. Ver FASE5_MIGRATION.md.
 */

const { spawn } = require('child_process');
const path = require('path');

function toWslPath(winPath) {
  const normalized = path.resolve(winPath).replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!match) return normalized;
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function runProcess(command, args, { stdin = null, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Tiempo de espera agotado al ejecutar ${command}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

function buildConversationPrompt(messages = []) {
  return messages
    .map((message) => `${String(message.role || 'user').toUpperCase()}:\n${String(message.content || '').trim()}`)
    .join('\n\n');
}

function parseBridgeResult(result) {
  if (result.code !== 0) {
    const message = (result.stderr || result.stdout || '').trim();
    throw new Error(message || `LiteRT-LM terminó con código ${result.code}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout.trim() || '{}');
  } catch (err) {
    throw new Error(`LiteRT-LM devolvió una respuesta no válida: ${result.stdout.trim()}`);
  }

  if (!parsed.ok) {
    throw new Error(parsed.error || 'LiteRT-LM no pudo completar la petición');
  }

  return parsed;
}

function buildWslArgs(runtime) {
  const bridgePath = toWslPath(path.join(__dirname, '..', '..', 'scripts', 'litert_bridge.py'));
  const args = [];
  if (runtime.wsl_distro) args.push('-d', runtime.wsl_distro);
  args.push(
    '--exec',
    '/usr/bin/env',
    `SC_LITERT_INSTALL_DIR=${String(runtime.install_dir).replace(/\\/g, '/')}`,
    `SC_LITERT_CACHE_DIR=${String(runtime.cache_dir).replace(/\\/g, '/')}`,
    '/usr/bin/python3',
    bridgePath
  );
  return { command: 'wsl.exe', args };
}

function buildDockerArgs(runtime) {
  const args = [
    'run',
    '--rm',
    '-i',
    '-e', 'SC_LITERT_INSTALL_DIR=/opt/litert',
    '-e', 'SC_LITERT_CACHE_DIR=/root/.litert-lm',
    '-v', `${runtime.docker_home_volume}:/root/.litert-lm`,
    runtime.docker_image,
    '/usr/local/bin/python',
    '/opt/sc/litert_bridge.py',
  ];

  return { command: 'docker', args };
}

function resolveExecutor(runtime) {
  return runtime.executor === 'docker' ? buildDockerArgs(runtime) : buildWslArgs(runtime);
}

async function callLiteRtBridge(runtime, payload) {
  const executor = resolveExecutor(runtime);
  const result = await runProcess(executor.command, executor.args, {
    stdin: JSON.stringify(payload),
    timeoutMs: runtime.timeout_ms,
  });
  return parseBridgeResult(result);
}

async function runLiteRtChat({ runtime, systemInstruction, messages }) {
  const result = await callLiteRtBridge(runtime, {
    hf_repo: runtime.hf_repo,
    model_file: runtime.model,
    model_ref: runtime.model_ref,
    preset_path: runtime.executor === 'docker' ? '/opt/sc/litert_preset.py' : toWslPath(path.join(__dirname, '..', '..', 'scripts', 'litert_preset.py')),
    system_instruction: systemInstruction,
    prompt: buildConversationPrompt(messages),
    timeout_s: Math.max(Math.ceil(runtime.timeout_ms / 1000), 30),
  });

  return {
    provider: 'litert_lm',
    model: runtime.model_label || runtime.model,
    text: result.text || '',
    raw: result.raw || null,
  };
}

async function runLiteRtPrompt({ runtime, systemInstruction, prompt }) {
  const result = await callLiteRtBridge(runtime, {
    hf_repo: runtime.hf_repo,
    model_file: runtime.model,
    model_ref: runtime.model_ref,
    preset_path: runtime.executor === 'docker' ? '/opt/sc/litert_preset.py' : toWslPath(path.join(__dirname, '..', '..', 'scripts', 'litert_preset.py')),
    system_instruction: systemInstruction,
    prompt,
    timeout_s: Math.max(Math.ceil(runtime.timeout_ms / 1000), 30),
  });

  return {
    provider: 'litert_lm',
    model: runtime.model_label || runtime.model,
    text: result.text || '',
    raw: result.raw || null,
  };
}

async function getLiteRtHealth(runtime) {
  try {
    if (runtime.executor === 'docker') {
      const result = await runProcess('docker', ['image', 'inspect', runtime.docker_image], { timeoutMs: 15000 });
      if (result.code !== 0) {
        return {
          ok: false,
          error: `No existe la imagen Docker ${runtime.docker_image}.`,
        };
      }

      const cliCheck = await callLiteRtBridge(runtime, { command: 'health' });
      return {
        ok: true,
        runtime: 'litert_lm',
        executor: 'docker',
        cli_available: Boolean(cliCheck.cli_available),
        model_file: runtime.model,
        hf_repo: runtime.hf_repo,
        docker_image: runtime.docker_image,
        docker_home_volume: runtime.docker_home_volume,
      };
    }

    const result = await runProcess(
      'wsl.exe',
      runtime.wsl_distro
        ? ['-d', runtime.wsl_distro, '--exec', '/bin/echo', 'ok']
        : ['--exec', '/bin/echo', 'ok'],
      { timeoutMs: 12000 }
    );

    if (result.code !== 0 || !String(result.stdout || '').toLowerCase().includes('ok')) {
      return {
        ok: false,
        error: (result.stderr || result.stdout || '').trim() || 'WSL no respondió correctamente',
      };
    }

    const cliCheck = await callLiteRtBridge(runtime, { command: 'health' });
    return {
      ok: true,
      runtime: 'litert_lm',
      executor: 'wsl',
      cli_available: Boolean(cliCheck.cli_available),
      model_file: runtime.model,
      hf_repo: runtime.hf_repo,
      wsl_distro: runtime.wsl_distro,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getLiteRtHealth,
  runLiteRtChat,
  runLiteRtPrompt,
  toWslPath,
};
