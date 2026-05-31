import { useState, useEffect } from 'react';
import api from '../../services/api';
import { track } from '../../hooks/useTracking';

const SERVICE_TYPES = [
  { type: 'PQRS', label: 'PQRS', description: 'Peticion, Queja, Reclamo o Sugerencia' },
  { type: 'TUTELA', label: 'Tutela', description: 'Accion de Tutela' },
  { type: 'PENAL', label: 'Penal', description: 'Proceso penal o defensa penal' },
  { type: 'CIVIL', label: 'Civil', description: 'Proceso civil, familia o comercial' },
  { type: 'ADMINISTRATIVO', label: 'Administrativo', description: 'Proceso contencioso o administrativo' },
  { type: 'LABORAL', label: 'Laboral', description: 'Proceso laboral o seguridad social' },
  { type: 'OTRO', label: 'Otro', description: 'Otro tipo de caso' },
];

export default function CaseForm({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    client_id: '',
    service_type: '',
    title: '',
    description: '',
    entity: '',
    filing_date: '',
    response_deadline: '',
  });
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/clients?limit=200')
      .then(res => setClients(res.data.clients))
      .catch(console.error);
  }, []);

  const set = (field, value) => setForm(p => ({ ...p, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.service_type) { setError('Selecciona el tipo de servicio'); return; }
    setLoading(true); setError('');
    try {
      const res = await api.post('/cases', form);
      // TelemetrÃ­a: paso del funnel "primer caso". El backend deduplica
      // por org desde user_events (acepta mÃºltiples y se queda con el
      // primero por org al armar el funnel). No filtramos acÃ¡.
      track('first_case_created', { service_type: form.service_type });
      onSuccess(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error creando caso');
    } finally {
      setLoading(false);
    }
  };

  const selectedService = SERVICE_TYPES.find(s => s.type === form.service_type);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">Nuevo Caso</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>âœ•</button>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Tipo de servicio */}
          <div className="form-group" style={{ marginBottom: 'var(--sp-4)' }}>
            <label className="form-label">Tipo de servicio</label>
            <div className="service-selector" style={{ marginTop: 'var(--sp-2)' }}>
              {SERVICE_TYPES.map(svc => (
                <button
                  key={svc.type}
                  type="button"
                  className={`service-option${form.service_type === svc.type ? ' selected' : ''}`}
                  onClick={() => set('service_type', svc.type)}
                >
                  <div className="service-name">{svc.label}</div>
                  <div className="service-desc">{svc.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="form-grid">
            {/* Cliente */}
            <div className="form-group full">
              <label className="form-label">Cliente *</label>
              <select
                value={form.client_id}
                onChange={e => set('client_id', e.target.value)}
                required
              >
                <option value="">Seleccionar cliente...</option>
                {clients.map(cl => (
                  <option key={cl.id} value={cl.id}>
                    {cl.full_name} â€” {cl.document_type} {cl.document_number}
                  </option>
                ))}
              </select>
            </div>

            {/* TÃ­tulo */}
            <div className="form-group full">
              <label className="form-label">TÃ­tulo del caso *</label>
              <input
                type="text"
                value={form.title}
                onChange={e => set('title', e.target.value)}
                placeholder={
                  form.service_type === 'TUTELA'
                    ? 'Ej: Tutela contra EPS por negaciÃ³n de medicamentos'
                    : 'Ej: PQRS ante Superintendencia de Salud'
                }
                required
              />
            </div>

            {/* Entidad */}
            <div className="form-group full">
              <label className="form-label">Entidad accionada / destinataria</label>
              <input
                type="text"
                value={form.entity}
                onChange={e => set('entity', e.target.value)}
                placeholder="Ej: EPS Sanitas, AlcaldÃ­a Mayor de BogotÃ¡..."
              />
            </div>

            {/* DescripciÃ³n */}
            <div className="form-group full">
              <label className="form-label">DescripciÃ³n / Hechos relevantes</label>
              <textarea
                value={form.description}
                onChange={e => set('description', e.target.value)}
                placeholder="Describe brevemente los hechos y el objeto de la acciÃ³n..."
                rows={4}
              />
            </div>

            {/* Fechas */}
            <div className="form-group">
              <label className="form-label">Fecha de radicaciÃ³n</label>
              <input
                type="date"
                value={form.filing_date}
                onChange={e => set('filing_date', e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Fecha lÃ­mite de respuesta</label>
              <input
                type="date"
                value={form.response_deadline}
                onChange={e => set('response_deadline', e.target.value)}
              />
            </div>
          </div>

          {selectedService && (
            <div style={{
              marginTop: 'var(--sp-4)',
              padding: 'var(--sp-3)',
              background: 'rgba(148,127,87,0.08)',
              border: '1px solid rgba(148,127,87,0.3)',
              borderRadius: 'var(--radius)',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)'
            }}>
              {selectedService.description}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creando...' : 'Crear caso'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
