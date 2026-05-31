/**
 * mcpClient.service.js
 *
 * Cliente MCP que el backend usa para hablar con su propio mcp-server.
 *
 * Por qué este servicio existe (Fase 1 de la migración a arquitectura MCP):
 *   Hoy el agente Phi tiene un catálogo paralelo de tools (agentTools.service.js)
 *   que duplica el catálogo del mcp-server. Eso obliga a mantener dos verdades
 *   y por eso el comportamiento entre la UI y los clientes externos diverge.
 *   Este cliente conecta el backend al bus único de tools, vía JSON-RPC sobre
 *   SSE. Más adelante (Fase 3) reemplazará el catálogo paralelo.
 *
 * El SDK @modelcontextprotocol/sdk es ESM-only y el backend es CommonJS, por eso
 * todas las importaciones del SDK se hacen vía dynamic import().
 */

const MCP_SERVER_URL    = process.env.MCP_SERVER_URL    || 'http://mcp-server:4001';
const MCP_CLIENT_ENABLED = (process.env.MCP_CLIENT_ENABLED || 'true').toLowerCase() !== 'false';
const CONNECT_TIMEOUT_MS = parseInt(process.env.MCP_CLIENT_TIMEOUT_MS || '15000', 10);
const MCP_HTTP_AUTH_TOKEN = process.env.MCP_HTTP_AUTH_TOKEN || process.env.MCP_API_TOKEN || '';

// Estado del cliente. Singleton — una sola conexión SSE persistente al mcp-server.
let client      = null;     // instancia del Client del SDK
let transport   = null;     // SSEClientTransport
let toolsCache  = [];       // catálogo crudo devuelto por listTools()
let connected   = false;
let lastError   = null;
let connectingPromise = null;

/**
 * Conecta al mcp-server y carga el catálogo de tools.
 * Es idempotente: si ya está conectado o conectándose, devuelve la promesa actual.
 */
async function connect() {
  if (!MCP_CLIENT_ENABLED) {
    return { connected: false, reason: 'MCP_CLIENT_ENABLED=false' };
  }
  if (connected) {
    return { connected: true, tools_count: toolsCache.length };
  }
  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    try {
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');

      const url = new URL('/sse', MCP_SERVER_URL);
      const transportOptions = MCP_HTTP_AUTH_TOKEN
        ? { requestInit: { headers: { Authorization: `Bearer ${MCP_HTTP_AUTH_TOKEN}` } } }
        : undefined;
      transport = new SSEClientTransport(url, transportOptions);

      client = new Client(
        { name: 'opus-backend', version: '1.0.0' },
        { capabilities: {} }
      );

      const connectWithTimeout = Promise.race([
        client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`MCP connect timeout (${CONNECT_TIMEOUT_MS}ms)`)), CONNECT_TIMEOUT_MS)
        ),
      ]);
      await connectWithTimeout;

      const listed = await client.listTools();
      toolsCache = Array.isArray(listed?.tools) ? listed.tools : [];
      connected  = true;
      lastError  = null;

      return { connected: true, tools_count: toolsCache.length, url: url.toString() };
    } catch (err) {
      lastError = err;
      connected = false;
      client    = null;
      transport = null;
      return { connected: false, error: err.message };
    } finally {
      connectingPromise = null;
    }
  })();

  return connectingPromise;
}

/**
 * Lista las tools disponibles en el formato crudo del SDK MCP.
 * Cada tool: { name, description, inputSchema }.
 */
function listTools() {
  return toolsCache.slice();
}

/**
 * Ejecuta una tool por nombre.
 * @param {string} name
 * @param {object} args
 * @param {object} [options]
 * @param {{id: number|string, role?: string}|null} [options.actor]
 *   Identidad del usuario que originó la llamada. Se inyecta como
 *   `_actor_user_id` dentro de los argumentos para que mcp-server la extraiga
 *   y la propague al backend vía header X-On-Behalf-Of. Si no se pasa actor,
 *   la tool corre con la identidad por defecto del servicio MCP.
 * @returns {Promise<{ok: boolean, output: any, error?: string}>}
 */
async function callTool(name, args = {}, options = {}) {
  if (!connected || !client) {
    return { ok: false, error: 'MCP client no conectado' };
  }
  const finalArgs = { ...(args || {}) };
  if (options.actor && options.actor.id != null) {
    finalArgs._actor_user_id = options.actor.id;
  }
  try {
    const result = await client.callTool({ name, arguments: finalArgs });
    if (result?.isError) {
      const text = (result.content || []).map((c) => c.text).filter(Boolean).join('\n');
      return { ok: false, error: text || 'Tool reportó error sin detalle' };
    }
    return { ok: true, output: result };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Estado del cliente para healthchecks y diagnóstico.
 */
function getStatus() {
  return {
    enabled: MCP_CLIENT_ENABLED,
    connected,
    server_url: MCP_SERVER_URL,
    tools_count: toolsCache.length,
    last_error: lastError ? lastError.message : null,
  };
}

/**
 * Cierra la conexión (útil en shutdown ordenado).
 */
async function close() {
  if (client) {
    try { await client.close(); } catch { /* noop */ }
  }
  client = null;
  transport = null;
  connected = false;
  toolsCache = [];
}

module.exports = {
  connect,
  listTools,
  callTool,
  getStatus,
  close,
};
