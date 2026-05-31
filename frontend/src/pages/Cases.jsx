import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import CaseForm from '../components/Cases/CaseForm';
import { useAgent } from '../context/AgentContext';
import { useActiveCaseIds } from '../hooks/useLiveActivity';

const formatCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n);

const STATUS_LABELS = {
  NUEVO: 'Nuevo', EN_PROCESO: 'En proceso',
  PENDIENTE: 'Pendiente', CERRADO: 'Cerrado', ARCHIVADO: 'Archivado'
};

export default function Cases() {
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filters, setFilters] = useState({ search: '', status: '', service_type: '' });
  const [draggingId, setDraggingId] = useState(null);
  const navigate = useNavigate();
  const { addArtifact } = useAgent();
  const activeCases = useActiveCaseIds();

  const handleDragStart = (e, c) => {
    setDraggingId(c.id);
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('application/x-sc-artifact', JSON.stringify({
      type:    'case',
      id:      c.id,
      title:   `${c.case_number} — ${c.title}`,
      summary: `${c.client_name} · ${c.status}`,
      data: {
        case_number:       c.case_number,
        service_type:      c.service_type,
        status:            c.status,
        client_name:       c.client_name,
        entity:            c.entity,
        fee:               c.fee,
        fee_paid:          c.fee_paid,
        response_deadline: c.response_deadline,
        next_action:       c.next_action,
      },
    }));
  };

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.status) params.set('status', filters.status);
      if (filters.service_type) params.set('service_type', filters.service_type);
      const res = await api.get(`/cases?${params}`);
      setCases(res.data.cases);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { loadCases(); }, [loadCases]);

  // Auto-refresh cuando el agente muta algo (chat interno o MCP externo).
  useEffect(() => {
    const handler = () => { loadCases(); };
    window.addEventListener('phi-mutation', handler);
    return () => window.removeEventListener('phi-mutation', handler);
  }, [loadCases]);

  const handleCaseCreated = (newCase) => {
    setShowForm(false);
    navigate(`/cases/${newCase.id}`);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Casos</div>
          <div className="page-subtitle">{total} caso{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          + Nuevo caso
        </button>
      </div>

      <div className="page-body">
        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              type="text"
              placeholder="Buscar por número, título o cliente..."
              value={filters.search}
              onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
            />
          </div>

          <select
            className="filter-select"
            value={filters.service_type}
            onChange={e => setFilters(p => ({ ...p, service_type: e.target.value }))}
          >
            <option value="">Todos los servicios</option>
            <option value="PQRS">PQRS</option>
            <option value="TUTELA">Tutela</option>
            <option value="PENAL">Penal</option>
            <option value="CIVIL">Civil</option>
            <option value="ADMINISTRATIVO">Administrativo</option>
            <option value="LABORAL">Laboral</option>
            <option value="OTRO">Otro</option>
          </select>

          <select
            className="filter-select"
            value={filters.status}
            onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
          >
            <option value="">Todos los estados</option>
            <option value="NUEVO">Nuevo</option>
            <option value="EN_PROCESO">En proceso</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="CERRADO">Cerrado</option>
            <option value="ARCHIVADO">Archivado</option>
          </select>
        </div>

        {loading ? (
          <div className="loading">Cargando casos...</div>
        ) : cases.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◈</div>
            <div className="empty-state-text">Sin casos</div>
            <div className="empty-state-sub">
              {Object.values(filters).some(Boolean)
                ? 'Ajusta los filtros para encontrar casos'
                : 'Crea el primer caso con el botón "Nuevo caso"'}
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>N° Caso</th>
                  <th>Cliente</th>
                  <th>Título</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Honorarios</th>
                  <th>Creado</th>
                </tr>
              </thead>
              <tbody>
                {cases.map(c => (
                  <tr
                    key={c.id}
                    className={`sc-draggable${draggingId === c.id ? ' sc-draggable--dragging' : ''}${activeCases.has(c.id) ? ' row--live' : ''}`}
                    draggable
                    onDragStart={e => handleDragStart(e, c)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => navigate(`/cases/${c.id}`)}
                  >
                    <td>
                      {activeCases.has(c.id) && (
                        <span className="live-dot" title="Phi está actuando aquí" aria-hidden="true" />
                      )}
                      <span className="case-number">{c.case_number}</span>
                    </td>
                    <td style={{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.client_name}
                    </td>
                    <td style={{ maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.title}
                    </td>
                    <td><span className={`badge badge-${c.service_type.toLowerCase()}`}>{c.service_type}</span></td>
                    <td>
                      <span className={`badge badge-${c.status.toLowerCase().replace('_', '-')}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </td>
                    <td>
                      <div>{formatCOP(c.fee)}</div>
                      <div className={c.fee_paid ? 'fee-paid' : 'fee-unpaid'} style={{ fontSize: '0.7rem' }}>
                        {c.fee_paid ? '✓ cobrado' : '· pendiente'}
                      </div>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(c.created_at).toLocaleDateString('es-CO')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <CaseForm
          onClose={() => setShowForm(false)}
          onSuccess={handleCaseCreated}
        />
      )}
    </>
  );
}
