import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

/**
 * Kaizen — Panel del despacho.
 *
 * Pivote a métricas REALES del negocio jurídico (no del software):
 *  - Casos (nuevos, cerrados, tiempo medio de resolución)
 *  - Equipo (utilización por abogado)
 *  - Top clientes
 *  - Embudo de prospects
 *  - Riesgos urgentes (plazos 3d, audiencias 7d, tareas críticas)
 *  - Cuellos de botella (drill-down a la pantalla relevante)
 *
 * Cada métrica es accionable: click → ruta para resolver.
 */

const WINDOWS = [
  { value: 7,  label: '7 días' },
  { value: 30, label: '30 días' },
  { value: 90, label: '90 días' },
];

export default function Kaizen() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [agentMetrics, setAgentMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [window, setWindow] = useState(30);
  const [tab, setTab] = useState('despacho');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.get(`/kaizen/despacho?window=${window}`),
      api.get(`/kaizen/metrics?window=${window}`).catch(() => ({ data: null })),
    ]).then(([d, a]) => {
      if (cancelled) return;
      setData(d.data);
      setAgentMetrics(a.data);
    }).catch((err) => {
      if (!cancelled) setError(err.response?.data?.error || err.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [window]);

  if (loading) {
    return (
      <div className="page-body">
        <p style={{ color: 'var(--text-secondary)' }}>Cargando métricas del despacho…</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Mejora del Despacho</div>
          <div className="page-subtitle">
            Métricas reales del negocio jurídico. Cada número es accionable: click → ruta para resolver.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          {WINDOWS.map((w) => (
            <button
              key={w.value}
              type="button"
              className={`btn btn-sm ${window === w.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setWindow(w.value)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="page-body">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 'var(--sp-1)', marginBottom: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
          <TabButton active={tab === 'despacho'} onClick={() => setTab('despacho')}>
            🏛 Operación del despacho
          </TabButton>
          <TabButton active={tab === 'agente'} onClick={() => setTab('agente')}>
            🤖 Salud del agente
          </TabButton>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        {tab === 'despacho' && data && (
          <>
            <RiesgosUrgentes riesgos={data.riesgos} navigate={navigate} />
            <CasesSection cases={data.cases} navigate={navigate} />
            <TeamSection team={data.team} window={data.window_days} navigate={navigate} />
            <BottlenecksSection bottlenecks={data.bottlenecks} navigate={navigate} />
            <TopClientsSection clients={data.top_clients} navigate={navigate} />
            <FunnelSection funnel={data.funnel} navigate={navigate} />
          </>
        )}

        {tab === 'agente' && (
          <AgentTab data={agentMetrics} />
        )}
      </div>
    </>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        color: active ? 'var(--gold)' : 'var(--text-secondary)',
        border: 'none',
        borderBottom: active ? '2px solid var(--gold)' : '2px solid transparent',
        padding: '8px 16px',
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
      }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Riesgos urgentes — primera mirada del abogado
// ─────────────────────────────────────────────────────────────
function RiesgosUrgentes({ riesgos, navigate }) {
  const hasRisk = riesgos.plazos_3d.length > 0 ||
                  riesgos.audiencias_7d.length > 0 ||
                  riesgos.tareas_criticas_vencidas > 0;

  if (!hasRisk) {
    return (
      <section className="ops-section">
        <div className="ops-section-head">
          <div>
            <span>Riesgos</span>
            <h3>Atención inmediata</h3>
          </div>
        </div>
        <div style={{
          padding: 'var(--sp-3)', background: 'rgba(125,184,126,0.08)',
          border: '1px solid rgba(125,184,126,0.3)', borderRadius: 'var(--radius)',
          color: '#7DB87E', textAlign: 'center', fontSize: 13,
        }}>
          ✓ Sin riesgos urgentes detectados.
        </div>
      </section>
    );
  }
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div>
          <span>Riesgos · prioridad alta</span>
          <h3>Atención inmediata</h3>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--sp-2)' }}>
        {riesgos.plazos_3d.length > 0 && (
          <UrgenciaCard
            title="Plazos legales ≤ 3 días"
            count={riesgos.plazos_3d.length}
            color="#E87A7A"
            items={riesgos.plazos_3d.slice(0, 5).map((v) => ({
              label: v.title,
              sub: `${v.case_number} · vence ${formatDate(v.due_date)}`,
              onClick: () => navigate(`/cases/${v.case_id || ''}`),
            }))}
          />
        )}
        {riesgos.audiencias_7d.length > 0 && (
          <UrgenciaCard
            title="Audiencias próximas (7d)"
            count={riesgos.audiencias_7d.length}
            color="#D4B84A"
            items={riesgos.audiencias_7d.slice(0, 5).map((a) => ({
              label: a.title,
              sub: `${a.case_number} · ${formatDate(a.scheduled_at)}`,
            }))}
          />
        )}
        {riesgos.tareas_criticas_vencidas > 0 && (
          <UrgenciaCard
            title="Tareas críticas vencidas"
            count={riesgos.tareas_criticas_vencidas}
            color="#E87A7A"
            items={[{ label: 'Revisar tablero de tareas', sub: 'Reasignar o cerrar', onClick: () => navigate('/tasks') }]}
          />
        )}
      </div>
    </section>
  );
}

function UrgenciaCard({ title, count, color, items }) {
  return (
    <article className="ops-card" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="ops-kicker" style={{ color }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4, marginBottom: 8 }}>{count}</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 12 }}>
        {items.map((i, idx) => (
          <li key={idx} style={{ padding: '4px 0', borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <button
              onClick={i.onClick}
              disabled={!i.onClick}
              style={{
                background: 'transparent', border: 'none', textAlign: 'left',
                width: '100%', cursor: i.onClick ? 'pointer' : 'default',
                color: 'var(--text-primary)', padding: 0,
              }}
            >
              <div style={{ fontWeight: 500 }}>{i.label}</div>
              <small style={{ color: 'var(--text-muted)' }}>{i.sub}</small>
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────
// Casos
// ─────────────────────────────────────────────────────────────
function CasesSection({ cases, navigate }) {
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div>
          <span>Casos</span>
          <h3>Movimiento del periodo</h3>
        </div>
      </div>
      <div className="ops-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-2)' }}>
        <BigCard title="Activos" value={cases.active} tone="neutral" onClick={() => navigate('/cases')} />
        <BigCard title="Nuevos" value={cases.new_in_window} tone="good" sub="en el periodo" onClick={() => navigate('/cases?status=NUEVO')} />
        <BigCard title="Cerrados" value={cases.closed_in_window} tone="good" sub="en el periodo" onClick={() => navigate('/cases?status=CERRADO')} />
        <BigCard
          title="Tiempo medio resolución"
          value={cases.avg_resolution_days != null ? `${cases.avg_resolution_days}d` : '—'}
          tone="neutral"
          tip="Promedio (closed_at - created_at) de casos cerrados."
        />
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Equipo
// ─────────────────────────────────────────────────────────────
function TeamSection({ team, window, navigate }) {
  if (!team || team.members.length === 0) {
    return (
      <section className="ops-section">
        <div className="ops-section-head">
          <div><span>Equipo</span><h3>Utilización (horas billables · {window}d)</h3></div>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          Sin registro de horas en la ventana. Empieza a usar el cronómetro arriba.
        </div>
      </section>
    );
  }
  const max = Math.max(1, ...team.members.map((m) => m.billable_minutes));
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div><span>Equipo</span><h3>Utilización del equipo · {window}d</h3></div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/productividad')}>
          Mi productividad →
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {team.members.map((m) => {
          const pct = (m.billable_minutes / max) * 100;
          return (
            <div key={m.user_id} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 100px 130px', gap: 'var(--sp-2)', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{m.name}</div>
              <div style={{ background: 'var(--bg-3)', borderRadius: 4, height: 18, position: 'relative', border: '1px solid var(--border)' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold)', borderRadius: 4 }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', fontSize: 10, fontWeight: 600 }}>
                  <span style={{ color: pct > 30 ? 'var(--black)' : 'var(--text-primary)' }}>{formatHours(m.billable_minutes)}</span>
                  <span style={{ color: 'var(--text-primary)' }}>{m.utilization_pct.toFixed(0)}% util.</span>
                </div>
              </div>
              <small style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'right' }}>{formatCOP(m.billable_cents)}</small>
              <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                {formatHours(m.total_minutes)} totales
              </small>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Cuellos de botella (drill-down)
// ─────────────────────────────────────────────────────────────
function BottlenecksSection({ bottlenecks, navigate }) {
  const items = [
    { label: 'Casos sin siguiente acción', value: bottlenecks.cases_without_next_action, hint: 'Convocar Sala para diagnosticar', go: () => navigate('/cases') },
    { label: 'Tareas vencidas',           value: bottlenecks.overdue_tasks,           hint: 'Reasignar o cerrar',                go: () => navigate('/tasks') },
    { label: 'Vencimientos vencidos',     value: bottlenecks.overdue_deadlines,       hint: 'Atención inmediata',                 go: () => navigate('/cases') },
    { label: 'Correos sin triage',        value: bottlenecks.inbox_pending,           hint: 'Refrescar bandeja',                  go: () => navigate('/recepcion') },
  ];
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div><span>Cuellos de botella</span><h3>Trabajo bloqueado o sin dueño</h3></div>
      </div>
      <div className="ops-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--sp-2)' }}>
        {items.map((i) => {
          const danger = i.value > 0;
          return (
            <button
              key={i.label} type="button" onClick={i.go}
              style={{
                textAlign: 'left', cursor: 'pointer',
                borderLeft: danger ? '3px solid #E87A7A' : '3px solid #7DB87E',
                background: 'var(--bg-2)', border: '1px solid var(--border)', borderLeftWidth: 3,
                padding: 'var(--sp-3)', borderRadius: 'var(--radius)',
              }}
            >
              <div className="ops-kicker" style={{ color: 'var(--text-secondary)' }}>{i.label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, margin: '4px 0', color: danger ? '#E87A7A' : '#7DB87E' }}>{i.value}</div>
              <small style={{ color: 'var(--text-muted)' }}>{i.hint} →</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Top clientes
// ─────────────────────────────────────────────────────────────
function TopClientsSection({ clients, navigate }) {
  if (!clients || clients.length === 0) {
    return null;
  }
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div><span>Clientes</span><h3>Top clientes del periodo</h3></div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/clients')}>Ver todos →</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {clients.map((c, i) => (
          <div key={c.id} style={{
            display: 'grid', gridTemplateColumns: '40px 1fr 120px 100px',
            gap: 'var(--sp-2)', alignItems: 'center',
            padding: '8px 12px', background: 'var(--bg-2)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: i < 3 ? 'var(--gold)' : 'var(--text-muted)' }}>#{i + 1}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{c.full_name}</span>
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{c.active_cases} caso{c.active_cases === 1 ? '' : 's'}</span>
            <span style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 12, textAlign: 'right' }}>
              {formatCOP(Number(c.revenue_cop) * 100)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Embudo comercial
// ─────────────────────────────────────────────────────────────
function FunnelSection({ funnel, navigate }) {
  if (!funnel || funnel.total === 0) return null;
  const STAGES = ['nuevo', 'contactado', 'calificado', 'propuesta', 'ganado', 'perdido'];
  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div><span>Comercial</span><h3>Embudo de prospects · {funnel.total} en el periodo</h3></div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/prospects')}>Ver pipeline →</button>
      </div>
      <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
        {STAGES.map((s) => {
          const count = funnel.by_status[s] || 0;
          const pct = funnel.total > 0 ? (count / funnel.total) * 100 : 0;
          return (
            <div key={s} style={{
              flex: Math.max(0.5, pct / 25),
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '8px 10px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{s}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{count}</div>
              <small style={{ color: 'var(--text-muted)' }}>{pct.toFixed(0)}%</small>
            </div>
          );
        })}
      </div>
      {funnel.conversion_rate != null && (
        <div style={{ marginTop: 'var(--sp-2)', fontSize: 12, color: 'var(--text-secondary)' }}>
          Tasa de conversión a ganado: <strong style={{ color: 'var(--gold)' }}>{funnel.conversion_rate.toFixed(1)}%</strong>
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab agente (vista compacta de la original)
// ─────────────────────────────────────────────────────────────
function AgentTab({ data }) {
  if (!data) return <div style={{ color: 'var(--text-muted)' }}>Sin datos del agente.</div>;
  const h = data.agent_health;
  return (
    <>
      <div className="ops-card-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-2)' }}>
        <BigCard title="Total acciones agente" value={h.total_actions} tone="neutral" tip="Acciones agénticas registradas en agent_actions" />
        <BigCard title="Ejecutadas" value={h.executed} tone="good" sub={h.acceptance_rate != null ? `${(h.acceptance_rate * 100).toFixed(0)}% aceptación` : null} />
        <BigCard title="Rechazadas" value={h.rejected} tone="warn" sub={h.rejection_rate != null ? `${(h.rejection_rate * 100).toFixed(0)}%` : null} />
        <BigCard title="Fallidas" value={h.failed} tone="bad" sub={h.failure_rate != null ? `${(h.failure_rate * 100).toFixed(0)}%` : null} />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 'var(--sp-3)' }}>
        Esta vista es para diagnosticar la salud del software. Para mejorar la operación del despacho usa la pestaña "Operación".
      </p>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers UI
// ─────────────────────────────────────────────────────────────
function BigCard({ title, value, tone = 'neutral', sub, onClick, tip }) {
  const toneColor = {
    good: '#7DB87E', warn: '#D4B84A', bad: '#E87A7A', neutral: 'var(--text-primary)',
  }[tone] || 'var(--text-primary)';
  const Wrapper = onClick ? 'button' : 'article';
  return (
    <Wrapper
      onClick={onClick}
      className="ops-card"
      title={tip}
      style={{
        cursor: onClick ? 'pointer' : (tip ? 'help' : 'default'),
        textAlign: 'left',
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        padding: 'var(--sp-3)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="ops-kicker" style={{ color: 'var(--text-secondary)' }}>{title}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: toneColor, marginTop: 4 }}>{value}</div>
      {sub && <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{sub}</small>}
    </Wrapper>
  );
}

function formatCOP(cents) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(cents) / 100);
}

function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
}
