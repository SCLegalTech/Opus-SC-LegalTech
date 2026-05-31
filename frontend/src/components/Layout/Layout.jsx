import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Sidebar     from './Sidebar';
import AgentPanel  from '../AgentPanel/AgentPanel';
// TimeTrackerWidget oculto temporalmente — pendiente rediseño de Time
// Tracking. Para re-habilitar: descomentar el import y el <TimeTrackerWidget />
// abajo. Backend de time tracking (endpoints /api/time/*) sigue activo.
// import TimeTrackerWidget from '../TimeTracking/TimeTrackerWidget';
import LiveBus     from './LiveBus';
import PuenteDeMando from './PuenteDeMando';
import { AgentProvider, useAgent } from '../../context/AgentContext';

function LayoutShell() {
  const { isAiFocusMode } = useAgent();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-layout${isAiFocusMode ? ' app-layout--ai-focus' : ''}`}>
      <div
        className={`mobile-nav-backdrop${mobileNavOpen ? ' mobile-nav-backdrop--visible' : ''}`}
        onClick={() => setMobileNavOpen(false)}
        aria-hidden="true"
      />
      <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      <div className={`main-content${isAiFocusMode ? ' main-content--ai-focus' : ''}`}>
        <PuenteDeMando />
        <div className="mobile-app-bar">
          <button
            className="mobile-menu-btn"
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Abrir menu principal"
          >
            <span />
            <span />
            <span />
          </button>
          <div>
            <div className="mobile-app-title">Opus</div>
            <div className="mobile-app-subtitle">SC LegalTech</div>
          </div>
        </div>
        <Outlet />
      </div>
      <AgentPanel />
      {/* <TimeTrackerWidget /> — oculto, ver comentario del import */}
      <LiveBus />
    </div>
  );
}

export default function Layout() {
  return (
    <AgentProvider>
      <LayoutShell />
    </AgentProvider>
  );
}
