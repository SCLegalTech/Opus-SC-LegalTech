import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

/**
 * SalaHeader — pantalla AI-native del caso (plan-estrategico §6.1 + §7.3).
 *
 * Responde las 5 preguntas del manifiesto:
 *  - Contexto (state)
 *  - Lectura (Claudia)
 *  - Riesgo
 *  - Acción
 *  - Rastro (sources)
 */

// Acentos semánticos para nivel de riesgo. El resto del componente usa
// los tokens platform (--bg, --text, --gold, --border).
const RISK_COLOR = {
  CRITICO: '#E87A7A',
  ALTO:    '#D4B84A',
  MEDIO:   'var(--gold)',
  BAJO:    '#7DB87E',
};

export default function SalaHeader({ caseId, onAnalyze, onCreateTask, onCreateDeadline }) {
  const [sala, setSala] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(`/cases/${caseId}/sala`);
      setSala(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error cargando Sala');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!caseId) return;
    load();
  }, [caseId]);

  if (loading) return null;
  if (error) return null;
  if (!sala) return null;

  const riskColor = RISK_COLOR[sala.risk.level] || 'var(--gray)';
  const nextDays = sala.next_action?.due_date ? daysUntilLabel(sala.next_action.due_date) : null;

  // Acción del panel "Próxima mejor acción" según la fuente:
  //  - deadline → ir al vencimiento
  //  - task → ir a la tarea
  //  - case → editar el caso
  //  - ai → analizar (reusar onAnalyze)
  //  - none → invitar a analizar
  const nextActionButton = (() => {
    const src = sala.next_action.source;
    if (src === 'deadline' && sala.next_action.ref?.id) {
      return { label: 'Ir al vencimiento', onClick: () => navigate(`/cases/${sala.case.id}#vencimiento-${sala.next_action.ref.id}`) };
    }
    if (src === 'task' && sala.next_action.ref?.id) {
      return { label: 'Ir a la tarea', onClick: () => navigate(`/tasks?id=${sala.next_action.ref.id}`) };
    }
    if ((src === 'ai' || src === 'none') && onAnalyze) {
      return { label: src === 'none' ? 'Convocar Sala' : 'Reanalizar', onClick: onAnalyze };
    }
    return null;
  })();

  // Acción del panel "Faltantes" sugiere arreglar el más prioritario.
  const gapsButton = (() => {
    if (sala.gaps.length === 0) return null;
    const top = sala.gaps[0];
    if (/plazo/i.test(top) && onCreateDeadline) {
      return { label: 'Registrar plazo', onClick: onCreateDeadline };
    }
    if (/cliente/i.test(top)) {
      return { label: 'Editar caso', onClick: () => navigate(`/cases/${sala.case.id}?edit=1`) };
    }
    if (/Drive/i.test(top)) {
      return { label: 'Conectar Drive', onClick: () => navigate('/integrations') };
    }
    return null;
  })();

  return (
    <section
      className="sala-header"
      style={{
        background: 'linear-gradient(180deg, var(--surface-1) 0%, var(--bg-1) 100%)',
        border: '1px solid var(--border-gold)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--sp-4)',
        marginBottom: 'var(--sp-3)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Decoración Φ flotante a la derecha */}
      <div style={{
        position: 'absolute',
        top: -20, right: -10,
        fontSize: 160,
        color: 'rgba(148,127,87,0.04)',
        fontFamily: 'var(--font-editorial)',
        lineHeight: 1,
        pointerEvents: 'none',
        userSelect: 'none',
      }}>Φ</div>

      {/* Banner superior con kicker dorado */}
      <div style={{ position: 'relative', marginBottom: 'var(--sp-3)' }}>
        <div style={{ fontSize: 10, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: 1.5, fontWeight: 700 }}>
          Sala del Caso · {sala.case.case_number}
        </div>
        <h1 style={{ fontSize: 22, color: 'var(--text-primary)', margin: '4px 0 2px 0', fontFamily: 'var(--font-editorial)' }}>
          {sala.case.title.length > 80 ? sala.case.title.slice(0, 80) + '…' : sala.case.title}
        </h1>
      </div>

      {/* HERO: Próxima mejor acción ocupando 70% + Riesgo 30% */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '2fr 1fr',
        gap: 'var(--sp-3)',
        marginBottom: 'var(--sp-3)',
        position: 'relative',
      }}>
        <HeroAction
          text={sala.next_action.text}
          days={nextDays}
          source={sourceLabel(sala.next_action.source)}
          action={nextActionButton}
        />
        <HeroRisk
          level={sala.risk.level}
          color={riskColor}
          reasons={sala.risk.reasons}
          onCreateTask={sala.risk.level === 'CRITICO' && onCreateTask ? () => onCreateTask({ priority: 'CRITICA' }) : null}
        />
      </div>

      {/* Sub-banda: Lectura + Faltantes + Rastro + Plan */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 'var(--sp-2)',
        position: 'relative',
      }}>
        <SalaPanel
          title="Lectura de Phi"
          accent="var(--gold)"
          body={<span style={{ color: 'var(--text-primary)', fontSize: 12 }}>{sala.lectura.summary}</span>}
          sub={sala.lectura.created_at ? `Análisis del ${formatDate(sala.lectura.created_at)}` : null}
          action={onAnalyze ? { label: sala.lectura.available ? 'Reanalizar' : 'Analizar ahora', onClick: onAnalyze } : null}
        />

        {sala.gaps.length > 0 && (
          <SalaPanel
            title="Faltantes"
            accent="#D4B84A"
            body={
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                {sala.gaps.slice(0, 4).map((g, i) => (
                  <li key={i}>{g}</li>
                ))}
              </ul>
            }
            action={gapsButton}
          />
        )}

        {sala.sources.length > 0 && (
          <SalaPanel
            title="Rastro reciente"
            accent="#5A0A0A"
            body={
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 12, color: 'var(--text-secondary)' }}>
                {sala.sources.slice(0, 4).map((s, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase' }}>
                      {s.origin || s.type}
                      {s.is_new && <span style={{ color: 'var(--gold)', marginLeft: 4 }}>· NUEVA</span>}
                    </span>
                    <div style={{ lineHeight: 1.3, color: 'var(--text-primary)' }}>{s.label}</div>
                  </li>
                ))}
              </ul>
            }
          />
        )}

        {sala.plan && (
          <SalaPanel
            title="Plan en curso"
            accent="#2D4E30"
            body={
              <>
                <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{sala.plan.title}</strong>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  Estado: {sala.plan.status}
                  {sala.plan.requires_approval && ' · requiere aprobación'}
                </div>
              </>
            }
            action={{ label: 'Ver plan', onClick: () => navigate('/aprobaciones') }}
          />
        )}
      </div>
    </section>
  );
}

// Hero grande con la próxima acción. Más visual, dominante.
function HeroAction({ text, days, source, action }) {
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderLeft: '4px solid #0B2F4A',
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--sp-4)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      minHeight: 140,
    }}>
      <div>
        <div style={{ fontSize: 10, color: '#4A9ED4', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>
          ⮕ Próxima mejor acción
        </div>
        <div style={{
          fontSize: 18,
          color: 'var(--text-primary)',
          fontWeight: 600,
          lineHeight: 1.4,
          fontFamily: 'var(--font-editorial)',
        }}>
          {text}
        </div>
        {days && (
          <div style={{ fontSize: 13, color: '#D4B84A', marginTop: 6, fontWeight: 600 }}>
            ⏱ {days}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 'var(--sp-3)' }}>
        <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Fuente: {source}</small>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="btn btn-primary"
            style={{ fontWeight: 700 }}
          >
            {action.label} →
          </button>
        )}
      </div>
    </div>
  );
}

// Riesgo más impactante con el nivel grande.
function HeroRisk({ level, color, reasons, onCreateTask }) {
  return (
    <div style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderLeft: `4px solid ${color}`,
      borderRadius: 'var(--radius-lg)',
      padding: 'var(--sp-3)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 140,
    }}>
      <div style={{ fontSize: 10, color, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, marginBottom: 6 }}>
        ⚠ Nivel de riesgo
      </div>
      <div style={{
        fontSize: 32,
        color,
        fontWeight: 800,
        lineHeight: 1,
        fontFamily: 'var(--font-editorial)',
        marginBottom: 8,
      }}>
        {level}
      </div>
      <ul style={{
        margin: 0,
        paddingLeft: 14,
        fontSize: 11,
        color: 'var(--text-secondary)',
        flex: 1,
        listStyle: 'none',
      }}>
        {reasons.slice(0, 3).map((r, i) => (
          <li key={i} style={{ position: 'relative', marginBottom: 2 }}>
            <span style={{ position: 'absolute', left: -10, color }}>•</span>
            {r}
          </li>
        ))}
      </ul>
      {onCreateTask && (
        <button
          type="button"
          onClick={onCreateTask}
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 8, alignSelf: 'flex-start', borderColor: color, color }}
        >
          Crear tarea urgente
        </button>
      )}
    </div>
  );
}

function SalaPanel({ title, accent, body, sub, action }) {
  return (
    <div
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2) var(--sp-3)',
        minHeight: 90,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ fontSize: 11, textTransform: 'uppercase', color: accent, fontWeight: 600, letterSpacing: 0.5, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{body}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>{sub}</div>}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="btn btn-secondary btn-sm"
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function sourceLabel(s) {
  return {
    deadline: 'vencimiento procesal',
    task: 'tarea crítica',
    case: 'campo del caso',
    ai: 'sugerencia de Phi',
    none: 'sin señal',
  }[s] || s;
}

function daysUntilLabel(d) {
  if (!d) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const t = new Date(d); t.setHours(0,0,0,0);
  const days = Math.ceil((t - now) / 86400000);
  if (days < 0) return `vencido hace ${Math.abs(days)} día(s)`;
  if (days === 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} día(s)`;
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}
