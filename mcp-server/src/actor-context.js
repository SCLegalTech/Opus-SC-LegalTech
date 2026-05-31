/**
 * actor-context.js — SC LegalTech · Opus MCP Server
 *
 * AsyncLocalStorage para propagar la identidad del usuario que originó la
 * llamada (el "actor") desde el wrapper de tool hasta api-client.js sin que
 * cada handler tenga que recibir el dato como argumento.
 *
 * Por qué existe: el SDK MCP entrega los argumentos validados por zod al
 * handler de la tool, pero no expone un contexto de request. Para enviar el
 * header X-On-Behalf-Of al backend necesitamos saber el id del usuario que
 * disparó la conversación. El backend lo inyecta en `_actor_user_id` dentro
 * de los argumentos; aquí lo extraemos antes de llamar al handler y lo
 * dejamos en el AsyncLocalStorage para que api-client lo lea.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

const store = new AsyncLocalStorage();

export function runWithActor(actorUserId, fn, toolName = null) {
  return store.run({ actorUserId: actorUserId ?? null, toolName: toolName ?? null }, fn);
}

export function getCurrentActorId() {
  const ctx = store.getStore();
  return ctx?.actorUserId ?? null;
}

/** Nombre del tool en ejecución (para auditar agent_actions en api-client). */
export function getCurrentToolName() {
  const ctx = store.getStore();
  return ctx?.toolName ?? null;
}
