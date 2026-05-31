/**
 * config.js — SC LegalTech · Opus MCP Server
 * Lee variables de entorno y expone la configuración tipada.
 */

export const config = {
  /** URL base de la API v1, sin barra final. */
  apiUrl: (process.env.MCP_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, ''),

  /** JWT del usuario que actúa como agente. */
  apiToken: process.env.MCP_API_TOKEN || '',

  /** Token servidor-servidor requerido para abrir el transporte HTTP/SSE. */
  httpAuthToken: process.env.MCP_HTTP_AUTH_TOKEN || process.env.MCP_API_TOKEN || '',

  /** Origenes permitidos para clientes browser. Vacio = sin CORS browser. */
  corsOrigins: (process.env.MCP_CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /** "stdio" para Claude Desktop; "http" para agente web vía SSE. */
  transport: (process.env.MCP_TRANSPORT || 'stdio').toLowerCase(),

  /** Puerto del servidor HTTP cuando transport === "http". */
  httpPort: parseInt(process.env.MCP_HTTP_PORT || '4001', 10),
};

if (!config.apiToken) {
  // Advertencia temprana — el servidor arrancará pero las llamadas fallarán con 401
  process.stderr.write(
    '[MCP] AVISO: MCP_API_TOKEN no está configurado. Las herramientas devolverán 401.\n'
  );
}

if (config.transport === 'http' && !config.httpAuthToken) {
  process.stderr.write(
    '[MCP] AVISO: MCP_HTTP_AUTH_TOKEN/MCP_API_TOKEN no configurado. El transporte HTTP rechazara /sse y /message.\n'
  );
}
