import { useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';

/**
 * PuenteDeMando — barra global de la torre de control (F3).
 *
 * Vive sobre toda pantalla autenticada. Consume los eventos `opus-live` que
 * emite LiveBus (F2) y muestra:
 *   - Presencia: si el agente actuó hace poco → "Phi trabajando" (dorado vivo).
 *   - Actividad en vivo: las últimas mutaciones, con cajón desplegable.
 *   - Cola de visto bueno: cuántas acciones sensibles esperan al humano.
 *
 * Es la version visible del bus: cuando el abogado ordena desde un cliente MCP,
 * ve aqui la actividad en vivo sin recargar.
 */

const PRESENCE_TIMEOUT_MS = 12000;
const MAX_EVENTS = 25;

// Acciones conocidas → texto legible. Fallback: limpia el action_type crudo.
const ACTION_LABELS = {
  'mcp.create_task':     'creó una tarea',
  'mcp.update_task':     'actualizó una tarea',
  'mcp.create_case':     'creó un caso',
  'mcp.update_case':     'actualizó un caso',
  'mcp.create_deadline': 'creó un vencimiento',
  'mcp.add_case_note':   'dejó una nota',
  'mcp.add_communication': 'registró una comunicación',
  'mcp.create_client':   'creó un cliente',
  'mcp.update_client':   'actualizó un cliente',
  'mcp.document_draft':  'redactó un documento',
};

function labelFor(actionType) {
  if (!actionType) return 'actividad';
  if (ACTION_LABELS[actionType]) return ACTION_LABELS[actionType];
  return String(actionType).replace(/^mcp\./, '').replace(/[._]/g, ' ');
}

export default function PuenteDeMando() {
  const [events, setEvents] = useState([]);
  const [active, setActive] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const timerRef = useRef(null);

  // Eventos en vivo del bus (F2).
  useEffect(() => {
    const onLive = (e) => {
      const ev = e.detail;
      if (!ev || ev.type !== 'mutation') return;
      setEvents((prev) => [{ ...ev, _rx: Date.now() }, ...prev].slice(0, MAX_EVENTS));
      setActive(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setActive(false), PRESENCE_TIMEOUT_MS);
    };
    window.addEventListener('opus-live', onLive);
    return () => {
      window.removeEventListener('opus-live', onLive);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const last = events[0];

  return (
    <div className="puente-mando">
      <div className="pm-presence">
        <span className={`pm-dot${active ? ' pm-dot--active' : ''}`} aria-hidden="true" />
        <span className="pm-presence-text">{active ? 'Phi trabajando' : 'En reposo'}</span>
        {last && (
          <button type="button" className="pm-last" onClick={() => setDrawerOpen((o) => !o)} title="Ver actividad en vivo">
            {labelFor(last.actionType)}{last.caseId ? ` · caso #${last.caseId}` : ''}
          </button>
        )}
      </div>

      <div className="pm-right">
        <button type="button" className="pm-activity-toggle" onClick={() => setDrawerOpen((o) => !o)}>
          Actividad{events.length ? ` · ${events.length}` : ''}
        </button>
        <NavLink to="/aprobaciones" className="pm-approvals" title="Acciones que esperan tu visto bueno">
          Visto bueno
        </NavLink>
      </div>

      {drawerOpen && (
        <div className="pm-drawer">
          <div className="pm-drawer-head">
            <span className="pm-drawer-title">Actividad en vivo</span>
            <button type="button" className="pm-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Cerrar">x</button>
          </div>
          {events.length === 0 ? (
            <div className="pm-drawer-empty">
              Sin actividad reciente. Cuando el agente actue desde Opus o desde un cliente MCP, lo veras aterrizar aqui.
            </div>
          ) : (
            <ul className="pm-drawer-list">
              {events.map((ev, i) => (
                <li key={ev.id ?? i}>
                  <span className="pm-drawer-action">{labelFor(ev.actionType)}</span>
                  {ev.caseId ? <span className="pm-drawer-meta">caso #{ev.caseId}</span> : null}
                  <span className="pm-drawer-time">
                    {new Date(ev._rx).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
