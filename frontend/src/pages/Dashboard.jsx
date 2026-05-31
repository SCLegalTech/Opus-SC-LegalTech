import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import CapabilityStatus from '../components/CapabilityStatus';

// ─── Helpers ────────────────────────────────────────────────

const formatCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n ?? 0);

const formatDate = (d) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
};

const diasHasta = (d) => {
  if (!d) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fecha = new Date(d); fecha.setHours(0,0,0,0);
  return Math.ceil((fecha - hoy) / (1000 * 60 * 60 * 24));
};

const labelDias = (d) => {
  const n = diasHasta(d);
  if (n === null) return '';
  if (n < 0)  return `vencido hace ${Math.abs(n)}d`;
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `en ${n}d`;
};

const truncate = (value, max = 86) => {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}...` : value;
};

const formatCount = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const STATUS_LABELS = {
  NUEVO: 'Nuevo', EN_PROCESO: 'En proceso',
  PENDIENTE_CLIENTE: 'Pendiente cliente', PENDIENTE_ENTIDAD: 'Pendiente entidad',
  PENDIENTE_PAGO: 'Pendiente pago', CERRADO: 'Cerrado', ARCHIVADO: 'Archivado',
  // compat v1
  PENDIENTE: 'Pendiente',
};

const URGENCY_META = {
  CRITICO: { label: 'Crítico', cls: 'urgency-critico' },
  ALTO:    { label: 'Alto',    cls: 'urgency-alto'    },
  MEDIA:   { label: 'Media',   cls: 'urgency-media'   },
  MEDIO:   { label: 'Medio',   cls: 'urgency-media'   },
  BAJA:    { label: 'Baja',    cls: 'urgency-baja'    },
  BAJO:    { label: 'Bajo',    cls: 'urgency-baja'    },
};

const ACTUACION_LABELS = {
  RADICACION: 'Radicación', NOTIFICACION: 'Notificación',
  RESPUESTA_ENTIDAD: 'Resp. entidad', AUDIENCIA: 'Audiencia',
  FALLO: 'Fallo', IMPUGNACION: 'Impugnación', RECURSO: 'Recurso',
  SEGUIMIENTO: 'Seguimiento', OTRO: 'Otro',
};

// ─── Sub-componentes ─────────────────────────────────────────

function StatCard({ icon, label, value, sub, subClass, accent }) {
  return (
    <div className="stat-card" style={accent ? { borderColor: accent } : {}}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent, fontSize: '1.5rem' } : {}}>
        {value}
      </div>
      {sub && <div className={`stat-sub ${subClass || ''}`}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em',
      color: 'var(--text-muted)', marginBottom: 'var(--sp-3)',
    }}>
      <span>{children}</span>
      {action}
    </div>
  );
}

function BandejaItem({ item, onNavigate }) {
  const urgency = URGENCY_META[item.urgency] || URGENCY_META['BAJO'];
  const dias = diasHasta(item.fecha);
  const vencido = dias !== null && dias < 0;

  return (
    <div
      className="bandeja-item"
      onClick={() => item.case_id && onNavigate(`/cases/${item.case_id}`)}
      style={{ cursor: item.case_id ? 'pointer' : 'default' }}
    >
      <div className="bandeja-item-left">
        <span className={`bandeja-dot ${urgency.cls}`} />
        <div>
          <div className="bandeja-item-title">{item.title}</div>
          <div className="bandeja-item-meta">
            {item.case_number && (
              <span className="case-number" style={{ fontSize: '0.75rem' }}>{item.case_number}</span>
            )}
            {item.case_title && (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                {' '}· {item.case_title.length > 45 ? item.case_title.slice(0,45) + '…' : item.case_title}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="bandeja-item-right">
        <span className={`badge-urgency ${urgency.cls}`}>{urgency.label}</span>
        <span className={`bandeja-fecha ${vencido ? 'vencido' : ''}`}>
          {formatDate(item.fecha)}
          {' '}
          <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>({labelDias(item.fecha)})</span>
        </span>
        <span className="bandeja-type-tag">
          {item.item_type === 'tarea' ? '◈ tarea' : '◆ venc.'}
        </span>
      </div>
    </div>
  );
}

function ActuacionRow({ act, onNavigate }) {
  return (
    <div
      className="actuacion-row"
      onClick={() => onNavigate(`/cases/${act.case_id}`)}
    >
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: '2px' }}>
          <span className="badge-act-type">{ACTUACION_LABELS[act.type] || act.type}</span>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{act.actuacion_title}</span>
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 'var(--sp-3)' }}>
          <span className="case-number">{act.case_number}</span>
          <span>{act.client_name}</span>
          {act.radicado && <span>· Rad. {act.radicado}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {act.scheduled_at ? (
          <>
            <div style={{ fontSize: '0.8rem', color: diasHasta(act.scheduled_at) !== null && diasHasta(act.scheduled_at) < 0 ? '#E87A7A' : 'var(--gold)' }}>
              {formatDate(act.scheduled_at)}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {labelDias(act.scheduled_at)}
            </div>
          </>
        ) : (
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>sin fecha</span>
        )}
      </div>
    </div>
  );
}

function CargaRow({ abogado }) {
  const load = parseInt(abogado.casos_activos) || 0;
  const maxLoad = 15;
  const pct = Math.min((load / maxLoad) * 100, 100);
  const color = pct > 80 ? '#E87A7A' : pct > 50 ? '#D4B84A' : '#6EBA74';

  return (
    <div style={{ marginBottom: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-primary)' }}>{abogado.name}</span>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: 'var(--sp-3)' }}>
          <span style={{ color }}>{load} casos</span>
          {parseInt(abogado.tareas_pendientes) > 0 && (
            <span>{abogado.tareas_pendientes} tareas</span>
          )}
          {parseInt(abogado.vencimientos_vencidos) > 0 && (
            <span style={{ color: '#E87A7A' }}>⚠ {abogado.vencimientos_vencidos} venc.</span>
          )}
        </div>
      </div>
      <div style={{ height: '3px', background: 'var(--bg-5)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.4s ease' }} />
      </div>
    </div>
  );
}

// ─── Dashboard principal ──────────────────────────────────────

function WorkspaceCard({ title, formula, items, action, onClick }) {
  return (
    <button className="workspace-card" type="button" onClick={onClick}>
      <div>
        <div className="workspace-card-title">{title}</div>
        <div className="workspace-card-formula">{formula}</div>
      </div>
      <div className="workspace-card-items">
        {items.map(item => <span key={item}>{item}</span>)}
      </div>
      <div className="workspace-card-action">{action}</div>
    </button>
  );
}

function CommandSignal({ title, value, body, status, action, onClick }) {
  const Tag = onClick ? 'button' : 'article';

  return (
    <Tag
      className={`command-signal${onClick ? ' command-signal-clickable' : ''}`}
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={onClick ? `${title}: ${action || body}` : undefined}
    >
      <div className="command-signal-top">
        <span>{title}</span>
        <CapabilityStatus status={status} compact />
      </div>
      <strong>{value}</strong>
      <p>{body}</p>
      {action && <small>{action}</small>}
    </Tag>
  );
}

function CommandBrief({ slides, activeKey, onSelect }) {
  const activeSlide = slides.find(slide => slide.key === activeKey) || slides[0];

  return (
    <section className={`command-brief command-brief-${activeSlide.tone || 'neutral'}`}>
      <div className="command-brief-tabs" role="tablist" aria-label="Prioridades del despacho">
        {slides.map(slide => (
          <button
            key={slide.key}
            type="button"
            role="tab"
            aria-selected={activeSlide.key === slide.key}
            className={activeSlide.key === slide.key ? 'active' : ''}
            onClick={() => onSelect(slide.key)}
          >
            <span>{slide.label}</span>
            <strong>{slide.value}</strong>
          </button>
        ))}
      </div>

      <article className="command-brief-card">
        <div className="command-brief-copy">
          <div className="ops-label">{activeSlide.kicker}</div>
          <h2>{activeSlide.title}</h2>
          <p>{activeSlide.body}</p>
        </div>

        <div className="command-brief-facts">
          {activeSlide.facts.map(fact => (
            <div key={fact.label}>
              <span>{fact.label}</span>
              <strong>{fact.value}</strong>
            </div>
          ))}
        </div>

        <div className="command-brief-actions">
          {activeSlide.actions.map(action => (
            <button
              key={action.label}
              className={`btn btn-${action.variant || 'primary'} btn-sm`}
              type="button"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

function DecisionLens({ label, value, text, action, onClick }) {
  return (
    <button type="button" className="ops-lens decision-lens" onClick={onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{text}</p>
      <small>{action}</small>
    </button>
  );
}

const BAND_LABELS = {
  critica: 'Critica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
};

function formatPriorityRun(value) {
  if (!value) return 'Sin corrida registrada';
  return new Date(value).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PriorityScorePanel({ priorityScore, loading, onRefresh, onRun, navigate }) {
  const summary = priorityScore?.summary;
  const items = priorityScore?.items || [];
  const topItems = items.slice(0, 8);
  const lastRun = priorityScore?.last_run?.created_at;

  return (
    <section className="detail-section operational-priority-panel">
      <div className="operational-priority-head">
        <div>
          <div className="detail-section-title">Prioridad operativa</div>
          <p>
            El motor de priorizacion ordena el portafolio por vencimientos, tareas, siguiente accion,
            correos recientes y expediente documental.
          </p>
        </div>
        <div className="operational-priority-actions">
          <span>{formatPriorityRun(lastRun)}</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onRefresh} disabled={loading}>
            Actualizar vista
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={onRun} disabled={loading}>
            {loading ? 'Calculando...' : 'Recalcular score'}
          </button>
        </div>
      </div>

      <div className="operational-priority-summary">
        <div>
          <span>Portafolio</span>
          <strong>{summary?.total ?? '-'}</strong>
        </div>
        {['critica', 'alta', 'media', 'baja'].map((band) => (
          <div key={band}>
            <span>{BAND_LABELS[band]}</span>
            <strong>{summary?.[band] ?? 0}</strong>
          </div>
        ))}
      </div>

      {topItems.length === 0 ? (
        <div className="empty-state" style={{ padding: 'var(--sp-4)' }}>
          <div className="empty-state-text">Sin score disponible</div>
          <div className="empty-state-sub">Ejecuta el recalculo para crear la primera lectura.</div>
        </div>
      ) : (
        <div className="operational-priority-list">
          {topItems.map((item, index) => (
            <button
              key={item.case_id}
              type="button"
              className="operational-priority-row"
              onClick={() => navigate(`/cases/${item.case_id}`)}
            >
              <span className="operational-priority-rank">{index + 1}</span>
              <div className="operational-priority-case">
                <div>
                  <span className="case-number">{item.case_number}</span>
                  <strong>{truncate(item.title, 86)}</strong>
                </div>
                <small>
                  {item.client_name || 'Sin cliente'} · {(item.reasons || []).slice(0, 2).map(reason => reason.label).join(' · ') || 'Sin senales'}
                </small>
              </div>
              <div className={`operational-priority-score band-${item.priority_band}`}>
                <strong>{item.priority_score}</strong>
                <span>{BAND_LABELS[item.priority_band] || item.priority_band}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Dashboard() {
  const navigate    = useNavigate();
  const { user }    = useAuth();

  const [stats,       setStats]       = useState(null);
  const [bandeja,     setBandeja]     = useState([]);
  const [actuaciones, setActuaciones] = useState([]);
  const [carga,       setCarga]       = useState([]);
  const [casosActivos, setCasosActivos] = useState([]);
  const [proyectos,   setProyectos]   = useState([]);
  const [priorityScore, setPriorityScore] = useState(null);
  const [priorityLoading, setPriorityLoading] = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [lastUpdate,  setLastUpdate]  = useState(null);
  const [activeBrief, setActiveBrief] = useState('hoy');

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [s, b, a, c, ca, pr, ps] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/bandeja'),
        api.get('/dashboard/actuaciones-pendientes?limit=8'),
        api.get('/dashboard/carga-abogados').catch(() => ({ data: [] })),
        api.get('/dashboard/casos-activos?limit=12'),
        api.get('/macrocasos?status=ACTIVO').catch(() => ({ data: [] })),
        api.get('/operations/priority-score?limit=100').catch(() => ({ data: null })),
      ]);
      setStats(s.data);
      setBandeja(b.data);
      setActuaciones(a.data);
      setCarga(c.data);
      setCasosActivos(ca.data);
      setProyectos(pr.data);
      setPriorityScore(ps.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData({ silent: true }), 45000);
    return () => clearInterval(interval);
  }, [loadData]);

  const refreshPriorityScore = useCallback(async () => {
    setPriorityLoading(true);
    try {
      const res = await api.get('/operations/priority-score?limit=100');
      setPriorityScore(res.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setPriorityLoading(false);
    }
  }, []);

  const runPriorityScore = useCallback(async () => {
    setPriorityLoading(true);
    try {
      const res = await api.post('/operations/priority-score/run', {
        limit: 100,
        source: 'dashboard_button',
      });
      setPriorityScore(res.data);
      setLastUpdate(new Date());
    } catch (err) {
      console.error(err);
    } finally {
      setPriorityLoading(false);
    }
  }, []);

  // ─── Alertas críticas ──────────────────────────
  const criticos  = bandeja.filter(i => i.urgency === 'CRITICO');
  const vencidos  = bandeja.filter(i => diasHasta(i.fecha) !== null && diasHasta(i.fecha) < 0);
  const hayAlertas = criticos.length > 0 || vencidos.length > 0;
  const casosSinAccion = casosActivos.filter(c => !c.next_action).length;
  const tareasEnCurso = stats?.tasks?.en_curso ?? 0;
  const tareasBandeja = bandeja.filter(i => i.item_type === 'tarea');
  const vencimientosBandeja = bandeja.filter(i => i.item_type !== 'tarea');
  const sortedBandeja = [...bandeja].sort((a, b) => new Date(a.fecha || 0) - new Date(b.fecha || 0));
  const firstUrgent = [...vencidos, ...criticos, ...sortedBandeja][0];
  const sortedActuaciones = [...actuaciones].sort((a, b) => new Date(a.scheduled_at || 8640000000000000) - new Date(b.scheduled_at || 8640000000000000));
  const nextActuacion = sortedActuaciones[0];
  const actuacionesSemana = actuaciones.filter(act => {
    const days = diasHasta(act.scheduled_at);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const casosProximos = casosActivos.filter(c => {
    const days = diasHasta(c.next_action_date);
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const decisionesHoy = criticos.length + vencidos.length + tareasEnCurso + casosSinAccion;
  const scrollToBandeja = () => document.getElementById('bandeja-dia')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const briefSlides = [
    {
      key: 'hoy',
      label: 'Hoy',
      value: decisionesHoy,
      tone: hayAlertas ? 'danger' : 'ready',
      kicker: 'Prioridad inmediata',
      title: hayAlertas ? 'Atender lo vencido antes de producir nuevo trabajo.' : 'Despacho controlado para decidir con calma.',
      body: firstUrgent
        ? `Primer movimiento sugerido: ${truncate(firstUrgent.title)}.`
        : 'No hay tareas ni vencimientos críticos visibles para los próximos 7 días.',
      facts: [
        { label: 'Tareas', value: tareasBandeja.length },
        { label: 'Términos', value: vencimientosBandeja.length },
        { label: 'Sin actuación', value: casosSinAccion },
      ],
      actions: [
        { label: 'Abrir bandeja', onClick: scrollToBandeja },
        { label: 'Ver escritorio', variant: 'secondary', onClick: () => navigate('/tasks') },
      ],
    },
    {
      key: 'semana',
      label: 'Semana',
      value: actuacionesSemana + casosProximos,
      tone: 'tactical',
      kicker: 'Táctico',
      title: 'Preparar actuaciones y siguientes pasos de la semana.',
      body: nextActuacion
        ? `La próxima actuación visible es ${truncate(nextActuacion.actuacion_title, 74)} (${labelDias(nextActuacion.scheduled_at) || 'sin fecha'}).`
        : 'No hay actuaciones fechadas en la vista actual; conviene revisar expedientes sin siguiente paso.',
      facts: [
        { label: 'Actuaciones 7d', value: actuacionesSemana },
        { label: 'Casos con fecha', value: casosProximos },
        { label: 'Planes visibles', value: Math.max(proyectos.length, tareasEnCurso) },
      ],
      actions: [
        { label: 'Ver actuaciones', onClick: () => navigate('/cases') },
        { label: 'Abrir planes', variant: 'secondary', onClick: () => navigate('/planes') },
      ],
    },
    {
      key: 'procesal',
      label: 'Procesal',
      value: actuaciones.length,
      tone: 'procedural',
      kicker: 'Próximas actuaciones',
      title: 'Mantener cada expediente con fuente, fecha y responsable.',
      body: nextActuacion
        ? `${nextActuacion.case_number}: ${truncate(nextActuacion.client_name || nextActuacion.actuacion_title, 88)}.`
        : 'Cuando haya actuaciones pendientes, aparecerán aquí con acceso directo al expediente.',
      facts: [
        { label: 'Pendientes', value: actuaciones.length },
        { label: 'Vencidos', value: vencidos.length },
        { label: 'Críticos', value: criticos.length },
      ],
      actions: [
        { label: 'Abrir expedientes', onClick: () => navigate('/cases') },
        { label: 'Ver radar Colombia', variant: 'secondary', onClick: () => navigate('/radar-colombia') },
      ],
    },
    {
      key: 'estrategia',
      label: 'Estrategia',
      value: proyectos.length + casosSinAccion,
      tone: 'strategy',
      kicker: 'Estratégico',
      title: 'Convertir cuellos de botella en criterio de firma.',
      body: casosSinAccion
        ? `${formatCount(casosSinAccion, 'expediente')} sin siguiente actuación; ahí está la mejora más rentable.`
        : 'Los expedientes visibles tienen siguiente movimiento; el foco puede pasar a cartera, radar y calidad.',
      facts: [
        { label: 'Proyectos', value: proyectos.length },
        { label: 'Por cobrar', value: formatCOP(stats?.revenue?.pending) },
        { label: 'Mejoras', value: casosSinAccion },
      ],
      actions: [
        { label: 'Mejora del despacho', onClick: () => navigate('/kaizen') },
        { label: 'Radar competitivo', variant: 'secondary', onClick: () => navigate('/radar-competitivo') },
      ],
    },
  ];

  if (loading) return (
    <div className="loading" style={{ flexDirection: 'column', gap: 'var(--sp-3)' }}>
      <span style={{ fontSize: '2rem', opacity: 0.2 }}>Φ</span>
      <span>Cargando operaciones…</span>
    </div>
  );

  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">
            Despacho
          </div>
          <div className="page-subtitle">
            {user?.name ? `Buenas, ${user.name.split(' ')[0]} - ` : ''}
            {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}
            {' - '}prioridades, términos, actuaciones y decisiones accionables
          </div>
        </div>
        <div className="command-refresh-note" title="El despacho se actualiza automáticamente">
          <span className="reception-live-dot on" />
          <span>
            Autoactualizado
            {lastUpdate && ` ${lastUpdate.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}`}
          </span>
        </div>
      </div>

      <div className="page-body">

        <CommandBrief
          slides={briefSlides}
          activeKey={activeBrief}
          onSelect={setActiveBrief}
        />

        <PriorityScorePanel
          priorityScore={priorityScore}
          loading={priorityLoading}
          onRefresh={refreshPriorityScore}
          onRun={runPriorityScore}
          navigate={navigate}
        />

        <section className="command-signals-grid">
          <CommandSignal
            title="Bandeja del día"
            value={decisionesHoy}
            status="activo"
            body="Tareas, términos y expedientes sin siguiente actuación se ordenan por urgencia."
            action="Abrir bandeja"
            onClick={scrollToBandeja}
          />
          <CommandSignal
            title="Autorizaciones"
            value={criticos.length + vencidos.length}
            status="prototipo"
            body="Enviar, radicar, cerrar o mover evidencia exige criterio humano visible."
            action="Ver autorizaciones"
            onClick={() => navigate('/aprobaciones')}
          />
          <CommandSignal
            title="Planes de acción"
            value={Math.max(tareasEnCurso, proyectos.length)}
            status="por_conectar"
            body="Secuencias revisables con paso, herramienta, responsable y bloqueo cuando aplique."
            action="Ver planes"
            onClick={() => navigate('/planes')}
          />
          <CommandSignal
            title="Radar Colombia"
            value="13"
            status="manual_asistido"
            body="Portales y fuentes oficiales listos para consulta guiada, evidencia y accion sugerida."
            action="Abrir radar"
            onClick={() => navigate('/radar-colombia')}
          />
          <CommandSignal
            title="Mejora del despacho"
            value={casosSinAccion}
            status="activo"
            body="Residuos operativos, correcciones y cuellos de botella se vuelven backlog jurídico."
            action="Ver mejoras"
            onClick={() => navigate('/kaizen')}
          />
        </section>

        <section className="ops-lens-grid decision-lens-grid">
          <DecisionLens
            label="Vencido"
            value={vencidos.length}
            text={vencidos.length ? 'Requiere actuación o reasignación inmediata.' : 'Sin vencidos visibles en esta vista.'}
            action="Abrir bandeja"
            onClick={scrollToBandeja}
          />
          <DecisionLens
            label="Próxima actuación"
            value={nextActuacion ? formatDate(nextActuacion.scheduled_at) : 'Sin fecha'}
            text={nextActuacion ? truncate(nextActuacion.actuacion_title, 74) : 'No hay actuación pendiente con fecha.'}
            action="Revisar expediente"
            onClick={() => nextActuacion?.case_id ? navigate(`/cases/${nextActuacion.case_id}`) : navigate('/cases')}
          />
          <DecisionLens
            label="Sin siguiente paso"
            value={casosSinAccion}
            text="Expedientes que necesitan diagnóstico o próxima mejor acción."
            action="Abrir expedientes"
            onClick={() => navigate('/cases')}
          />
          <DecisionLens
            label="En curso"
            value={tareasEnCurso}
            text="Trabajo activo que puede necesitar secuencia, fuente o aprobación."
            action="Ver escritorio"
            onClick={() => navigate('/tasks')}
          />
          <DecisionLens
            label="Cartera"
            value={formatCOP(stats?.revenue?.pending)}
            text="Valor económico pendiente de lectura y seguimiento."
            action="Ver caja fuerte"
            onClick={() => navigate('/vault')}
          />
        </section>

        <div className="workspace-grid command-workspace-grid">
          <WorkspaceCard
            title="Recepción"
            formula="entrada -> triage -> expediente"
            items={[`${stats?.total_clients ?? 0} clientes`, `${tareasBandeja.length} tareas del día`, 'Gmail y casos nuevos']}
            action="Abrir mesa de entrada"
            onClick={() => navigate('/recepcion')}
          />
          <WorkspaceCard
            title="Expediente vivo"
            formula="hechos -> riesgo -> actuación"
            items={[`${casosActivos.length} activos visibles`, `${casosSinAccion} sin siguiente paso`, `${stats?.deadlines?.open ?? 0} términos abiertos`]}
            action="Ver expedientes"
            onClick={() => navigate('/cases')}
          />
          <WorkspaceCard
            title="Radar jurídico"
            formula="vigilar -> evidenciar -> reaccionar"
            items={['13 fuentes Colombia', 'modo manual asistido', 'respuesta sugerida']}
            action="Abrir radar Colombia"
            onClick={() => navigate('/radar-colombia')}
          />
        </div>

        {/* ── Barra de alertas críticas ── */}
        {hayAlertas && (
          <div className="alert-bar">
            {vencidos.length > 0 && (
              <span className="alert-chip alert-chip-danger">
                ⚠ {vencidos.length} {vencidos.length === 1 ? 'item vencido' : 'items vencidos'}
              </span>
            )}
            {criticos.length > 0 && (
              <span className="alert-chip alert-chip-critico">
                ◆ {criticos.length} {criticos.length === 1 ? 'vencimiento crítico' : 'vencimientos críticos'}
              </span>
            )}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Requieren atención hoy
            </span>
          </div>
        )}

        {/* ── Stats ── */}
        <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px,1fr))', marginBottom: 'var(--sp-5)' }}>
          <StatCard
            icon="◈" label="Casos Activos"
            value={stats?.active_cases ?? 0}
            sub={`${stats?.total_cases ?? 0} totales`}
          />
          <StatCard
            icon="◉" label="Clientes"
            value={stats?.total_clients ?? 0}
            sub="activos"
          />
          <StatCard
            icon="◇" label="Por Cobrar"
            value={formatCOP(stats?.revenue?.pending)}
            sub={`Cobrado: ${formatCOP(stats?.revenue?.paid)}`}
            accent="var(--gold)"
            subClass="fee-paid"
          />
          <StatCard
            icon="◆" label="Vencimientos 7d"
            value={stats?.deadlines?.open ?? 0}
            sub={
              stats?.deadlines?.criticos > 0
                ? `${stats.deadlines.criticos} críticos`
                : stats?.deadlines?.vencidos > 0
                  ? `${stats.deadlines.vencidos} vencidos`
                  : 'sin críticos'
            }
            accent={stats?.deadlines?.criticos > 0 ? '#E87A7A' : stats?.deadlines?.vencidos > 0 ? '#D4B84A' : undefined}
            subClass={stats?.deadlines?.criticos > 0 || stats?.deadlines?.vencidos > 0 ? 'fee-unpaid' : 'fee-paid'}
          />
          <StatCard
            icon="◫" label="Tareas Abiertas"
            value={stats?.tasks?.open ?? 0}
            sub={
              stats?.tasks?.vencidas > 0
                ? `${stats.tasks.vencidas} vencidas`
                : `${stats?.tasks?.en_curso ?? 0} en curso`
            }
            accent={stats?.tasks?.vencidas > 0 ? '#E87A7A' : undefined}
            subClass={stats?.tasks?.vencidas > 0 ? 'fee-unpaid' : ''}
          />
          {proyectos.length > 0 && (
            <StatCard
              icon="⬡" label="Proyectos"
              value={proyectos.length}
              sub={`${proyectos.reduce((s,p) => s + (parseInt(p.cases_count)||0), 0)} clientes`}
              accent="var(--gold)"
            />
          )}
        </div>

        {/* ── Layout principal: 2 columnas ── */}
        <div className="dashboard-main-grid">

          {/* ── Columna izquierda (2/3) ── */}
          <div>

            {/* Bandeja del día */}
            <div className="detail-section" id="bandeja-dia" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="detail-section-title">
                Bandeja del día
                <span style={{ float: 'right', fontStyle: 'normal', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  tareas + vencimientos próximos
                </span>
              </div>

              <div className="bandeja-summary">
                <span>{formatCount(tareasBandeja.length, 'tarea')}</span>
                <span>{formatCount(vencimientosBandeja.length, 'término', 'términos')}</span>
                <span>{formatCount(criticos.length, 'crítico', 'críticos')}</span>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => navigate('/tasks')}>
                  Abrir escritorio
                </button>
              </div>

              {bandeja.length === 0 ? (
                <div className="empty-state" style={{ padding: 'var(--sp-5) var(--sp-4)' }}>
                  <div className="empty-state-icon" style={{ fontSize: '2rem' }}>◈</div>
                  <div className="empty-state-text" style={{ fontSize: '0.9rem' }}>Sin items urgentes</div>
                  <div className="empty-state-sub">No hay tareas ni vencimientos en los próximos 7 días</div>
                </div>
              ) : (
                <div>
                  {/* Agrupar: críticos primero, luego por fecha */}
                  {['CRITICO', 'ALTO', 'MEDIA', 'MEDIO', 'BAJA', 'BAJO'].map(urg => {
                    const items = bandeja.filter(i => i.urgency === urg);
                    if (!items.length) return null;
                    return (
                      <div key={urg} style={{ marginBottom: 'var(--sp-3)' }}>
                        <div style={{
                          fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em',
                          color: 'var(--text-muted)', marginBottom: 'var(--sp-2)',
                          paddingLeft: 'var(--sp-2)',
                        }}>
                          {URGENCY_META[urg]?.label}
                        </div>
                        {items.map((item, idx) => (
                          <BandejaItem key={`${item.item_type}-${item.item_id}-${idx}`} item={item} onNavigate={navigate} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Próximas actuaciones */}
            <div className="detail-section">
              <div className="detail-section-title">
                Actuaciones pendientes
                <span style={{ float: 'right', fontStyle: 'normal', color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                  sin completar
                </span>
              </div>

              {actuaciones.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 'var(--sp-3) 0' }}>
                  Sin actuaciones pendientes
                </div>
              ) : (
                <div>
                  {actuaciones.map(act => (
                    <ActuacionRow key={act.id} act={act} onNavigate={navigate} />
                  ))}
                </div>
              )}
            </div>

          </div>

          {/* ── Columna derecha (1/3) ── */}
          <div>

            {/* Carga de abogados */}
            <div className="detail-section" style={{ marginBottom: 'var(--sp-4)' }}>
              <div className="detail-section-title">Carga del equipo</div>
              {carga.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Sin datos</div>
              ) : (
                carga.map(a => <CargaRow key={a.id} abogado={a} />)
              )}
            </div>

            {/* Mix de casos por tipo */}
            {stats?.by_service_type?.length > 0 && (
              <div className="detail-section" style={{ marginBottom: 'var(--sp-4)' }}>
                <div className="detail-section-title">Por tipo de servicio</div>
                {stats.by_service_type.map(svc => (
                  <div key={svc.service_type} className="detail-row">
                    <span className={`badge badge-${svc.service_type.toLowerCase()}`}>{svc.service_type}</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{svc.count} casos</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--gold)' }}>{formatCOP(svc.total_fees)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Por estado */}
            {stats?.by_status?.length > 0 && (
              <div className="detail-section">
                <div className="detail-section-title">Por estado</div>
                {stats.by_status
                  .filter(s => ['NUEVO','EN_PROCESO','PENDIENTE_CLIENTE','PENDIENTE_ENTIDAD'].includes(s.status))
                  .map(s => (
                    <div key={s.status} className="detail-row">
                      <span className={`badge badge-${s.status.toLowerCase().replace(/_/g, '-')}`}>
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                      <span style={{ fontSize: '0.9rem', fontFamily: 'var(--font-editorial)' }}>{s.count}</span>
                    </div>
                  ))}
              </div>
            )}

          </div>
        </div>

        {/* ── Tabla: casos activos con siguiente actuación ── */}
        <div style={{ marginTop: 'var(--sp-5)' }}>
          <SectionTitle action={
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/cases')}>
              Ver todos →
            </button>
          }>
            Casos activos · siguiente actuación
          </SectionTitle>

          {casosActivos.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◈</div>
              <div className="empty-state-text">Sin casos activos</div>
              <div className="empty-state-sub">Los casos aparecerán aquí en cuanto sean creados</div>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>N° Caso</th>
                    <th>Cliente</th>
                    <th>Tipo</th>
                    <th>Estado</th>
                    <th>Siguiente actuación</th>
                    <th>Fecha</th>
                    <th style={{ textAlign: 'right' }}>Tareas · Venc.</th>
                  </tr>
                </thead>
                <tbody>
                  {casosActivos.map(c => {
                    const diasNext = diasHasta(c.next_action_date);
                    const nextUrgente = diasNext !== null && diasNext <= 3;
                    return (
                      <tr key={c.id} onClick={() => navigate(`/cases/${c.id}`)} style={{ cursor: 'pointer' }}>
                        <td><span className="case-number">{c.case_number}</span></td>
                        <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.client_name}
                        </td>
                        <td>
                          <span className={`badge badge-${c.service_type?.toLowerCase()}`}>{c.service_type}</span>
                        </td>
                        <td>
                          <span className={`badge badge-${c.status?.toLowerCase().replace(/_/g, '-')}`}>
                            {STATUS_LABELS[c.status] || c.status}
                          </span>
                        </td>
                        <td style={{ maxWidth: '220px' }}>
                          {c.next_action ? (
                            <span style={{ fontSize: '0.82rem', color: nextUrgente ? '#D4B84A' : 'var(--text-secondary)' }}>
                              {c.next_action.length > 55 ? c.next_action.slice(0, 55) + '…' : c.next_action}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>—</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {c.next_action_date ? (
                            <span style={{ fontSize: '0.8rem', color: nextUrgente ? '#D4B84A' : 'var(--text-secondary)' }}>
                              {formatDate(c.next_action_date)}
                              {' '}
                              <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>({labelDias(c.next_action_date)})</span>
                            </span>
                          ) : '—'}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {parseInt(c.tareas_pendientes) > 0 && (
                            <span style={{ fontSize: '0.75rem', color: '#D4B84A', marginRight: 'var(--sp-2)' }}>
                              ◈ {c.tareas_pendientes}
                            </span>
                          )}
                          {parseInt(c.vencimientos_proximos) > 0 && (
                            <span style={{ fontSize: '0.75rem', color: '#E87A7A' }}>
                              ◆ {c.vencimientos_proximos}
                            </span>
                          )}
                          {!parseInt(c.tareas_pendientes) && !parseInt(c.vencimientos_proximos) && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </>
  );
}
