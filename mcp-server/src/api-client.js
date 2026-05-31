/**
 * api-client.js — SC LegalTech · Opus MCP Server
 *
 * Cliente HTTP delgado para /api/v1/*.
 * Todas las respuestas siguen el contrato canónico { success, data|error }.
 * Desenvuelve automáticamente el envelope y lanza Error si success === false.
 */

import { request } from 'node:http';
import { request as requestHttps } from 'node:https';
import { config } from './config.js';
import { getCurrentActorId, getCurrentToolName } from './actor-context.js';

// Métodos que mutan estado. Tras una mutación exitosa registramos un
// agent_action (Constitución §XII: toda acción del agente queda auditada) que,
// además, dispara el trigger pg_notify → bus en vivo del Puente de Mando.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function extractCaseId(path) {
  const m = String(path).match(/\/cases\/(\d+)/);
  return m ? Number(m[1]) : null;
}

// Audita una mutación llamando al propio backend (/agent/actions). El INSERT
// dispara el trigger pg_notify → bus en vivo del Puente de Mando.
//
// Fire-and-forget: NO se espera. Así el tool responde al instante (sin sumar la
// latencia del log) y la auditoría + el evento en vivo ocurren en segundo plano.
// Best-effort: si falla, no rompe la tool. El guard de path evita recursión
// infinita (el log es a su vez un POST).
function logMutation(method, path, data) {
  if (!MUTATING_METHODS.has(method)) return;
  // Anti-recursión + rutas ya auditadas por su propio flujo:
  if (path.startsWith('/agent/actions') || path.startsWith('/agent/plans')) return;

  const toolName = getCurrentToolName();
  const caseId = extractCaseId(path)
    ?? (data && (data.case_id ?? data.caseId)) ?? null;

  apiCall('POST', '/agent/actions', {
    action_type: toolName ? `mcp.${toolName}` : `mcp.${method}`,
    case_id: caseId,
    params: { method, path },
    result: { id: (data && (data.id ?? null)) || null },
    status: 'executed',
  }).catch(() => {
    // Auditoría best-effort — nunca tumbar la tool por un fallo de log.
  });
}

function requestJson(url, init) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? requestHttps : request;
    const req = transport(
      parsed,
      {
        method: init.method,
        headers: init.headers,
        timeout: 30000,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => resolve({
          status: res.statusCode || 0,
          ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          text,
        }));
      }
    );

    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);

    if (init.body) req.write(init.body);
    req.end();
  });
}

/**
 * Realiza una llamada a la API v1.
 *
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path   — p.ej. '/cases' o '/cases/SC-2026-0001'
 * @param {object|null}  body   — payload JSON para POST/PUT/PATCH
 * @returns {Promise<any>}       — el campo `data` del envelope v1
 * @throws {Error}               — si la API devuelve success=false o error HTTP
 */
export async function apiCall(method, path, body = null) {
  const url = `${config.apiUrl}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiToken}`,
  };

  // Si la tool corre dentro de un contexto con actor (lo inyectó el backend
  // vía `_actor_user_id` y el wrapper de server.js lo dejó en ALS), reenviamos
  // la identidad al backend para que aplique RBAC con el usuario real, no con
  // la cuenta de servicio MCP.
  const actorId = getCurrentActorId();
  if (actorId != null) {
    headers['X-On-Behalf-Of'] = String(actorId);
  }

  const init = { method, headers };

  if (body !== null) {
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await requestJson(url, init);
  } catch (networkErr) {
    throw new Error(`No se pudo conectar al backend (${url}): ${networkErr.message}`);
  }

  let json;
  try {
    json = JSON.parse(res.text);
  } catch {
    throw new Error(`Respuesta no-JSON del backend — HTTP ${res.status} en ${path}`);
  }

  // Envelope v1: { success, data } | { success: false, error }
  let result;
  if (typeof json.success === 'boolean') {
    if (!json.success) {
      throw new Error(json.error || `Error ${res.status} en ${method} ${path}`);
    }
    result = json.data;
  } else if (!res.ok) {
    // Fallback: respuesta sin envelope (ruta legacy o health check)
    throw new Error(json.error || json.message || `HTTP ${res.status} en ${path}`);
  } else {
    result = json;
  }

  logMutation(method, path, result);
  return result;
}

/** Shorthand para peticiones GET con query params opcionales. */
export function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    )
  ).toString();
  return apiCall('GET', qs ? `${path}?${qs}` : path);
}

export const post   = (path, body = {}) => apiCall('POST',   path, body);
export const put    = (path, body = {}) => apiCall('PUT',    path, body);
export const patch  = (path, body = {}) => apiCall('PATCH',  path, body);
export const del    = (path)            => apiCall('DELETE', path);
