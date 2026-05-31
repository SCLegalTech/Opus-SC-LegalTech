import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../services/api';

const STATUS_LABELS = {
  ACTIVO:    { label: 'Activo',    cls: 'badge-activo' },
  EN_ESPERA: { label: 'En espera', cls: 'badge-en-espera' },
  CERRADO:   { label: 'Cerrado',   cls: 'badge-cerrado' },
  ARCHIVADO: { label: 'Archivado', cls: 'badge-archivado' },
};

const SERVICE_LABELS = {
  PQRS:        'PQRS',
  TUTELA:      'Tutela',
  LABORAL:     'Laboral',
  SOCIETARIO:  'Societario',
  CONTRATO:    'Contrato',
  PENAL:       'Penal',
  REGULATORIO: 'Regulatorio',
  OTRO:        'Otro',
};

export default function Projects() {
  const [projects, setProjects]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating]     = useState(false);
  const [form, setForm] = useState({
    title: '', service_type: 'PQRS', entity: '', description: '',
    jurisdiction: 'CO',
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await api.get('/macrocasos');
      setProjects(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title || !form.service_type) return;
    setCreating(true);
    try {
      await api.post('/macrocasos', form);
      setShowCreate(false);
      setForm({ title: '', service_type: 'PQRS', entity: '', description: '', jurisdiction: 'CO' });
      load();
    } catch (err) {
      alert('Error al crear proyecto: ' + (err.response?.data?.error || err.message));
    } finally {
      setCreating(false);
    }
  };

  const urgencyCount = (p) => {
    const v = parseInt(p.vencimientos_vencidos) || 0;
    const t = parseInt(p.tareas_pendientes) || 0;
    return { v, t };
  };

  return (
    <div className="projects-page">
      <div className="projects-header">
        <div>
          <h1 className="page-title">Proyectos</h1>
          <p className="page-subtitle">Macrocasos colectivos — múltiples clientes, una causa</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Nuevo proyecto
        </button>
      </div>

      {/* Estadísticas rápidas */}
      {!loading && projects.length > 0 && (
        <div className="projects-stats">
          <div className="stat-chip">
            <span className="stat-chip-num">{projects.filter(p => p.status === 'ACTIVO').length}</span>
            <span className="stat-chip-label">Activos</span>
          </div>
          <div className="stat-chip">
            <span className="stat-chip-num">
              {projects.reduce((s, p) => s + (parseInt(p.cases_count) || 0), 0)}
            </span>
            <span className="stat-chip-label">Clientes totales</span>
          </div>
          <div className="stat-chip stat-chip-warn">
            <span className="stat-chip-num">
              {projects.reduce((s, p) => s + (parseInt(p.vencimientos_proximos) || 0), 0)}
            </span>
            <span className="stat-chip-label">Vencimientos próximos</span>
          </div>
          <div className="stat-chip stat-chip-crit">
            <span className="stat-chip-num">
              {projects.reduce((s, p) => s + (parseInt(p.vencimientos_vencidos) || 0), 0)}
            </span>
            <span className="stat-chip-label">Vencidos</span>
          </div>
        </div>
      )}

      {/* Lista de proyectos */}
      {loading ? (
        <div className="loading-msg">Cargando proyectos…</div>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <p>No hay proyectos activos.</p>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            Crear primer proyecto
          </button>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map(p => {
            const { v, t } = urgencyCount(p);
            const hasCrit = v > 0;
            return (
              <Link key={p.id} to={`/projects/${p.id}`} className={`project-card ${hasCrit ? 'project-card-crit' : ''}`}>
                <div className="project-card-top">
                  <span className={`badge-service ${p.service_type?.toLowerCase()}`}>
                    {SERVICE_LABELS[p.service_type] || p.service_type}
                  </span>
                  <span className={`badge-status ${STATUS_LABELS[p.status]?.cls || ''}`}>
                    {STATUS_LABELS[p.status]?.label || p.status}
                  </span>
                </div>

                <div className="project-card-body">
                  <h3 className="project-card-title">{p.title}</h3>
                  {p.entity && (
                    <p className="project-card-entity">vs. {p.entity}</p>
                  )}
                  {p.next_action && (
                    <p className="project-card-next">{p.next_action}</p>
                  )}
                </div>

                <div className="project-card-footer">
                  <div className="project-card-meta">
                    <span className="meta-pill">
                      <strong>{p.cases_count || 0}</strong> clientes
                    </span>
                    {t > 0 && (
                      <span className="meta-pill meta-pill-warn">
                        <strong>{t}</strong> tareas
                      </span>
                    )}
                    {v > 0 && (
                      <span className="meta-pill meta-pill-crit">
                        <strong>{v}</strong> vencidos
                      </span>
                    )}
                    {(parseInt(p.vencimientos_proximos) || 0) > 0 && v === 0 && (
                      <span className="meta-pill meta-pill-warn">
                        <strong>{p.vencimientos_proximos}</strong> próximos
                      </span>
                    )}
                  </div>
                  {p.lead_lawyer_name && (
                    <span className="project-card-lawyer">{p.lead_lawyer_name}</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Modal crear proyecto */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nuevo proyecto</h2>
              <button className="modal-close" onClick={() => setShowCreate(false)}>✕</button>
            </div>
            <form onSubmit={handleCreate} className="modal-form">
              <div className="form-group">
                <label>Nombre del proyecto *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="ej: Real Business — PQRS ante SIC"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de servicio *</label>
                  <select
                    value={form.service_type}
                    onChange={e => setForm({ ...form, service_type: e.target.value })}
                  >
                    {Object.entries(SERVICE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Jurisdicción</label>
                  <select
                    value={form.jurisdiction}
                    onChange={e => setForm({ ...form, jurisdiction: e.target.value })}
                  >
                    <option value="CO">Colombia</option>
                    <option value="PA">Panamá</option>
                    <option value="VE">Venezuela</option>
                    <option value="EC">Ecuador</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Entidad accionada / contraparte</label>
                <input
                  type="text"
                  value={form.entity}
                  onChange={e => setForm({ ...form, entity: e.target.value })}
                  placeholder="ej: Superintendencia de Industria y Comercio"
                />
              </div>

              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  placeholder="Contexto general del proyecto…"
                />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Creando…' : 'Crear proyecto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
