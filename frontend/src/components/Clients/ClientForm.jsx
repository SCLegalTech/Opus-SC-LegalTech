import { useState } from 'react';
import api from '../../services/api';

const DOC_TYPES = ['CC', 'CE', 'NIT', 'PP', 'TI', 'Otro'];

export default function ClientForm({ client, onClose, onSuccess }) {
  const [form, setForm] = useState({
    full_name: client?.full_name || '',
    document_type: client?.document_type || 'CC',
    document_number: client?.document_number || '',
    email: client?.email || '',
    phone: client?.phone || '',
    address: client?.address || '',
    city: client?.city || '',
    notes: client?.notes || '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const set = (field, value) => setForm(p => ({ ...p, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      let res;
      if (client?.id) {
        res = await api.put(`/clients/${client.id}`, form);
      } else {
        res = await api.post('/clients', form);
      }
      onSuccess(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error guardando cliente');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-title">{client ? 'Editar cliente' : 'Nuevo cliente'}</div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-group full">
              <label className="form-label">Nombre completo *</label>
              <input
                type="text"
                value={form.full_name}
                onChange={e => set('full_name', e.target.value)}
                placeholder="Nombre completo del cliente"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Tipo de documento</label>
              <select value={form.document_type} onChange={e => set('document_type', e.target.value)}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Número de documento</label>
              <input
                type="text"
                value={form.document_number}
                onChange={e => set('document_number', e.target.value)}
                placeholder="Ej: 1234567890"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Correo electrónico</label>
              <input
                type="email"
                value={form.email}
                onChange={e => set('email', e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Teléfono</label>
              <input
                type="text"
                value={form.phone}
                onChange={e => set('phone', e.target.value)}
                placeholder="Ej: 3001234567"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Dirección</label>
              <input
                type="text"
                value={form.address}
                onChange={e => set('address', e.target.value)}
                placeholder="Calle 123 #45-67"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Ciudad</label>
              <input
                type="text"
                value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="Bogotá D.C."
              />
            </div>

            <div className="form-group full">
              <label className="form-label">Notas internas</label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="Notas de uso interno del equipo..."
                rows={3}
              />
            </div>
          </div>

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Guardando...' : client ? 'Guardar cambios' : 'Crear cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
