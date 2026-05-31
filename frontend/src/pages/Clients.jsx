import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import ClientForm from '../components/Clients/ClientForm';

export default function Clients() {
  const [clients, setClients] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editClient, setEditClient] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const editClientId = searchParams.get('edit');

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const params = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await api.get(`/clients${params}`);
      setClients(res.data.clients);
      setTotal(res.data.total);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { loadClients(); }, [loadClients]);

  useEffect(() => {
    if (!editClientId) return undefined;

    let cancelled = false;
    api.get(`/clients/${editClientId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setEditClient(data);
        setShowForm(true);
      })
      .catch(err => {
        console.error(err);
        if (cancelled) return;
        const next = new URLSearchParams(searchParams);
        next.delete('edit');
        setSearchParams(next, { replace: true });
      });

    return () => { cancelled = true; };
  }, [editClientId, searchParams, setSearchParams]);

  const closeClientForm = useCallback(() => {
    setShowForm(false);
    setEditClient(null);

    if (searchParams.has('edit')) {
      const next = new URLSearchParams(searchParams);
      next.delete('edit');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSaved = () => {
    closeClientForm();
    loadClients();
  };

  const handleEdit = (e, client) => {
    e.stopPropagation();
    setEditClient(client);
    setShowForm(true);
  };

  const handleDelete = async (e, client) => {
    e.stopPropagation();
    if (!confirm(`¿Eliminar a ${client.full_name}? Esta acción no se puede deshacer.`)) return;
    try {
      await api.delete(`/clients/${client.id}`);
      loadClients();
    } catch (err) {
      alert(err.response?.data?.error || 'Error eliminando cliente');
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Clientes</div>
          <div className="page-subtitle">{total} cliente{total !== 1 ? 's' : ''} registrado{total !== 1 ? 's' : ''}</div>
        </div>
        <button className="btn btn-primary" onClick={() => { closeClientForm(); setShowForm(true); }}>
          + Nuevo cliente
        </button>
      </div>

      <div className="page-body">
        <div className="toolbar">
          <div className="search-wrap">
            <span className="search-icon">⌕</span>
            <input
              type="text"
              placeholder="Buscar por nombre, documento o email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <div className="loading">Cargando clientes...</div>
        ) : clients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◉</div>
            <div className="empty-state-text">Sin clientes registrados</div>
            <div className="empty-state-sub">
              {search ? 'Ajusta la búsqueda' : 'Crea el primer cliente con el botón "Nuevo cliente"'}
            </div>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Documento</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Ciudad</th>
                  <th>Casos</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {clients.map(cl => (
                  <tr key={cl.id}>
                    <td style={{ fontWeight: 600 }}>{cl.full_name}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {cl.document_type} {cl.document_number}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {cl.email || '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {cl.phone || '—'}
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {cl.city || '—'}
                    </td>
                    <td>
                      <span style={{ color: 'var(--gold)', fontSize: '0.85rem' }}>
                        {cl.active_cases} activo{cl.active_cases !== 1 ? 's' : ''}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                        {' '}/ {cl.total_cases} total
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate('/cases')}
                          title="Ver casos"
                        >
                          ◈ Casos
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={e => handleEdit(e, cl)}
                          title="Editar cliente"
                        >
                          ✎
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={e => handleDelete(e, cl)}
                          title="Eliminar cliente"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showForm && (
        <ClientForm
          client={editClient}
          onClose={closeClientForm}
          onSuccess={handleSaved}
        />
      )}
    </>
  );
}
