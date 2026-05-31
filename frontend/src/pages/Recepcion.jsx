import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

// Colores semánticos para urgencia. Hardcoded porque la paleta principal
// (negro/dorado) no incluye señales rojo/amarillo. Estos son los acentos
// del Manual de Marca (vino atenuado, dorado vivo, gris).
const URGENCY_COLOR = {
  alta:  '#E87A7A',   // rojo suave
  media: '#D4B84A',   // ámbar
  baja:  '#9A9FA3',   // gris
};

const SERVICE_LABEL = {
  PQRS: 'PQRS',
  TUTELA: 'Tutela',
  CONTRATO: 'Contrato',
  LABORAL: 'Laboral',
  PENAL: 'Penal',
  SOCIETARIO: 'Societario',
  REGULATORIO: 'Regulatorio',
  OTRO: 'Otro',
};

function CreateCaseModal({ item, onSubmit, onClose }) {
  const [form, setForm] = useState({
    title: item.subject || '',
    service_type: item.service_type || 'OTRO',
    description: `Caso creado desde correo recibido de ${item.from_address || '(remitente desconocido)'}.\n\n${item.summary || ''}\n\nResumen del correo:\n${item.subject || ''}`,
  });
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!form.title.trim()) {
      alert('El título es obligatorio');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Crear caso desde correo</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              De: {item.from_address || '(sin remitente)'} · {item.subject || '(sin asunto)'}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 'var(--sp-3)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Título del caso
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}
              autoFocus
            />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Materia
            <select
              value={form.service_type}
              onChange={(e) => setForm({ ...form, service_type: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}
            >
              {Object.entries(SERVICE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Descripción inicial
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={6}
              style={{ width: '100%', marginTop: 2, fontFamily: 'inherit' }}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-2)' }}>
            <button className="btn btn-secondary btn-sm" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={submitting}>
              {submitting ? 'Creando…' : 'Crear caso y asociar correo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACTION_LABEL = {
  associate_case: 'Asociar a caso',
  create_case:    'Crear caso',
  request_info:   'Pedir información',
  dismiss:        'Descartar',
};

export default function Recepcion() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [associating, setAssociating] = useState(null);
  const [creatingCase, setCreatingCase] = useState(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [caseChoices, setCaseChoices] = useState([]);
  const [associatingLoading, setAssociatingLoading] = useState(false);

  // Filtros
  const [filters, setFilters] = useState({
    search: '',
    urgency: '',
    service_type: '',
    sort: 'confidence',
    from: '',
    to: '',
  });

  const load = useCallback(async (overrides = null) => {
    setLoading(true);
    setError(null);
    try {
      const f = overrides || filters;
      const params = { limit: 50, sort: f.sort };
      if (f.search) params.search = f.search;
      if (f.urgency) params.urgency = f.urgency;
      if (f.service_type) params.service_type = f.service_type;
      if (f.from) params.from = f.from;
      if (f.to)   params.to   = f.to;
      const res = await api.get('/inbox', { params });
      setItems(res.data?.items || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error cargando bandeja');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const applyFilter = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    load(next);
  };

  const clearFilters = () => {
    const next = { search: '', urgency: '', service_type: '', sort: 'confidence', from: '', to: '' };
    setFilters(next);
    load(next);
  };

  const refresh = async () => {
    setRefreshing(true);
    setNotice('');
    try {
      const res = await api.post('/inbox/refresh', { maxResults: 15 }, { timeout: 90000 });
      const processed = res.data?.processed ?? 0;
      setNotice(`Triage ejecutado sobre ${processed} correos.`);
      await load();
    } catch (err) {
      if (err.response?.status === 409) {
        setNotice('Gmail no está conectado. Ve a Integraciones para conectarlo.');
      } else {
        setNotice(err.response?.data?.error || err.message || 'No se pudo refrescar.');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const openAssociate = async (item) => {
    setAssociating(item);
    setCaseSearch('');
    setCaseChoices([]);
    if (item.case_match_id) {
      // Prefill: traer el caso sugerido
      try {
        const res = await api.get(`/cases/${item.case_match_id}`);
        if (res.data) setCaseChoices([res.data]);
      } catch {}
    }
  };

  const searchCases = async (term) => {
    setAssociatingLoading(true);
    try {
      const params = new URLSearchParams({ limit: '10' });
      if (term.trim()) params.set('search', term.trim());
      const res = await api.get(`/cases?${params}`);
      setCaseChoices(res.data?.cases || []);
    } catch {
      setCaseChoices([]);
    } finally {
      setAssociatingLoading(false);
    }
  };

  const associateToCase = async (caseId) => {
    if (!associating) return;
    setAssociatingLoading(true);
    try {
      await api.post(`/inbox/${associating.id}/associate`, { case_id: caseId });
      setNotice(`Correo asociado al caso #${caseId}.`);
      setAssociating(null);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.error || 'No se pudo asociar el correo.');
    } finally {
      setAssociatingLoading(false);
    }
  };

  const dismissItem = async (item) => {
    if (!confirm(`¿Descartar el correo "${item.subject || '(sin asunto)'}"?`)) return;
    try {
      await api.post(`/inbox/${item.id}/dismiss`, { reason: 'manual' });
      setNotice('Correo descartado.');
      await load();
    } catch (err) {
      setNotice(err.response?.data?.error || 'No se pudo descartar.');
    }
  };

  // Crear caso pre-llenado con datos del correo
  const openCreateCase = (item) => {
    setCreatingCase(item);
  };

  const submitCreateCase = async (form) => {
    if (!creatingCase) return;
    try {
      const res = await api.post('/cases', {
        title: form.title,
        service_type: form.service_type,
        description: form.description,
        intake_channel: 'email',
      });
      const newCase = res.data?.case || res.data;
      const newCaseId = newCase?.id;
      if (!newCaseId) throw new Error('Caso creado pero sin id devuelto');
      // Asociar el correo al caso nuevo
      await api.post(`/inbox/${creatingCase.id}/associate`, { case_id: newCaseId });
      setNotice(`Caso ${newCase.case_number || `#${newCaseId}`} creado y correo asociado.`);
      setCreatingCase(null);
      await load();
    } catch (err) {
      setNotice(err.response?.data?.error || err.message || 'No se pudo crear el caso.');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Recepción Inteligente</div>
          <div className="page-subtitle">
            Cada correo entrante clasificado por Phi: materia, urgencia, cliente y caso probable, acciones sugeridas.
          </div>
        </div>
        <div className="area-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/integrations')}>
            Conexiones
          </button>
          <button className="btn btn-primary btn-sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? 'Clasificando…' : 'Refrescar y clasificar'}
          </button>
        </div>
      </div>

      <div className="page-body">
        {/* Barra de filtros + búsqueda */}
        <section style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-3)',
          marginBottom: 'var(--sp-3)',
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 1fr 1fr 1fr 1fr auto',
          gap: 'var(--sp-2)',
          alignItems: 'end',
        }}>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Búsqueda
            <input
              type="text"
              placeholder="asunto, remitente, resumen…"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilter({})}
              style={{ width: '100%', marginTop: 2 }}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Desde
            <input type="date" value={filters.from}
              onChange={(e) => applyFilter({ from: e.target.value })}
              style={{ width: '100%', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Hasta
            <input type="date" value={filters.to}
              onChange={(e) => applyFilter({ to: e.target.value })}
              style={{ width: '100%', marginTop: 2 }} />
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Urgencia
            <select value={filters.urgency}
              onChange={(e) => applyFilter({ urgency: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}>
              <option value="">Todas</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Materia
            <select value={filters.service_type}
              onChange={(e) => applyFilter({ service_type: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}>
              <option value="">Todas</option>
              {Object.entries(SERVICE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            Orden
            <select value={filters.sort}
              onChange={(e) => applyFilter({ sort: e.target.value })}
              style={{ width: '100%', marginTop: 2 }}>
              <option value="confidence">Confianza ↓</option>
              <option value="urgency">Urgencia ↓</option>
              <option value="date">Fecha ↓</option>
            </select>
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => applyFilter({})} title="Aplicar búsqueda">Buscar</button>
            <button className="btn btn-ghost btn-sm" onClick={clearFilters} title="Limpiar filtros">✕</button>
          </div>
        </section>

        {notice && <div className="alert alert-info" style={{ marginBottom: 'var(--sp-3)' }}>{notice}</div>}
        {error && <div className="alert alert-error" style={{ marginBottom: 'var(--sp-3)' }}>{error}</div>}

        {loading ? (
          <div className="loading">Cargando bandeja…</div>
        ) : items.length === 0 ? (
          <div className="empty-state" style={{ padding: 'var(--sp-4)', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <p>No hay correos pendientes de triage.</p>
            <p style={{ color: 'var(--text-muted)' }}>
              Pulsa <strong>Refrescar y clasificar</strong> para procesar tu bandeja de Gmail.
            </p>
          </div>
        ) : (
          <div className="triage-grid" style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {items.map((item) => (
              <TriageCard
                key={item.id}
                item={item}
                onAssociate={() => openAssociate(item)}
                onCreateCase={() => openCreateCase(item)}
                onDismiss={() => dismissItem(item)}
                onOpenCase={(id) => navigate(`/cases/${id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {associating && (
        <AssociateModal
          item={associating}
          caseSearch={caseSearch}
          onSearchChange={setCaseSearch}
          onSearch={() => searchCases(caseSearch)}
          choices={caseChoices}
          loading={associatingLoading}
          onPick={associateToCase}
          onClose={() => setAssociating(null)}
          onCreateNew={() => { setAssociating(null); setCreatingCase(associating); }}
        />
      )}

      {creatingCase && (
        <CreateCaseModal
          item={creatingCase}
          onSubmit={submitCreateCase}
          onClose={() => setCreatingCase(null)}
        />
      )}
    </>
  );
}

function TriageCard({ item, onAssociate, onCreateCase, onDismiss, onOpenCase }) {
  const urgencyColor = URGENCY_COLOR[item.urgency] || 'var(--gray)';
  const confidence = item.confidence ? Math.round(Number(item.confidence) * 100) : 0;

  return (
    <article
      className="triage-card"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        borderLeft: `4px solid ${urgencyColor}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--sp-3)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.subject || '(sin asunto)'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
            {item.from_address || 'remitente desconocido'}
            {item.received_at && (
              <span> · {new Date(item.received_at).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-1)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 12,
              background: 'var(--bg-4)',
              color: 'var(--text-primary)',
              fontWeight: 600,
              border: '1px solid var(--border)',
            }}
          >
            {SERVICE_LABEL[item.service_type] || item.service_type}
          </span>
          <span
            style={{
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 12,
              background: urgencyColor,
              color: 'var(--black)',
              fontWeight: 700,
              textTransform: 'capitalize',
            }}
          >
            {item.urgency || 'media'}
          </span>
        </div>
      </header>

      <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', lineHeight: 1.5 }}>
        <strong style={{ color: 'var(--gold)' }}>Lectura de Phi:</strong> {item.summary || '(sin resumen)'}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)', fontSize: 12, marginBottom: 'var(--sp-2)' }}>
        <MatchPill label="Cliente probable" matchId={item.client_match_id} confidence={item.client_match_confidence} />
        <MatchPill
          label="Caso probable"
          matchId={item.case_match_id}
          confidence={item.case_match_confidence}
          onClick={item.case_match_id ? () => onOpenCase(item.case_match_id) : null}
        />
      </div>

      <footer style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <small style={{ color: 'var(--text-secondary)' }}>
          Sugerencia: <strong style={{ color: 'var(--text-primary)' }}>{ACTION_LABEL[item.suggested_action] || item.suggested_action}</strong> · confianza {confidence}%
        </small>
        <div style={{ display: 'flex', gap: 'var(--sp-1, 4px)', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={onAssociate}>
            Asociar a caso
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCreateCase} title="Crear nuevo caso con datos del correo">
            + Crear caso
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
            Descartar
          </button>
        </div>
      </footer>
    </article>
  );
}

function MatchPill({ label, matchId, confidence, onClick }) {
  if (!matchId) {
    return (
      <div style={{ color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
        <div>sin coincidencia</div>
      </div>
    );
  }
  const conf = confidence ? Math.round(Number(confidence) * 100) : 0;
  const content = (
    <>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-secondary)' }}>{label}</div>
      <div style={{ color: 'var(--text-primary)' }}>
        <strong>#{matchId}</strong> · {conf}%
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          textAlign: 'left', background: 'transparent', border: 'none',
          padding: 0, cursor: 'pointer', color: 'var(--gold)',
        }}
      >
        {content}
      </button>
    );
  }
  return <div>{content}</div>;
}

function AssociateModal({ item, caseSearch, onSearchChange, onSearch, choices, loading, onPick, onClose, onCreateNew }) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 600 }}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Asociar correo a caso</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{item.subject || '(sin asunto)'}</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ padding: 'var(--sp-3)' }}>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' }}>
            <input
              value={caseSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar caso por número, título o cliente"
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={onSearch}>
              Buscar
            </button>
          </div>
          {onCreateNew && (
            <div style={{ marginBottom: 'var(--sp-3)', textAlign: 'center' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onCreateNew}>
                ¿No existe el caso? + Crear nuevo
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
            {loading && <div style={{ color: 'var(--text-secondary)' }}>Cargando…</div>}
            {!loading && choices.length === 0 && (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Busca un caso para asociar.</div>
            )}
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onPick(c.id)}
                disabled={loading}
                style={{
                  textAlign: 'left',
                  padding: 'var(--sp-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--bg-3)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600 }}>{c.case_number || `Caso ${c.id}`}</div>
                <div style={{ fontSize: 13 }}>{c.title}</div>
                {c.client_name && <small style={{ color: 'var(--text-secondary)' }}>{c.client_name}</small>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
