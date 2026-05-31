import { useEffect } from 'react';
import api from '../services/api';

// Telemetría frontend ligera.
//
// - Cola en memoria del módulo (compartida entre todos los consumidores).
// - Flush automático cada FLUSH_INTERVAL_MS o cuando la cola alcanza
//   BATCH_THRESHOLD (lo que ocurra primero).
// - fetch keepalive en visibilitychange/pagehide para no perder eventos
//   al cerrar la pestaña. sendBeacon NO se usa porque no soporta
//   Authorization headers (el endpoint backend exige Bearer JWT).
// - Sin user/token: la cola NO se vacía vía network — los eventos pre-auth
//   se DESCARTAN en login para evitar atribución cruzada (un usuario A
//   loguea, sus page_views anónimos de /login no deben llegar como user A
//   y mucho menos como user B si A no completó signup). El frontend debe
//   llamar resetQueue() explícitamente en login/logout.
// - Best-effort: si POST falla con error HTTP, los eventos quedan en cola
//   para retry. Si backend responde 200 con accepted:0 (telemetry
//   desactivada / migración pendiente), también se consideran enviados
//   para no inflar memoria con eventos no almacenables.
//
// Whitelist de event_type controlada por el backend (events.controller.js).

const QUEUE = [];
const FLUSH_INTERVAL_MS = 5000;
const BATCH_THRESHOLD = 20;
const MAX_QUEUE = 200; // Tope defensivo: si nunca se envía, no infla memoria.

let timerId = null;
let unloadHandlerRegistered = false;

// Limpia la cola — usar en login y logout para no mezclar identidades.
export function resetQueue() {
  QUEUE.length = 0;
  if (timerId) { clearTimeout(timerId); timerId = null; }
}

// Encola un evento. Idempotente — el caller puede llamarlo en render sin
// preocuparse de duplicar timers; el siguiente flush los manda juntos.
export function track(eventType, metadata = {}, page = null) {
  if (!eventType || typeof eventType !== 'string') return;

  QUEUE.push({
    event_type: eventType,
    page: page || (typeof window !== 'undefined' ? window.location.pathname : null),
    metadata,
  });

  // Si la cola creció demasiado sin flush exitoso, descartamos los más
  // viejos (preferimos perder telemetría a inflar memoria).
  if (QUEUE.length > MAX_QUEUE) QUEUE.splice(0, QUEUE.length - MAX_QUEUE);

  if (QUEUE.length >= BATCH_THRESHOLD) {
    flush();
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  if (timerId) return;
  timerId = setTimeout(() => {
    timerId = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush() {
  if (QUEUE.length === 0) return;
  // Tomamos snapshot y vaciamos. Si falla, re-encolamos al inicio.
  const batch = QUEUE.splice(0, Math.min(QUEUE.length, 50));
  try {
    await api.post('/events', { events: batch });
  } catch {
    // Reinsertamos al inicio para reintentar en el próximo flush. Sin
    // backoff sofisticado — el timer reactivo es suficiente.
    QUEUE.unshift(...batch);
  }
}

// fetch keepalive: sobrevive a unload sin necesidad de un endpoint
// separado (que sendBeacon requiere porque no setea Authorization).
// keepalive tiene un límite de ~64KB por request en la mayoría de
// browsers — el batch máximo de 50 eventos cabe holgado.
function flushOnUnload() {
  if (QUEUE.length === 0) return;
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('sc_token') : null;
  if (!token) { QUEUE.length = 0; return; }
  const batch = QUEUE.splice(0);
  try {
    const base = (import.meta.env?.VITE_API_URL || '').replace(/\/$/, '');
    const url = `${base}/api/events`;
    fetch(url, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ events: batch }),
    }).catch(() => { /* unload: no podemos hacer más */ });
  } catch {
    /* ignore */
  }
}

function registerUnloadHandler() {
  if (unloadHandlerRegistered || typeof window === 'undefined') return;
  unloadHandlerRegistered = true;
  // visibilitychange es preferido a beforeunload en mobile/iOS.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushOnUnload();
    }
  });
  window.addEventListener('pagehide', flushOnUnload);
}

// Hook opcional para componentes que quieran track de page_view al montar.
// Uso: useTrackPageView('admin/overview')
export function useTrackPageView(page, metadata) {
  useEffect(() => {
    registerUnloadHandler();
    track('page_view', metadata || {}, page);
    // Solo al montar — re-mount con misma page no re-dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
}

// API pública: track y flush manual (útil al hacer logout para enviar
// lo que quede antes de borrar el token).
export default { track, flush };
