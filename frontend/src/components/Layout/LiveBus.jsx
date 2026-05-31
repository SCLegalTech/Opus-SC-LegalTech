import { useEffect } from 'react';

/**
 * LiveBus — cliente del canal en vivo del Puente de Mando (F2).
 *
 * Abre GET /api/agent/stream (SSE) con fetch + Bearer (EventSource no admite
 * headers de auth) y re-despacha cada evento como evento de `window`:
 *
 *   - `opus-live`     evento crudo {type, actionType, caseId, clientId, ...}
 *                     para consumidores nuevos (barra de Puente de Mando, F3).
 *   - `phi-mutation`  compatibilidad: las páginas que ya lo escuchan
 *                     (p.ej. CaseDetail) refrescan sin que el usuario recargue.
 *
 * Asi, cuando el abogado ordena desde un cliente MCP externo, el cambio
 * aterriza en agent_actions → NOTIFY → backend → SSE → aquí → la pantalla de
 * Opus se actualiza sola. Reconecta solo si la conexión cae.
 *
 * No renderiza nada; vive en el shell autenticado (Layout).
 */
export default function LiveBus() {
  useEffect(() => {
    const state = { stop: false, controller: null, timer: null };

    const handleEvent = (event) => {
      if (!event || !event.type || event.type === 'connected') return;
      window.dispatchEvent(new CustomEvent('opus-live', { detail: event }));
      if (event.type === 'mutation') {
        window.dispatchEvent(new CustomEvent('phi-mutation', {
          detail: {
            source: 'mcp',
            actionType: event.actionType,
            caseId: event.caseId,
            clientId: event.clientId,
          },
        }));
      }
    };

    const connect = async () => {
      if (state.stop) return;
      const token = localStorage.getItem('sc_token');
      if (!token) {
        // Sin sesión aún; reintentar más tarde por si el login llega después.
        state.timer = setTimeout(connect, 5000);
        return;
      }

      const apiBase = import.meta.env.VITE_API_URL
        ? import.meta.env.VITE_API_URL.replace(/\/$/, '')
        : '';
      state.controller = new AbortController();

      try {
        const res = await fetch(`${apiBase}/api/agent/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: state.controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!state.stop) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              handleEvent(JSON.parse(raw));
            } catch {
              // fragmento incompleto o comentario — ignorar
            }
          }
        }
      } catch {
        // caída de red / abort — se reintenta abajo
      }

      if (!state.stop) {
        state.timer = setTimeout(connect, 3000); // reconexión
      }
    };

    connect();

    return () => {
      state.stop = true;
      if (state.timer) clearTimeout(state.timer);
      try { state.controller?.abort(); } catch { /* noop */ }
    };
  }, []);

  return null;
}
