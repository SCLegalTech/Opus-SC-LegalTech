/**
 * index.js — SC LegalTech · Opus MCP Server
 * Φ · Una mejor realidad es posible
 *
 * Punto de entrada. Selecciona el transporte según MCP_TRANSPORT:
 *
 *   stdio  (defecto) — para Claude Desktop y cualquier cliente MCP estándar.
 *                      El proceso se comunica por stdin/stdout.
 *
 *   http             — servidor SSE sobre HTTP para el agente web interno.
 *                      Escucha en MCP_HTTP_PORT (defecto: 4001).
 *
 * Uso:
 *   node src/index.js                      # stdio
 *   MCP_TRANSPORT=http node src/index.js   # HTTP/SSE
 */

import { createServer } from './server.js';
import { config }       from './config.js';
import { timingSafeEqual } from 'node:crypto';

async function main() {
  if (config.transport === 'http') {
    // En HTTP, cada conexión SSE crea su propio McpServer (el SDK no permite
    // reusar una instancia entre transports concurrentes — bug observado en
    // producción cuando >1 cliente abría /sse al mismo tiempo).
    await startHttp();
  } else {
    const server = createServer();
    await startStdio(server);
  }
}

// ── Transporte stdio ──────────────────────────────────────────────────────────

async function startStdio(server) {
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write(
    '[MCP] Opus MCP Server iniciado — transporte: stdio\n'
  );
}

// ── Transporte HTTP / SSE ─────────────────────────────────────────────────────

async function startHttp() {
  const { SSEServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/sse.js'
  );
  const http = await import('node:http');

  // Mapa de sesiones activas: sessionId → { transport, server }
  const sessions = new Map();

  const safeEqual = (a, b) => {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    return left.length === right.length && timingSafeEqual(left, right);
  };

  const requestToken = (req, url) => {
    const auth = req.headers.authorization || '';
    if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim();
    const headerToken = req.headers['x-mcp-token'];
    if (headerToken) return Array.isArray(headerToken) ? headerToken[0] : headerToken;
    return url.searchParams.get('token') || '';
  };

  const isAuthorized = (req, url) =>
    Boolean(config.httpAuthToken) && safeEqual(requestToken(req, url), config.httpAuthToken);

  const applyCors = (req, res) => {
    const origin = req.headers.origin;
    const allowed = config.corsOrigins;
    if (!origin || !allowed.length) return true;
    if (allowed.includes('*') || allowed.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-MCP-Token');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      return true;
    }
    return false;
  };

  const rejectUnauthorized = (res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP HTTP no autorizado' }));
  };

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${config.httpPort}`);

    const corsOk = applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(corsOk ? 204 : 403).end();
      return;
    }

    // GET /sse — establece la conexión SSE y entrega el endpoint de mensajes
    if (req.method === 'GET' && url.pathname === '/sse') {
      if (!isAuthorized(req, url)) return rejectUnauthorized(res);

      // Una instancia de McpServer NUEVA por conexión: el SDK lanza
      // "Already connected to a transport" si reusamos. Crear es barato:
      // solo registra los handlers de tools en memoria.
      const server = createServer();
      const transport = new SSEServerTransport('/message', res);
      sessions.set(transport.sessionId, { transport, server });

      transport.onclose = () => sessions.delete(transport.sessionId);

      await server.connect(transport);
      return;
    }

    // POST /message — recibe mensajes JSON-RPC del cliente MCP
    if (req.method === 'POST' && url.pathname === '/message') {
      if (!isAuthorized(req, url)) return rejectUnauthorized(res);

      const sessionId = url.searchParams.get('sessionId');
      const session = sessions.get(sessionId);

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Sesión MCP no encontrada' }));
        return;
      }

      let body = '';
      for await (const chunk of req) body += chunk;

      await session.transport.handlePostMessage(req, res, JSON.parse(body));
      return;
    }

    // Health check
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status:     'OK',
        server:     'opus-mcp',
        transport:  'http',
        sessions:   sessions.size,
        apiUrl:     config.apiUrl,
      }));
      return;
    }

    res.writeHead(404).end();
  });

  httpServer.listen(config.httpPort, () => {
    process.stderr.write(
      `[MCP] Opus MCP Server iniciado — transporte: HTTP/SSE` +
      ` — http://localhost:${config.httpPort}/sse\n`
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  process.stderr.write(`[MCP] Error fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
