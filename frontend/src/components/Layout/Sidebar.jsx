import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useAgent } from '../../context/AgentContext';
import { useSelfHosted } from '../../context/SelfHostedContext';
import NavIcon from './NavIcon';
import api from '../../services/api';

function Item({ to, icon, label, badge, end }) {
  return (
    <NavLink to={to} end={end} title={label} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <span className="nav-icon"><NavIcon name={icon} /></span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge}
    </NavLink>
  );
}

export default function Sidebar({ mobileOpen = false, onClose }) {
  const { user, logout } = useAuth();
  const { firm } = useSelfHosted();
  const { sidebarCollapsed, setSidebarCollapsed, isAiFocusMode } = useAgent();
  const navigate = useNavigate();
  const [pendingTasks, setPendingTasks] = useState(0);
  const [activeProjects, setActiveProjects] = useState(0);
  const [waUnread, setWaUnread] = useState(0);

  const firmName = firm?.brand_name || user?.name || 'Mi firma';
  const firmLogo = firm?.logo_url || null;
  const firmInitial = String(firmName).trim().charAt(0).toUpperCase() || 'F';

  const refreshBadges = () => {
    api.get('/tareas?limit=100')
      .then(res => {
        const activas = res.data.filter(t =>
          t.status === 'PENDIENTE' || t.status === 'EN_CURSO'
        ).length;
        setPendingTasks(activas);
      })
      .catch(() => {});

    api.get('/macrocasos?status=ACTIVO')
      .then(res => setActiveProjects(res.data.length))
      .catch(() => {});

    api.get('/whatsapp/conversations', { params: { status: 'open', limit: 100 } })
      .then(res => {
        const total = (res.data?.conversations || [])
          .reduce((acc, c) => acc + (Number(c.unread_count) || 0), 0);
        setWaUnread(total);
      })
      .catch(() => {});

  };

  useEffect(() => {
    refreshBadges();
    const interval = setInterval(refreshBadges, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleNavClick = (event) => {
    if (event.target.closest('a')) onClose?.();
  };

  return (
    <aside className={`sidebar${sidebarCollapsed ? ' sidebar--collapsed' : ''}${isAiFocusMode ? ' sidebar--agent-focus' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="sidebar-logo">
        <div className="sidebar-brand">
          <span className="sidebar-brand-mark" aria-hidden="true">
            {firmLogo
              ? <img src={firmLogo} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : firmInitial}
          </span>
          <div className="sidebar-brand-copy">
            <div className="firm-name">{firmName}</div>
            <div className="firm-tagline">Opus</div>
          </div>
        </div>
        <button
          className="sidebar-collapse-btn"
          type="button"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          title={sidebarCollapsed ? 'Expandir menu' : 'Colapsar menu'}
          aria-label={sidebarCollapsed ? 'Expandir menu' : 'Colapsar menu'}
        >
          {sidebarCollapsed ? '>' : '<'}
        </button>
        <button
          className="sidebar-mobile-close"
          type="button"
          onClick={onClose}
          aria-label="Cerrar menu"
          title="Cerrar menu"
        >
          x
        </button>
      </div>

      <nav className="sidebar-nav" onClick={handleNavClick}>
        <div className="nav-section-title">Hoy</div>
        <Item to="/" end icon="dashboard" label="Despacho" />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Requiere mi visto bueno</div>
        <Item
          to="/aprobaciones"
          icon="shieldCheck"
          label="Autorizaciones"
        />
        <Item to="/planes" icon="clipboardList" label="Planes de accion" />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Casos</div>
        <Item to="/cases" icon="folder" label="Casos" />
        <Item to="/clients" icon="users" label="Clientes" />
        <Item
          to="/projects"
          icon="layers"
          label="Proyectos"
          badge={activeProjects > 0 && <span className="nav-badge">{activeProjects}</span>}
        />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Entra</div>
        <Item to="/recepcion" icon="inbox" label="Recepcion" />
        <Item
          to="/whatsapp"
          icon="message"
          label="WhatsApp"
          badge={waUnread > 0 && <span className="nav-badge">{waUnread}</span>}
        />
        <Item to="/prospects" icon="userPlus" label="Prospectos" />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Radar e inteligencia</div>
        <Item to="/radar-colombia" icon="radio" label="Radar Colombia" />
        <Item to="/radar-competitivo" icon="trendingUp" label="Radar competitivo" />
        <Item to="/kaizen" icon="sparkles" label="Mejora del despacho" />
        <Item to="/productividad" icon="activity" label="Mi Productividad" />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Trabajo</div>
        <Item
          to="/tasks"
          icon="checkSquare"
          label="Escritorio"
          badge={pendingTasks > 0 && <span className="nav-badge">{pendingTasks}</span>}
        />
        <Item to="/library" icon="book" label="Biblioteca" />
        <Item to="/vault" icon="lock" label="Caja fuerte" />

        <div className="nav-section-title" style={{ marginTop: 'var(--sp-5)' }}>Sistema</div>
        <Item to="/integrations" icon="link" label="Integraciones" />
        <Item to="/judicial-agents" icon="scale" label="Agentes Judiciales" />
        <Item to="/settings" icon="settings" label="Configuracion" />
      </nav>

      <div className="sidebar-user">
        <div className="user-name">{user?.name}</div>
        <div className="user-role" style={{ textTransform: 'capitalize' }}>{user?.role}</div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 'var(--sp-2)', width: '100%', fontSize: '0.75rem' }}
          onClick={handleLogout}
        >
          Cerrar sesion
        </button>
      </div>
    </aside>
  );
}
