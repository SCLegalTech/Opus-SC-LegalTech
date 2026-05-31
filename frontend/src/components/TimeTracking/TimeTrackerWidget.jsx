import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

/**
 * TimeTrackerWidget — cronómetro como "notch" arriba centrado.
 *
 * Posicionado en el top-center para no competir con el panel del agente
 * (bottom-right). Estilo notch (cápsula flotante con bordes redondeados).
 * Se puede ocultar globalmente con localStorage flag (toggle desde
 * /productividad).
 */

const HIDDEN_FLAG = 'tt_hidden';

export default function TimeTrackerWidget({ defaultCaseId = null }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDDEN_FLAG) === '1');
  const [running, setRunning] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [stats, setStats] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const [awardToast, setAwardToast] = useState(null);
  const [taskPrompt, setTaskPrompt] = useState(null);  // { task_id, title } después de parar
  const [progressValue, setProgressValue] = useState(50);
  const tickRef = useRef(null);

  const loadStats = () => {
    api.get('/time/gamification/stats')
      .then((res) => setStats(res.data))
      .catch(() => {});
  };

  // Cargar tareas pendientes top como sugerencias contextuales
  const loadSuggestions = () => {
    api.get('/tareas?status=PENDIENTE&limit=5')
      .then((res) => setSuggestions(res.data?.tareas || res.data?.tasks || res.data || []))
      .catch(() => setSuggestions([]));
  };

  useEffect(() => {
    let cancelled = false;
    api.get('/time/running')
      .then((res) => { if (!cancelled) setRunning(res.data?.entry || null); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    loadStats();
    // Escuchar evento global de toggle (desde Mi Productividad)
    const handleToggle = () => setHidden((h) => {
      const next = !h;
      localStorage.setItem(HIDDEN_FLAG, next ? '1' : '0');
      return next;
    });
    window.addEventListener('time-tracker-toggle', handleToggle);
    return () => {
      cancelled = true;
      window.removeEventListener('time-tracker-toggle', handleToggle);
    };
  }, []);

  useEffect(() => {
    if (open) loadSuggestions();
  }, [open]);

  useEffect(() => {
    if (running && running.start_at) {
      const compute = () => {
        const startMs = new Date(running.start_at).getTime();
        setElapsed(Math.floor((Date.now() - startMs) / 1000));
      };
      compute();
      tickRef.current = setInterval(compute, 1000);
      return () => clearInterval(tickRef.current);
    }
    setElapsed(0);
  }, [running?.id, running?.start_at]);

  const start = async (override = {}) => {
    try {
      const res = await api.post('/time/start', {
        case_id: override.case_id ?? defaultCaseId,
        task_id: override.task_id ?? selectedTaskId,
        description: override.description ?? (description || null),
      });
      setRunning(res.data?.entry);
      setOpen(false);
      setDescription('');
      setSelectedTaskId(null);
    } catch (err) {
      alert(err.response?.data?.error || 'No se pudo iniciar el cronómetro');
    }
  };

  const stop = async () => {
    try {
      const taskIdAssoc = running?.task_id;
      const taskTitle = running?.description || '';
      const res = await api.post('/time/stop');
      setRunning(null);
      const award = res.data?.entry?._award;
      if (award) {
        const lines = [`+${award.xp_gained} XP`];
        for (const b of award.bonuses || []) lines.push(`Bonus: ${b.reason} (+${b.delta} XP)`);
        for (const b of award.badges_unlocked || []) lines.push(`🏆 ${b}`);
        setAwardToast({ lines, level: award.new_level });
        setTimeout(() => setAwardToast(null), 6000);
      }
      // Si había tarea asociada, preguntar qué hacer con ella
      if (taskIdAssoc) {
        setTaskPrompt({ task_id: taskIdAssoc, title: taskTitle });
        setProgressValue(50);
      }
      window.dispatchEvent(new CustomEvent('time-entry-closed'));
      loadStats();
    } catch (err) {
      alert(err.response?.data?.error || 'No se pudo parar el cronómetro');
    }
  };

  const updateTaskFromPrompt = async (action) => {
    if (!taskPrompt) return;
    try {
      const body = {};
      if (action === 'completed') {
        body.status = 'COMPLETADA';
      } else if (action === 'in_progress') {
        body.status = 'EN_CURSO';
        body.progress_percent = progressValue;
      } else if (action === 'pending') {
        body.status = 'PENDIENTE';
      }
      await api.put(`/tareas/${taskPrompt.task_id}`, body);
    } catch (err) {
      console.warn('update tarea fallo:', err.message);
    } finally {
      setTaskPrompt(null);
    }
  };

  if (loading || hidden) return null;

  const lv = stats?.level_info;

  return (
    <>
      {/* Prompt de status de tarea al parar */}
      {taskPrompt && (
        <div style={{
          position: 'fixed',
          top: 56, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1200,
          background: 'var(--bg-2)',
          border: '1px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-3)',
          boxShadow: 'var(--shadow)',
          width: 340,
          color: 'var(--text-primary)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
            ¿Qué hago con la tarea?
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)' }}>
            {taskPrompt.title || `Tarea #${taskPrompt.task_id}`}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 'var(--sp-2)' }}>
            <button className="btn btn-primary btn-sm" onClick={() => updateTaskFromPrompt('completed')}>
              ✓ Completada (100%)
            </button>
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--sp-2)',
              alignItems: 'center',
              padding: '6px 10px', background: 'var(--bg-3)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                En curso: {progressValue}%
                <input
                  type="range" min={0} max={100} step={5}
                  value={progressValue}
                  onChange={(e) => setProgressValue(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 4 }}
                />
              </label>
              <button className="btn btn-secondary btn-sm" onClick={() => updateTaskFromPrompt('in_progress')}>
                Guardar
              </button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => updateTaskFromPrompt('pending')}>
              Dejar pendiente
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTaskPrompt(null)} style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              Omitir
            </button>
          </div>
        </div>
      )}

      {/* Toast XP separado para que flote independiente */}
      {awardToast && !taskPrompt && (
        <div style={{
          position: 'fixed',
          top: 56, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1100,
          background: 'var(--bg-2)',
          border: '1px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-2) var(--sp-3)',
          boxShadow: 'var(--shadow)',
          minWidth: 260,
          color: 'var(--text-primary)',
          animation: 'slideDown 0.3s ease-out',
        }}>
          <div style={{ fontSize: 12, color: 'var(--gold)', fontWeight: 700, marginBottom: 4 }}>
            Lv {awardToast.level?.level} · {awardToast.level?.name}
          </div>
          {awardToast.lines.map((l, i) => (
            <div key={i} style={{ fontSize: 11 }}>{l}</div>
          ))}
        </div>
      )}

      <div style={notchContainer}>
        {running ? (
          <button onClick={stop} style={runningNotch} title="Pulsa para parar el cronómetro">
            <span style={{ fontSize: 10, opacity: 0.85 }}>⏱</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{formatElapsed(elapsed)}</span>
            <span style={{ fontSize: 10, opacity: 0.85, marginLeft: 4 }}>Parar</span>
          </button>
        ) : open ? (
          <div style={openPanel}>
            {lv && (
              <div
                onClick={() => { navigate('/productividad'); setOpen(false); }}
                style={{
                  fontSize: 11, color: 'var(--gold)', marginBottom: 6, cursor: 'pointer',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderBottom: '1px solid var(--border)', paddingBottom: 6,
                }}
                title="Ir a Mi Productividad"
              >
                <span>Lv {lv.level} · {lv.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{lv.xp_total} XP · 🔥{stats.current_streak_days}d</span>
              </div>
            )}

            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="¿Qué vas a trabajar?"
              style={{ width: '100%', marginBottom: 6, fontSize: 12 }}
              onKeyDown={(e) => e.key === 'Enter' && start()}
              autoFocus
            />

            {suggestions.length > 0 && (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
                  Sugerencias (tareas pendientes)
                </div>
                <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {suggestions.slice(0, 5).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setDescription(t.title);
                        setSelectedTaskId(t.id);
                      }}
                      style={{
                        textAlign: 'left',
                        padding: '4px 8px',
                        background: selectedTaskId === t.id ? 'rgba(148,127,87,0.2)' : 'transparent',
                        border: `1px solid ${selectedTaskId === t.id ? 'var(--gold)' : 'var(--border)'}`,
                        borderRadius: 4,
                        color: 'var(--text-primary)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ color: priorityColor(t.priority), marginRight: 4 }}>●</span>
                      {t.title.slice(0, 50)}
                      {t.case_id && <small style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· caso {t.case_id}</small>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-primary btn-sm" onClick={() => start()} style={{ flex: 1 }}>
                Iniciar
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setOpen(true)}
            style={idleNotch}
            title={lv ? `Lv ${lv.level} ${lv.name} · ${lv.xp_total} XP · 🔥${stats.current_streak_days}d` : 'Iniciar cronómetro'}
          >
            <span style={{ fontSize: 12 }}>⏱</span>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Iniciar cronómetro</span>
            {lv && (
              <>
                <span style={{ width: 1, height: 14, background: 'var(--border-gold)', opacity: 0.5 }} />
                <span style={{ fontSize: 10, color: 'var(--gold-light)' }}>
                  Lv {lv.level} · {stats.current_streak_days}🔥
                </span>
              </>
            )}
          </button>
        )}
      </div>
    </>
  );
}

const notchContainer = {
  position: 'fixed',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 1000,
  pointerEvents: 'auto',
};

const idleNotch = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  background: 'var(--bg-2)',
  color: 'var(--gold)',
  border: '1px solid var(--border-gold)',
  borderRadius: 999,
  padding: '6px 16px',
  cursor: 'pointer',
  boxShadow: 'var(--shadow)',
  fontSize: 12,
  fontFamily: 'var(--font-body)',
};

const runningNotch = {
  ...idleNotch,
  background: 'var(--burgundy)',
  color: 'var(--white)',
  border: '1px solid var(--gold)',
  animation: 'pulseRunning 2s ease-in-out infinite',
};

const openPanel = {
  background: 'var(--bg-2)',
  border: '1px solid var(--border-gold)',
  borderRadius: 'var(--radius-lg)',
  padding: 12,
  width: 320,
  boxShadow: 'var(--shadow)',
  color: 'var(--text-primary)',
};

function formatElapsed(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function priorityColor(p) {
  return { CRITICA: '#E87A7A', ALTA: '#D4B84A', MEDIA: 'var(--gold)', BAJA: 'var(--text-muted)' }[p] || 'var(--text-muted)';
}
