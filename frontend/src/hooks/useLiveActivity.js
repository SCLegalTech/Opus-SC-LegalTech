import { useEffect, useRef, useState } from 'react';

/**
 * Hooks de presencia en vivo (Puente de Mando · F3).
 *
 * Escuchan los eventos `opus-live` que emite LiveBus (F2) y exponen señales
 * efímeras para resaltar dónde está actuando el agente — en la fila de un caso,
 * en el nodo de un expediente, etc. La presencia se apaga sola tras `timeoutMs`.
 */

const DEFAULT_TIMEOUT = 6000;

/**
 * Devuelve un Set con los `caseId` que tuvieron actividad reciente.
 * Útil para listas: cada fila comprueba `activos.has(c.id)`.
 */
export function useActiveCaseIds(timeoutMs = DEFAULT_TIMEOUT) {
  const [active, setActive] = useState(() => new Set());
  const timers = useRef(new Map());

  useEffect(() => {
    const onLive = (e) => {
      const ev = e.detail;
      if (!ev || ev.type !== 'mutation' || ev.caseId == null) return;
      const id = ev.caseId;
      setActive((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      const existing = timers.current.get(id);
      if (existing) clearTimeout(existing);
      timers.current.set(id, setTimeout(() => {
        setActive((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        timers.current.delete(id);
      }, timeoutMs));
    };

    window.addEventListener('opus-live', onLive);
    const timersMap = timers.current;
    return () => {
      window.removeEventListener('opus-live', onLive);
      timersMap.forEach(clearTimeout);
      timersMap.clear();
    };
  }, [timeoutMs]);

  return active;
}

/**
 * Devuelve `true` durante `timeoutMs` tras un evento `opus-live` que cumpla
 * `predicate(ev)`. Para resaltar un objeto concreto (un caso, un nodo).
 */
export function useLivePulse(predicate, timeoutMs = DEFAULT_TIMEOUT) {
  const [pulsing, setPulsing] = useState(false);
  const timer = useRef(null);
  const predRef = useRef(predicate);
  predRef.current = predicate;

  useEffect(() => {
    const onLive = (e) => {
      const ev = e.detail;
      if (!ev || ev.type !== 'mutation') return;
      let match = false;
      try { match = predRef.current(ev); } catch { match = false; }
      if (!match) return;
      setPulsing(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setPulsing(false), timeoutMs);
    };
    window.addEventListener('opus-live', onLive);
    return () => {
      window.removeEventListener('opus-live', onLive);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [timeoutMs]);

  return pulsing;
}
