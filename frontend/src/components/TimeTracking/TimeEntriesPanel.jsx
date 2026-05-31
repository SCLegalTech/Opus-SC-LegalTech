import { useEffect, useState, useCallback } from 'react';
import api from '../../services/api';

/**
 * TimeEntriesPanel — lista de horas registradas en un caso + cronómetro
 * inline + formulario para entrada manual. Para incrustar en CaseDetail.
 */

export default function TimeEntriesPanel({ caseId }) {
  const [entries, setEntries] = useState([]);
  const [totals, setTotals] = useState(null);
  const [running, setRunning] = useState(null);
  const [loading, setLoading] = useState(true);
  const [manualOpen, setManualOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, totalsRes, runningRes] = await Promise.all([
        api.get(`/cases/${caseId}/time-entries`),
        api.get(`/cases/${caseId}/time-totals`),
        api.get('/time/running'),
      ]);
      setEntries(entriesRes.data?.entries || []);
      setTotals(totalsRes.data?.totals || null);
      setRunning(runningRes.data?.entry || null);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    if (!caseId) return;
    load();
  }, [caseId, load]);

  const startTimer = async (description) => {
    try {
      await api.post('/time/start', { case_id: caseId, description: description || null });
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Error iniciando cronómetro');
    }
  };

  const stopTimer = async () => {
    try {
      await api.post('/time/stop');
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Error parando cronómetro');
    }
  };

  const submitManual = async (form) => {
    try {
      await api.post('/time/manual', {
        case_id: caseId,
        start_at: form.start_at,
        duration_minutes: Number(form.duration_minutes),
        description: form.description || null,
        category: form.category || null,
        billable: form.billable,
      });
      setManualOpen(false);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'Error registrando entrada');
    }
  };

  const deleteEntry = async (id) => {
    if (!confirm('¿Borrar este registro?')) return;
    try {
      await api.delete(`/time/${id}`);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'No se pudo borrar');
    }
  };

  if (loading) return null;

  const runningInThisCase = running && running.case_id === caseId;

  return (
    <section style={{ marginTop: 'var(--sp-3)' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)', flexWrap: 'wrap', gap: 'var(--sp-2)' }}>
        <div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gold)', fontWeight: 600 }}>
            Horas registradas
          </div>
          {totals && (
            <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>
              {formatHours(totals.total_minutes)} total · {formatHours(totals.billable_minutes)} billables · {formatCOP(totals.total_billable_amount_cents)}
              {totals.uninvoiced_amount_cents > 0 && (
                <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}> ({formatCOP(totals.uninvoiced_amount_cents)} sin facturar)</span>
              )}
            </strong>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1, 4px)' }}>
          {runningInThisCase ? (
            <button className="btn btn-danger btn-sm" onClick={stopTimer}>
              Parar cronómetro
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => startTimer('')}>
              ⏱ Iniciar cronómetro
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={() => setManualOpen(true)}>
            + Entrada manual
          </button>
        </div>
      </header>

      {running && !runningInThisCase && (
        <div className="alert alert-info" style={{ marginBottom: 'var(--sp-2)', fontSize: 12 }}>
          Tienes un cronómetro corriendo en otro caso. Al iniciar acá se cierra el actual.
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 'var(--sp-3)' }}>
          Aún no hay horas registradas en este caso.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((e) => (
            <EntryRow key={e.id} entry={e} onDelete={() => deleteEntry(e.id)} />
          ))}
        </div>
      )}

      {manualOpen && (
        <ManualEntryDialog onClose={() => setManualOpen(false)} onSubmit={submitManual} />
      )}
    </section>
  );
}

function EntryRow({ entry, onDelete }) {
  const running = entry.is_running;
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '140px 90px 1fr auto auto',
      gap: 'var(--sp-2)',
      alignItems: 'center',
      padding: '6px 10px',
      background: running ? 'rgba(212,184,74,0.12)' : 'var(--bg-2)',
      border: `1px solid ${running ? 'rgba(212,184,74,0.4)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)',
      fontSize: 12,
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>
        {new Date(entry.start_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
      </span>
      <strong style={{ fontFamily: 'monospace', color: running ? '#D4B84A' : 'var(--text-primary)' }}>
        {running ? '⏱ corriendo' : formatHours(entry.duration_minutes)}
      </strong>
      <span style={{ color: 'var(--text-primary)' }}>
        {entry.user_name && <span style={{ color: 'var(--gold)' }}>{entry.user_name} · </span>}
        {entry.description || <em style={{ color: 'var(--text-muted)' }}>(sin descripción)</em>}
      </span>
      {entry.amount_cents != null ? (
        <span style={{ color: entry.billable ? '#7DB87E' : 'var(--text-muted)', fontWeight: 600 }}>
          {entry.billable ? formatCOP(entry.amount_cents) : 'no billable'}
        </span>
      ) : <span />}
      <button onClick={onDelete} style={{ background: 'transparent', border: 'none', color: '#E87A7A', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
    </div>
  );
}

// Modal usa clases existentes (.modal-overlay / .modal) que ya tienen
// paleta dark.
function ManualEntryDialog({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    start_at: new Date().toISOString().slice(0, 16),
    duration_minutes: 30,
    description: '',
    category: '',
    billable: true,
  });
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div className="modal-title">Nueva entrada manual</div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <label style={{ fontSize: 12 }}>
            Inicio
            <input
              type="datetime-local"
              value={form.start_at}
              onChange={(e) => setForm({ ...form, start_at: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Duración (minutos)
            <input
              type="number"
              min={1}
              value={form.duration_minutes}
              onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 12 }}>
            Categoría
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}
            >
              <option value="">— sin categoría —</option>
              <option value="redaccion">Redacción</option>
              <option value="audiencia">Audiencia</option>
              <option value="reunion">Reunión</option>
              <option value="investigacion">Investigación</option>
              <option value="viaje">Viaje</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label style={{ fontSize: 12 }}>
            Descripción
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              style={{ width: '100%', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={form.billable}
              onChange={(e) => setForm({ ...form, billable: e.target.checked })}
            />
            Billable (entra a facturación)
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={() => onSubmit(form)}>
              Registrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatHours(minutes) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}min`;
}

function formatCOP(cents) {
  if (cents == null) return '—';
  const cop = Number(cents) / 100;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(cop);
}
