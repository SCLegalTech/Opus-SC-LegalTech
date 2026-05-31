/**
 * liveBus.service.js â€” Bus de eventos en vivo (Puente de Mando Â· F2)
 *
 * ProyecciÃ³n EFÃMERA del path agÃ©ntico hacia los navegadores conectados.
 * NO es fuente de verdad: `agent_actions` (append-only) lo es. Si el proceso
 * reinicia, el bus se vacÃ­a y los clientes re-sincronizan vÃ­a HTTP normal.
 *
 * Arquitectura (ver docs/arquitectura/puente-de-mando-ux.md Â§7):
 *   agent_actions  â”€â”€(trigger AFTER INSERT â†’ pg_notify)â”€â”€â–º  LISTEN dedicado
 *        â”‚                                                       â”‚
 *   fuente de verdad                                    liveBus.publish(event)
 *                                                                â”‚
 *                                                  SSE GET /api/agent/stream
 *                                                  (filtrado por organizacion)
 *
 * El bus es deliberadamente neutral a la fuente de emisiÃ³n: hoy se alimenta
 * de pg_notify, pero cualquier parte del backend puede `publish(...)` (p.ej.
 * eventos de `presence` o `step` que no pasan por la base de datos).
 *
 * AISLAMIENTO POR ORGANIZACION:
 *   Un evento solo llega a un suscriptor si coinciden de organizacion. Con org
 *   conocido se exige mismo `orgId`; sin org en el JWT se restringe al mismo
 *   `userId` (conservador: nunca cruza organizaciones).
 */

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
// Muchos tabs/usuarios pueden estar suscritos a la vez; sin lÃ­mite de listeners.
emitter.setMaxListeners(0);

const CHANNEL = 'live';

/**
 * Â¿Es `event` visible para el suscriptor `sub`?
 * @param {{orgId: (number|null), userId: (number|string)}} sub
 * @param {{orgId: (number|null), userId: (number|string|null)}} event
 */
function isVisible(sub, event) {
  if (sub.orgId != null) {
    return event.orgId != null && String(event.orgId) === String(sub.orgId);
  }
  // Sin org en el contexto del suscriptor: restringir a su propio user_id.
  return event.userId != null && String(event.userId) === String(sub.userId);
}

/**
 * Publica un evento en el bus. Debe traer al menos `type` y los campos de
 * scope (`orgId` y/o `userId`) para poder filtrarse.
 * @param {{type: string, orgId?: number|null, userId?: number|string|null}} event
 */
function publish(event) {
  if (!event || !event.type) return;
  const enriched = { ts: new Date().toISOString(), ...event };
  emitter.emit(CHANNEL, enriched);
}

/**
 * Suscribe un handler a los eventos visibles para `sub`.
 * @param {{orgId: (number|null), userId: (number|string)}} sub
 * @param {(event: object) => void} handler
 * @returns {() => void} unsubscribe
 */
function subscribe(sub, handler) {
  const listener = (event) => {
    try {
      if (isVisible(sub, event)) handler(event);
    } catch (_) {
      // Un suscriptor nunca debe tumbar el bus.
    }
  };
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}

module.exports = { publish, subscribe, _isVisible: isVisible };
