import { useEffect, useState, useMemo } from 'react';
import api from '../../services/api';
import { useLivePulse } from '../../hooks/useLiveActivity';

/**
 * ExpedienteVivo — vista de caso como grafo operativo
 * (plan-estrategico §7.7).
 *
 * Fase 1: timeline cronológico con filtros por tipo y relaciones
 * mostradas como chips. El "grafo" formal (D3 / cytoscape) llega en F2.
 */

// Colores semánticos por tipo. Mantenemos hardcoded porque la paleta dark
// platform es monocromática negro+dorado; estos acentos siguen la paleta
// secundaria del Manual de Marca (azul, vino, verde, gold) + acento rojo
// para señales de urgencia.
const TYPE_META = {
  email:           { label: 'Correos',       color: '#4A9ED4', icon: '✉' },
  note:            { label: 'Notas',         color: '#9A9FA3', icon: 'N' },
  document:        { label: 'Documentos',    color: '#947F57', icon: 'D' },
  actuacion:       { label: 'Actuaciones',   color: '#7DB87E', icon: 'A' },
  vencimiento:     { label: 'Vencimientos',  color: '#E87A7A', icon: '⏰' },
  tarea:           { label: 'Tareas',        color: '#D4B84A', icon: '☐' },
  cpnu_actuacion:  { label: 'Rama Judicial', color: '#B89F77', icon: '◈' },
};

const ALL_TYPES = Object.keys(TYPE_META);

export default function ExpedienteVivo({ caseId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTypes, setActiveTypes] = useState(new Set(ALL_TYPES));
  const [tick, setTick] = useState(0);

  // Presencia en vivo: ¿Phi está actuando sobre ESTE caso ahora mismo?
  const livePulse = useLivePulse((ev) => String(ev.caseId) === String(caseId));
  // Auto-archivo (F5): un documento se redactó/firmó/clasificó en este caso.
  const docArchived = useLivePulse(
    (ev) => String(ev.caseId) === String(caseId) && /document|archiv|firm|sign|export/i.test(ev.actionType || ''),
    8000,
  );

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    setLoading(true);
    api.get(`/cases/${caseId}/expediente`)
      .then((res) => { if (!cancelled) setData(res.data); })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [caseId, tick]);

  // Recarga el expediente cuando el agente muta algo (chat interno o MCP externo).
  useEffect(() => {
    const handler = () => setTick((t) => t + 1);
    window.addEventListener('phi-mutation', handler);
    return () => window.removeEventListener('phi-mutation', handler);
  }, []);

  const filteredNodes = useMemo(() => {
    if (!data) return [];
    return data.nodes.filter((n) => activeTypes.has(n.type));
  }, [data, activeTypes]);

  const groupedByDay = useMemo(() => {
    const groups = new Map();
    for (const node of filteredNodes) {
      const day = node.timestamp ? new Date(node.timestamp).toISOString().slice(0, 10) : 'sin-fecha';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(node);
    }
    return Array.from(groups.entries());
  }, [filteredNodes]);

  // Map de edges para mostrar "deriva de" / "produce" en cada nodo
  const edgesByNode = useMemo(() => {
    const m = new Map();
    if (!data) return m;
    for (const e of data.edges || []) {
      if (!m.has(e.from)) m.set(e.from, []);
      m.get(e.from).push({ direction: 'out', other: e.to, kind: e.kind });
      if (!m.has(e.to)) m.set(e.to, []);
      m.get(e.to).push({ direction: 'in', other: e.from, kind: e.kind });
    }
    return m;
  }, [data]);

  const toggleType = (t) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  if (loading) return <div style={{ color: 'var(--text-secondary)', padding: 'var(--sp-2)' }}>Cargando expediente…</div>;
  if (error)   return <div className="alert alert-error">{error}</div>;
  if (!data || data.total_nodes === 0) {
    return (
      <div style={{ padding: 'var(--sp-3)', textAlign: 'center', color: 'var(--text-muted)' }}>
        El expediente aún no tiene movimientos. Importa correos, agrega tareas o vincula a CPNU.
      </div>
    );
  }

  return (
    <section className="expediente-vivo" style={{ marginTop: 'var(--sp-3)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-3)', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gold)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            Expediente Vivo
            {livePulse && (
              <span className="expediente-live-badge">
                <span className="live-dot" aria-hidden="true" /> Phi activo
              </span>
            )}
          </div>
          <strong style={{ fontSize: 15, color: 'var(--text-primary)' }}>
            {data.total_nodes} elementos · {Object.keys(data.summary).length} tipos · {data.edges?.length || 0} relaciones
          </strong>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
          {ALL_TYPES.map((t) => {
            const meta = TYPE_META[t];
            const count = data.summary[t] || 0;
            const active = activeTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                disabled={count === 0}
                style={{
                  background: active ? meta.color : 'transparent',
                  color: active ? 'var(--black)' : meta.color,
                  border: `1px solid ${meta.color}`,
                  borderRadius: 14,
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: count > 0 ? 'pointer' : 'not-allowed',
                  opacity: count > 0 ? 1 : 0.35,
                }}
              >
                {meta.icon} {meta.label} ({count})
              </button>
            );
          })}
        </div>
      </header>

      {docArchived && (
        <div className="expediente-autoarchivo">
          <span className="live-dot" aria-hidden="true" /> Documento archivándose en el expediente…
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)' }}>
        {groupedByDay.map(([day, nodes]) => (
          <DayGroup key={day} day={day} nodes={nodes} edgesByNode={edgesByNode} />
        ))}
      </div>
    </section>
  );
}

function DayGroup({ day, nodes, edgesByNode }) {
  const label = day === 'sin-fecha'
    ? 'Sin fecha'
    : new Date(day).toLocaleDateString('es-CO', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div>
      <div style={{
        fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border)', paddingBottom: 4, marginBottom: 'var(--sp-2)',
      }}>
        {label}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
        {nodes.map((n) => <NodeCard key={n.id} node={n} edges={edgesByNode.get(n.id) || []} />)}
      </div>
    </div>
  );
}

function NodeCard({ node, edges }) {
  const meta = TYPE_META[node.type] || { label: node.type, color: '#9A9FA3', icon: '?' };
  const time = node.timestamp ? new Date(node.timestamp).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <article
      style={{
        display: 'flex',
        gap: 'var(--sp-2)',
        padding: 'var(--sp-2)',
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 'var(--radius)',
      }}
    >
      <div
        style={{
          width: 28, height: 28, borderRadius: 14,
          background: meta.color, color: 'var(--black)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700, flexShrink: 0,
        }}
      >
        {meta.icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-2)' }}>
          <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{node.title || '(sin título)'}</strong>
          <small style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{time || ''}</small>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>
          {node.summary}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap', marginTop: 6 }}>
          {node.status && (
            <span style={statusChipStyle(node)}>{String(node.status).toLowerCase()}</span>
          )}
          {node.priority && (
            <span style={{ ...chipStyle, background: 'rgba(212,184,74,0.15)', color: '#D4B84A', borderColor: 'rgba(212,184,74,0.3)' }}>prio {node.priority.toLowerCase()}</span>
          )}
          {node.urgency && (
            <span style={{ ...chipStyle, background: 'rgba(232,122,122,0.15)', color: '#E87A7A', borderColor: 'rgba(232,122,122,0.3)' }}>{node.urgency.toLowerCase()}</span>
          )}
          {node.refs?.radicado && (
            <span style={{ ...chipStyle, background: 'var(--bg-4)' }}>📌 {node.refs.radicado.slice(0, 24)}</span>
          )}
          {edges.length > 0 && edges.slice(0, 3).map((e, i) => (
            <span key={i} style={{ ...chipStyle, background: 'rgba(184,159,119,0.15)', color: 'var(--gold-light)', borderColor: 'rgba(184,159,119,0.3)' }}>
              {edgeLabel(e)}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

const chipStyle = {
  fontSize: 10,
  padding: '2px 8px',
  borderRadius: 10,
  background: 'var(--bg-4)',
  color: 'var(--text-secondary)',
  fontWeight: 500,
  border: '1px solid var(--border)',
};

function statusChipStyle(node) {
  const status = String(node.status || '').toLowerCase();
  const styleMap = {
    nueva:      { background: 'rgba(212,184,74,0.15)', color: '#D4B84A' },
    completada: { background: 'rgba(125,184,126,0.15)', color: '#7DB87E' },
    agendada:   { background: 'rgba(74,158,212,0.15)', color: '#4A9ED4' },
    pendiente:  { background: 'rgba(212,184,74,0.15)', color: '#D4B84A' },
    vista:      { background: 'var(--bg-4)', color: 'var(--text-secondary)' },
    bloqueada:  { background: 'rgba(232,122,122,0.15)', color: '#E87A7A' },
  };
  return { ...chipStyle, ...(styleMap[status] || {}) };
}

function edgeLabel(e) {
  const kindMap = {
    derived_from: e.direction === 'out' ? 'deriva de' : 'origina',
    origin:       e.direction === 'out' ? 'nace de' : 'genera',
    references:   'referencia',
    attachment:   e.direction === 'out' ? 'adjunta' : 'adjunto a',
  };
  return `↔ ${kindMap[e.kind] || e.kind}`;
}
