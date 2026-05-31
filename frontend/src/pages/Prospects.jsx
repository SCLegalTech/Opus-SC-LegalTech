import { useEffect, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { formatPhone, formatRelativeTime } from '../services/whatsappApi';

const PIPELINE_STATUSES = [
  { value: 'nuevo',      label: 'Nuevo',      color: '#9A9FA3' },
  { value: 'contactado', label: 'Contactado', color: '#4A9ED4' },
  { value: 'calificado', label: 'Calificado', color: '#D4B84A' },
  { value: 'propuesta',  label: 'Propuesta',  color: '#947F57' },
  { value: 'ganado',     label: 'Ganado',     color: '#7DB87E' },
  { value: 'perdido',    label: 'Perdido',    color: '#E87A7A' },
];

const SERVICE_TYPES = ['PQRS', 'TUTELA', 'CONTRATO', 'LABORAL', 'PENAL', 'SOCIETARIO', 'REGULATORIO', 'OTRO'];

export default function Prospects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  const filters = {
    pipeline_status: searchParams.get('status') || 'all',
    assigned_to:     searchParams.get('assigned') || '',
    service_type:    searchParams.get('service') || '',
    search:          searchParams.get('q') || '',
  };

  const updateFilter = (key, val) => {
    const next = new URLSearchParams(searchParams);
    const map = { pipeline_status: 'status', assigned_to: 'assigned', service_type: 'service', search: 'q' };
    if (val) next.set(map[key], val); else next.delete(map[key]);
    setSearchParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (filters.pipeline_status && filters.pipeline_status !== 'all') params.pipeline_status = filters.pipeline_status;
      if (filters.assigned_to)  params.assigned_to  = filters.assigned_to;
      if (filters.service_type) params.service_type = filters.service_type;
      if (filters.search)       params.search       = filters.search;
      params.limit = 100;
      const res = await api.get('/prospects', { params });
      setProspects(res.data?.prospects || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error cargando prospectos');
    } finally {
      setLoading(false);
    }
  }, [filters.pipeline_status, filters.assigned_to, filters.service_type, filters.search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 'var(--sp-4)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>Prospectos</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Pipeline comercial. Phi crea entradas automáticamente desde WhatsApp.
          </p>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {prospects.length} resultado{prospects.length !== 1 ? 's' : ''}
        </div>
      </div>

      <FilterBar filters={filters} onChange={updateFilter} />

      {loading && <div style={emptyStyle}>Cargando…</div>}
      {error && <div style={{ ...emptyStyle, color: '#E87A7A' }}>{error}</div>}

      {!loading && !error && (
        <div style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
          <KanbanBoard prospects={prospects} onSelect={setSelected} selectedId={selected?.id} />
          {selected && (
            <DetailPane
              prospectId={selected.id}
              onClose={() => setSelected(null)}
              onUpdated={() => { setSelected(null); load(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// FilterBar
// ─────────────────────────────────────────────────────────────

function FilterBar({ filters, onChange }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
      <input
        type="search"
        placeholder="Nombre, teléfono o descripción"
        value={filters.search}
        onChange={(e) => onChange('search', e.target.value)}
        style={{ ...inputStyle, minWidth: 220, flex: 1 }}
      />
      <select value={filters.assigned_to} onChange={(e) => onChange('assigned_to', e.target.value)} style={inputStyle}>
        <option value="">Todos</option>
        <option value="me">Míos</option>
        <option value="unassigned">Sin asignar</option>
      </select>
      <select value={filters.service_type} onChange={(e) => onChange('service_type', e.target.value)} style={inputStyle}>
        <option value="">Cualquier servicio</option>
        {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KanbanBoard
// ─────────────────────────────────────────────────────────────

function KanbanBoard({ prospects, onSelect, selectedId }) {
  const grouped = PIPELINE_STATUSES.reduce((acc, s) => {
    acc[s.value] = prospects.filter((p) => p.pipeline_status === s.value);
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', gap: 'var(--sp-2)', flex: 1, overflowX: 'auto' }}>
      {PIPELINE_STATUSES.map((status) => (
        <div key={status.value} style={{
          minWidth: 240,
          flex: '1 1 240px',
          background: 'var(--bg-1)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 240px)',
        }}>
          <div style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              color: status.color,
              textTransform: 'uppercase',
            }}>
              {status.label}
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {grouped[status.value]?.length || 0}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--sp-2)' }}>
            {(grouped[status.value] || []).map((p) => (
              <ProspectCard key={p.id} prospect={p} active={p.id === selectedId} onClick={() => onSelect(p)} />
            ))}
            {(!grouped[status.value] || grouped[status.value].length === 0) && (
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center', padding: 'var(--sp-3)' }}>
                Vacío
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProspectCard({ prospect, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 10px',
        background: active ? 'var(--bg-2)' : 'var(--bg-0)',
        border: active ? '1px solid var(--accent-gold, #947F57)' : '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        color: 'var(--text)',
        cursor: 'pointer',
        marginBottom: 6,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: 4 }}>
        {prospect.full_name || formatPhone(prospect.phone) || '(sin nombre)'}
      </div>
      <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)', marginBottom: 4 }}>
        {prospect.service_type || '—'} · {prospect.source || '—'}
      </div>
      {prospect.description && (
        <div style={{ fontSize: '0.7rem', color: 'var(--text)', opacity: 0.85, marginBottom: 4 }}>
          {truncate(prospect.description, 90)}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.62rem', color: 'var(--text-muted)' }}>
        <span>{formatRelativeTime(prospect.created_at)}</span>
        {prospect.wa_conversations_count > 0 && (
          <Link
            to={`/whatsapp?c=${prospect.wa_conversations_count > 0 ? '' : ''}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--accent-gold, #947F57)', textDecoration: 'none' }}
            title={`${prospect.wa_conversations_count} conversación(es) WhatsApp`}
          >
            WA · {prospect.wa_conversations_count}
          </Link>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// DetailPane
// ─────────────────────────────────────────────────────────────

function DetailPane({ prospectId, onClose, onUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    setLoading(true);
    api.get(`/prospects/${prospectId}`)
      .then((res) => {
        setData(res.data);
        setForm(res.data.prospect);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [prospectId]);

  const handleSave = async () => {
    try {
      await api.patch(`/prospects/${prospectId}`, {
        full_name: form.full_name || null,
        phone: form.phone || null,
        email: form.email || null,
        document_type: form.document_type || null,
        document_number: form.document_number || null,
        service_type: form.service_type || null,
        pipeline_status: form.pipeline_status,
        description: form.description || null,
        notes: form.notes || null,
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleConvert = async () => {
    if (!confirm(`¿Convertir a ${data.prospect.full_name || 'este prospecto'} en cliente?`)) return;
    try {
      const res = await api.post(`/prospects/${prospectId}/convert`, {});
      alert(`Cliente creado (#${res.data.client.id}). El hilo de WhatsApp queda vinculado.`);
      onUpdated();
    } catch (err) {
      alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  };

  if (loading) return <div style={{ ...detailPaneStyle, padding: 'var(--sp-4)' }}>Cargando…</div>;
  if (!data)   return <div style={{ ...detailPaneStyle, padding: 'var(--sp-4)' }}>No se pudo cargar.</div>;

  const { prospect, conversations } = data;

  return (
    <div style={detailPaneStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-3)' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>{prospect.full_name || formatPhone(prospect.phone) || 'Prospecto'}</h2>
        <button onClick={onClose} style={ghostBtnStyle}>Cerrar</button>
      </div>

      <div style={{ marginBottom: 'var(--sp-3)' }}>
        <StatusBadge status={prospect.pipeline_status} />
      </div>

      {!editing ? (
        <ReadView prospect={prospect} />
      ) : (
        <EditForm form={form} setForm={setForm} />
      )}

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {!editing ? (
          <>
            <button onClick={() => setEditing(true)} style={primaryBtnStyle}>Editar</button>
            {!prospect.converted_client_id && (
              <button onClick={handleConvert} style={primaryBtnStyle}>Convertir a cliente</button>
            )}
          </>
        ) : (
          <>
            <button onClick={handleSave} style={primaryBtnStyle}>Guardar</button>
            <button onClick={() => { setEditing(false); setForm(prospect); }} style={ghostBtnStyle}>Cancelar</button>
          </>
        )}
      </div>

      {conversations?.length > 0 && (
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)' }}>
            Conversaciones WhatsApp
          </div>
          {conversations.map((c) => (
            <Link
              key={c.id}
              to={`/whatsapp?c=${c.id}`}
              style={{
                display: 'block',
                padding: 'var(--sp-2)',
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                textDecoration: 'none',
                marginBottom: 6,
                fontSize: '0.78rem',
              }}
            >
              {c.contact_name || formatPhone(c.contact_phone)} · {c.consent_status}
              <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                Último: {formatRelativeTime(c.last_message_at)} · {c.unread_count} no leídos
              </div>
            </Link>
          ))}
        </div>
      )}

      {prospect.converted_client_id && (
        <div style={{ marginTop: 'var(--sp-3)', padding: 'var(--sp-2)', background: 'rgba(125, 184, 126, 0.1)', borderRadius: 'var(--radius)', fontSize: '0.78rem' }}>
          Convertido a cliente:{' '}
          <Link to={`/clients?edit=${prospect.converted_client_id}`}>
            {prospect.converted_client_name || `#${prospect.converted_client_id}`}
          </Link>
          {prospect.converted_case_number && <> · caso {prospect.converted_case_number}</>}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const def = PIPELINE_STATUSES.find((s) => s.value === status) || PIPELINE_STATUSES[0];
  return (
    <span style={{
      fontSize: '0.65rem',
      padding: '3px 10px',
      borderRadius: 999,
      background: `${def.color}22`,
      color: def.color,
      fontWeight: 700,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
    }}>
      {def.label}
    </span>
  );
}

function ReadView({ prospect }) {
  return (
    <dl style={{ margin: 0 }}>
      <Field label="Teléfono"      value={formatPhone(prospect.phone)} />
      <Field label="Email"         value={prospect.email} />
      <Field label="Identificación" value={prospect.document_number ? `${prospect.document_type || 'CC'} ${prospect.document_number}` : null} />
      <Field label="Servicio"      value={prospect.service_type} />
      <Field label="Origen"        value={prospect.source} />
      <Field label="Asignado a"    value={prospect.assigned_name} />
      <Field label="Descripción"   value={prospect.description} multiline />
      <Field label="Notas internas" value={prospect.notes} multiline />
      <Field label="Creado"        value={formatRelativeTime(prospect.created_at)} />
    </dl>
  );
}

function Field({ label, value, multiline }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <dt style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </dt>
      <dd style={{ margin: '2px 0 0 0', fontSize: '0.82rem', whiteSpace: multiline ? 'pre-wrap' : 'normal' }}>
        {value}
      </dd>
    </div>
  );
}

function EditForm({ form, setForm }) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <div>
      <Lbl text="Nombre completo">
        <input value={form.full_name || ''} onChange={(e) => set('full_name', e.target.value)} style={inputStyle} />
      </Lbl>
      <Lbl text="Teléfono">
        <input value={form.phone || ''} onChange={(e) => set('phone', e.target.value)} style={inputStyle} />
      </Lbl>
      <Lbl text="Email">
        <input value={form.email || ''} onChange={(e) => set('email', e.target.value)} style={inputStyle} />
      </Lbl>
      <Lbl text="Tipo / Número de documento">
        <div style={{ display: 'flex', gap: 4 }}>
          <select value={form.document_type || ''} onChange={(e) => set('document_type', e.target.value)} style={{ ...inputStyle, flex: '0 0 80px' }}>
            <option value="">—</option>
            <option value="CC">CC</option>
            <option value="CE">CE</option>
            <option value="NIT">NIT</option>
            <option value="PP">PP</option>
            <option value="TI">TI</option>
          </select>
          <input value={form.document_number || ''} onChange={(e) => set('document_number', e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
      </Lbl>
      <Lbl text="Servicio">
        <select value={form.service_type || ''} onChange={(e) => set('service_type', e.target.value)} style={inputStyle}>
          <option value="">—</option>
          {SERVICE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Lbl>
      <Lbl text="Estado del pipeline">
        <select value={form.pipeline_status || 'nuevo'} onChange={(e) => set('pipeline_status', e.target.value)} style={inputStyle}>
          {PIPELINE_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </Lbl>
      <Lbl text="Descripción">
        <textarea value={form.description || ''} onChange={(e) => set('description', e.target.value)} rows={3} style={inputStyle} />
      </Lbl>
      <Lbl text="Notas internas">
        <textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} rows={3} style={inputStyle} />
      </Lbl>
    </div>
  );
}

function Lbl({ text, children }) {
  return (
    <div style={{ marginBottom: 'var(--sp-2)' }}>
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {text}
      </label>
      {children}
    </div>
  );
}

function truncate(s, n) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n)}…`;
}

const inputStyle = {
  width: '100%',
  padding: '6px 10px',
  background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  fontSize: '0.82rem',
  fontFamily: 'inherit',
};

const emptyStyle = {
  padding: 'var(--sp-4)',
  fontSize: '0.85rem',
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const ghostBtnStyle = {
  padding: '6px 12px',
  fontSize: '0.78rem',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  cursor: 'pointer',
};

const primaryBtnStyle = {
  padding: '6px 14px',
  fontSize: '0.78rem',
  background: 'var(--accent-gold, #947F57)',
  border: 'none',
  borderRadius: 'var(--radius)',
  color: '#000',
  fontWeight: 600,
  cursor: 'pointer',
};

const detailPaneStyle = {
  width: 380,
  flexShrink: 0,
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 'var(--sp-3)',
  maxHeight: 'calc(100vh - 200px)',
  overflowY: 'auto',
};
