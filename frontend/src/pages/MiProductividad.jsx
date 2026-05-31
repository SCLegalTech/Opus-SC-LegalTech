import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * Mi Productividad — capa de gamificación sobre time tracking.
 * Muestra XP, nivel, racha, badges, gráfica 30d y leaderboard de la firma.
 */

const BADGE_META = {
  first_hour:      { label: 'Primera hora',         icon: '⏱', desc: 'Cerraste tu primera entrada de tiempo.' },
  first_billable:  { label: 'Primera billable',     icon: '💰', desc: 'Tu primera hora billable.' },
  streak_7:        { label: 'Racha 7 días',          icon: '🔥', desc: '7 días consecutivos registrando tiempo.' },
  streak_30:       { label: 'Racha 30 días',         icon: '🏆', desc: '30 días consecutivos. Disciplina.' },
  hundred_hours:   { label: '100 horas',             icon: '💯', desc: '100 horas totales registradas.' },
  thousand_hours:  { label: '1000 horas',            icon: '🏛', desc: 'Hito mayor: mil horas.' },
  high_value_day:  { label: 'Día de alto valor',     icon: '⭐', desc: 'Más de 5 horas billables en un día.' },
  night_owl:       { label: 'Búho nocturno',         icon: '🦉', desc: 'Cerraste entrada después de las 10pm.' },
  early_bird:      { label: 'Madrugador',            icon: '🌅', desc: 'Cerraste entrada antes de las 7am.' },
};

const SOURCE_META = {
  time_entry_closed: { label: 'Entrada cerrada', color: 'var(--gold)' },
  streak_bonus:      { label: 'Bonus racha',     color: '#D4B84A' },
  badge_unlocked:    { label: 'Badge',           color: '#7DB87E' },
  manual:            { label: 'Ajuste manual',   color: 'var(--text-secondary)' },
};

export default function MiProductividad() {
  const [stats, setStats] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [quests, setQuests] = useState([]);
  const [percentile, setPercentile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notchHidden, setNotchHidden] = useState(() => localStorage.getItem('tt_hidden') === '1');

  const reload = (signal) => {
    return Promise.all([
      api.get('/time/gamification/stats'),
      api.get('/time/gamification/leaderboard?limit=10').catch(() => ({ data: { rows: [] } })),
      api.get('/time/gamification/quests').catch(() => ({ data: { quests: [] } })),
      api.get('/time/gamification/percentile').catch(() => ({ data: { percentile: null } })),
    ]).then(([s, l, q, p]) => {
      if (signal?.aborted) return;
      setStats(s.data);
      setLeaderboard(l.data?.rows || []);
      setQuests(q.data?.quests || []);
      setPercentile(p.data?.percentile);
    }).catch((err) => {
      if (signal?.aborted) return;
      setError(err.response?.data?.error || err.message);
    }).finally(() => {
      if (signal?.aborted) return;
      setLoading(false);
    });
  };

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    reload(ctrl.signal);

    // Refrescar al volver foco a la página
    const onFocus = () => reload();
    const onVisibility = () => { if (!document.hidden) reload(); };
    const onTimeClosed = () => reload();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('time-entry-closed', onTimeClosed);
    return () => {
      ctrl.abort();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('time-entry-closed', onTimeClosed);
    };
  }, []);

  const toggleNotch = () => {
    window.dispatchEvent(new CustomEvent('time-tracker-toggle'));
    setNotchHidden((h) => !h);
  };

  const toggleOptIn = async () => {
    const next = !stats.show_in_leaderboard;
    try {
      await api.post('/time/gamification/opt-in', { opt_in: next });
      setStats({ ...stats, show_in_leaderboard: next });
    } catch (err) {
      alert(err.response?.data?.error || 'No se pudo actualizar la preferencia');
    }
  };

  if (loading) return <div className="page-body"><p style={{ color: 'var(--text-secondary)' }}>Cargando…</p></div>;
  if (error)   return <div className="page-body"><div className="alert alert-error">{error}</div></div>;
  if (!stats)  return null;

  const lv = stats.level_info;
  const dailyMax = Math.max(1, ...(stats.daily_activity_30d || []).map((d) => d.mins));

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Mi Productividad</div>
          <div className="page-subtitle">Tu progreso, racha y reconocimientos del despacho.</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={toggleNotch}
            title={notchHidden ? 'Mostrar el cronómetro flotante' : 'Ocultar el cronómetro flotante'}
          >
            {notchHidden ? 'Mostrar cronómetro' : 'Ocultar cronómetro'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => reload()} title="Refrescar">
            ↻
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Hero: nivel + XP + percentile */}
        <section style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--sp-3)',
          marginBottom: 'var(--sp-3)',
        }}>
          <BigStat
            kicker={`Nivel ${lv.level}`}
            value={lv.name}
            tone="gold"
            sub={`${lv.xp_total} XP · ${lv.xp_to_next != null ? `${lv.xp_to_next} para ${lv.next_level_name}` : 'Máximo'}`}
          >
            <ProgressBar pct={lv.progress_pct} />
          </BigStat>
          <BigStat
            kicker="Racha actual"
            value={`${stats.current_streak_days}🔥`}
            tone="warn"
            sub={`Mejor: ${stats.longest_streak_days} días`}
          />
          <BigStat
            kicker="Horas billables"
            value={formatHours(stats.billable_minutes)}
            tone="good"
            sub={`${formatCOP(stats.total_amount_cents)} · ${formatHours(stats.total_minutes)} total`}
          />
          {percentile != null && (
            <BigStat
              kicker="Ranking en la firma"
              value={`Top ${100 - percentile}%`}
              tone={percentile >= 80 ? 'gold' : percentile >= 50 ? 'good' : 'neutral'}
              sub={percentile >= 80 ? '🏆 Élite del despacho' : percentile >= 50 ? 'Sobre la media' : 'Sigue subiendo'}
            />
          )}
        </section>

        <QuestsSection quests={quests} />


        {/* Mini gráfica 30d */}
        <section className="ops-section">
          <div className="ops-section-head">
            <div>
              <span>Actividad</span>
              <h3>Últimos 30 días</h3>
            </div>
          </div>
          <ActivityChart data={stats.daily_activity_30d || []} max={dailyMax} />
        </section>

        {/* Badges */}
        <section className="ops-section">
          <div className="ops-section-head">
            <div>
              <span>Reconocimientos</span>
              <h3>{(stats.badges || []).length} de {Object.keys(BADGE_META).length} badges</h3>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--sp-2)' }}>
            {Object.entries(BADGE_META).map(([key, meta]) => {
              const unlocked = (stats.badges || []).includes(key);
              return (
                <article
                  key={key}
                  title={meta.desc}
                  style={{
                    padding: 'var(--sp-2) var(--sp-3)',
                    background: unlocked ? 'var(--bg-3)' : 'var(--bg-1)',
                    border: `1px solid ${unlocked ? 'var(--gold)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius)',
                    opacity: unlocked ? 1 : 0.4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 22 }}>{meta.icon}</span>
                    <div>
                      <strong style={{ fontSize: 13, color: unlocked ? 'var(--gold)' : 'var(--text-muted)' }}>{meta.label}</strong>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{meta.desc}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Leaderboard de la firma */}
        {leaderboard.length > 0 && (
          <section className="ops-section">
            <div className="ops-section-head">
              <div>
                <span>Despacho</span>
                <h3>Ranking de productividad</h3>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={toggleOptIn}
                title={stats.show_in_leaderboard ? 'Salir del ranking visible' : 'Aparecer en el ranking'}
              >
                {stats.show_in_leaderboard ? 'Visible en ranking' : 'Oculto en ranking'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {leaderboard.map((row, i) => (
                <div key={row.user_id} style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr 100px 100px 80px',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                  padding: '8px 12px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: i < 3 ? 'var(--gold)' : 'var(--text-muted)' }}>
                    #{i + 1}
                  </span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{row.name || row.email}</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{row.level_info.name}</span>
                  <span style={{ color: 'var(--gold)', fontWeight: 600, fontSize: 12 }}>{row.xp_total} XP</span>
                  <span style={{ color: 'var(--text-secondary)', fontSize: 12, textAlign: 'right' }}>
                    🔥 {row.current_streak_days}d
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent XP feed */}
        {stats.recent_xp?.length > 0 && (
          <section className="ops-section">
            <div className="ops-section-head">
              <div>
                <span>Historial</span>
                <h3>Últimas ganancias de XP</h3>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {stats.recent_xp.map((xp, i) => {
                const meta = SOURCE_META[xp.source] || { label: xp.source, color: 'var(--text-secondary)' };
                return (
                  <div key={i} style={{
                    display: 'grid',
                    gridTemplateColumns: '100px 1fr 60px 130px',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    fontSize: 12,
                    padding: '4px 10px',
                    color: 'var(--text-secondary)',
                  }}>
                    <span style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</span>
                    <span style={{ color: 'var(--text-primary)' }}>{xp.reason}</span>
                    <span style={{ color: 'var(--gold)', textAlign: 'right' }}>+{xp.xp_delta} XP</span>
                    <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>
                      {new Date(xp.created_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function QuestsSection({ quests }) {
  if (!quests || quests.length === 0) return null;
  const daily = quests.filter((q) => q.quest.frequency === 'daily');
  const weekly = quests.filter((q) => q.quest.frequency === 'weekly');

  const completedDaily = daily.filter((q) => q.completed).length;
  const completedWeekly = weekly.filter((q) => q.completed).length;

  return (
    <section className="ops-section">
      <div className="ops-section-head">
        <div>
          <span>Misiones</span>
          <h3>{completedDaily + completedWeekly} de {quests.length} completadas</h3>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-3)' }}>
        <QuestGroup title={`Diarias · ${completedDaily}/${daily.length}`} quests={daily} accent="#D4B84A" />
        <QuestGroup title={`Semanales · ${completedWeekly}/${weekly.length}`} quests={weekly} accent="var(--gold)" />
      </div>
    </section>
  );
}

function QuestGroup({ title, quests, accent }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: accent, fontWeight: 700, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {quests.map((q) => <QuestCard key={q.quest.key} q={q} accent={accent} />)}
      </div>
    </div>
  );
}

function QuestCard({ q, accent }) {
  const pct = Math.min(100, Math.round((q.progress / q.quest.goal) * 100));
  const isComplete = q.completed;
  return (
    <article
      style={{
        background: isComplete ? 'rgba(125,184,126,0.10)' : 'var(--bg-2)',
        border: `1px solid ${isComplete ? 'rgba(125,184,126,0.4)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '8px 12px',
      }}
      title={q.quest.desc}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <strong style={{ fontSize: 12, color: 'var(--text-primary)' }}>
          {isComplete && '✓ '}{q.quest.label}
        </strong>
        <span style={{ fontSize: 11, color: isComplete ? '#7DB87E' : 'var(--gold)', fontWeight: 700 }}>
          +{q.quest.xp} XP
        </span>
      </div>
      <div style={{ background: 'var(--bg-3)', borderRadius: 3, height: 6, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: isComplete ? '#7DB87E' : accent,
          transition: 'width 0.3s',
        }} />
      </div>
      <small style={{ display: 'block', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
        {q.progress >= q.quest.goal ? `Completada ${isComplete ? '✓' : ''}` : `${q.progress} / ${q.quest.goal}`}
      </small>
    </article>
  );
}

function BigStat({ kicker, value, sub, tone = 'neutral', children }) {
  const color = {
    gold: 'var(--gold)',
    good: '#7DB87E',
    warn: '#D4B84A',
    neutral: 'var(--text-primary)',
  }[tone] || 'var(--text-primary)';
  return (
    <article style={{
      background: 'var(--bg-2)',
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${color}`,
      borderRadius: 'var(--radius)',
      padding: 'var(--sp-3)',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{kicker}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>{sub}</small>}
      {children && <div style={{ marginTop: 8 }}>{children}</div>}
    </article>
  );
}

function ProgressBar({ pct }) {
  return (
    <div style={{ height: 8, background: 'var(--bg-3)', borderRadius: 4, border: '1px solid var(--border)' }}>
      <div style={{
        width: `${Math.min(100, Math.max(0, pct))}%`,
        height: '100%',
        background: 'var(--gold)',
        borderRadius: 4,
        transition: 'width 0.3s',
      }} />
    </div>
  );
}

function ActivityChart({ data, max }) {
  if (data.length === 0) {
    return (
      <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>
        Sin actividad registrada en los últimos 30 días.
      </div>
    );
  }
  // Genera 30 días back-to-front, rellenando huecos
  const map = new Map(data.map((d) => [String(d.day).slice(0, 10), d]));
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ day: key, ...map.get(key), mins: map.get(key)?.mins || 0, billable_mins: map.get(key)?.billable_mins || 0 });
  }
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(30, 1fr)',
      gap: 2,
      alignItems: 'end',
      height: 90,
    }}>
      {days.map((d, i) => {
        const pct = max > 0 ? (d.mins / max) * 100 : 0;
        const bpct = max > 0 ? (d.billable_mins / max) * 100 : 0;
        return (
          <div
            key={i}
            title={`${d.day}: ${formatHours(d.mins)} (${formatHours(d.billable_mins)} billable)`}
            style={{ position: 'relative', height: '100%', cursor: 'help' }}
          >
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: `${pct}%`, background: 'var(--bg-4)', borderRadius: 2,
            }} />
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: `${bpct}%`, background: 'var(--gold)', borderRadius: 2,
            }} />
          </div>
        );
      })}
    </div>
  );
}

function formatHours(minutes) {
  if (!minutes) return '0h';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

function formatCOP(cents) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(Number(cents) / 100);
}
