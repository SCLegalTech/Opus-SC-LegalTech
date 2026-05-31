import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const PRIORITY_ORDER = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };
const PRIORITY_LABEL = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };
const PRIORITY_COLOR = { CRITICA: '#E87A7A', ALTA: '#D4B84A', MEDIA: '#4A9ED4', BAJA: '#8f8f8f' };
const COLUMN_BASE_STATUS = [
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'EN_CURSO', label: 'En curso' },
  { value: 'COMPLETADA', label: 'Completada' },
  { value: 'CANCELADA', label: 'Cancelada' },
];

const safeArray = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }
  return [];
};

const normalizeChecklist = (value) =>
  safeArray(value)
    .map((item, index) => {
      if (typeof item === 'string') return { id: `legacy_${index}`, text: item, done: false };
      if (item && typeof item === 'object') {
        const text = String(item.text || item.label || '').trim();
        if (!text) return null;
        return { id: item.id || `item_${index}`, text, done: Boolean(item.done) };
      }
      return null;
    })
    .filter(Boolean);

const parseMetadata = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return {};
  }
};

function TaskCard({ task, linksCount, checklistDone, checklistTotal, onClick, onDragStart, onDragEnd, isDragging }) {
  return (
    <article
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(task)}
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-3)',
        cursor: isDragging ? 'grabbing' : 'grab',
        opacity: isDragging ? 0.65 : 1,
        transition: 'opacity 120ms ease',
        marginBottom: 'var(--sp-2)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
        <div style={{ fontSize: '0.86rem', fontWeight: 600, lineHeight: 1.25 }}>{task.title}</div>
        <span style={{ fontSize: '0.64rem', fontWeight: 700, color: PRIORITY_COLOR[task.priority] || '#8f8f8f', textTransform: 'uppercase' }}>
          {PRIORITY_LABEL[task.priority] || task.priority}
        </span>
      </div>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
        {task.case_number && <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>{task.case_number}</span>}
        {task.due_date && <span style={{ fontSize: '0.67rem', color: 'var(--text-muted)' }}>Vence {new Date(task.due_date).toLocaleDateString('es-CO')}</span>}
        {task.blocked_reason && <span style={{ fontSize: '0.62rem', color: '#E87A7A' }}>Bloqueada</span>}
      </div>
      {task.context && (
        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {task.context}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '0.67rem', color: 'var(--text-muted)' }}>
        <span>Checklist {checklistDone}/{checklistTotal}</span>
        <span>{linksCount} vinculos</span>
      </div>
    </article>
  );
}

export default function Tasks() {
  const navigate = useNavigate();
  const [columns, setColumns] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    title: '',
    description: '',
    context: '',
    priority: 'MEDIA',
    column_id: '',
    due_date: '',
    blocked_reason: '',
    estimated_minutes: '',
  });
  const [newColumnDraft, setNewColumnDraft] = useState({ title: '', base_status: 'PENDIENTE' });
  const [selectedTask, setSelectedTask] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [taskLinks, setTaskLinks] = useState([]);
  const [taskSources, setTaskSources] = useState({ drive_files: [], emails: [] });
  const [linksLoading, setLinksLoading] = useState(false);
  const [selectedDriveLinkId, setSelectedDriveLinkId] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState('');

  const loadBoard = useCallback(async () => {
    setLoading(true);
    try {
      const [columnsRes, tasksRes] = await Promise.all([api.get('/tareas/columns'), api.get('/tareas?limit=500')]);
      const nextColumns = Array.isArray(columnsRes.data) ? columnsRes.data : [];
      setColumns(nextColumns);
      setTasks(Array.isArray(tasksRes.data) ? tasksRes.data : []);
      if (!createDraft.column_id && nextColumns.length > 0) {
        setCreateDraft((prev) => ({ ...prev, column_id: String(nextColumns[0].id) }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [createDraft.column_id]);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  useEffect(() => {
    if (!selectedTask) {
      setEditDraft(null);
      setTaskLinks([]);
      setTaskSources({ drive_files: [], emails: [] });
      return;
    }
    const matchedColumnId = selectedTask.board_column_id || columns.find((col) => col.base_status === selectedTask.status)?.id || '';
    setEditDraft({
      ...selectedTask,
      checklistItems: normalizeChecklist(selectedTask.checklist),
      due_date: selectedTask.due_date ? String(selectedTask.due_date).slice(0, 10) : '',
      board_column_id: String(matchedColumnId),
      estimated_minutes: selectedTask.estimated_minutes || '',
    });

    (async () => {
      setLinksLoading(true);
      try {
        const [linksRes, sourcesRes] = await Promise.all([
          api.get(`/tareas/${selectedTask.id}/links`),
          api.get(`/tareas/${selectedTask.id}/link-sources`),
        ]);
        setTaskLinks(Array.isArray(linksRes.data) ? linksRes.data : []);
        setTaskSources({
          drive_files: Array.isArray(sourcesRes.data?.drive_files) ? sourcesRes.data.drive_files : [],
          emails: Array.isArray(sourcesRes.data?.emails) ? sourcesRes.data.emails : [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setLinksLoading(false);
      }
    })();
  }, [selectedTask, columns]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = q
      ? tasks.filter((task) =>
          [task.title, task.description, task.context, task.case_title, task.case_number, task.assigned_to_name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(q)
        )
      : tasks;

    return source.slice().sort((a, b) => {
      if (a.board_column_id === b.board_column_id) {
        const ap = PRIORITY_ORDER[a.priority] ?? 9;
        const bp = PRIORITY_ORDER[b.priority] ?? 9;
        if (ap !== bp) return ap - bp;
      }
      return (a.position ?? 0) - (b.position ?? 0);
    });
  }, [tasks, search]);

  const grouped = useMemo(() => {
    const acc = Object.fromEntries(columns.map((col) => [col.id, []]));
    const existingColumnIds = new Set(columns.map((col) => col.id));
    const fallbackByStatus = (status) => columns.find((col) => col.base_status === status)?.id || columns[0]?.id;

    for (const task of filteredTasks) {
      const ownColumnId = existingColumnIds.has(task.board_column_id) ? task.board_column_id : null;
      const key = ownColumnId || fallbackByStatus(task.status);
      if (!key) continue;
      if (!acc[key]) acc[key] = [];
      acc[key].push(task);
    }
    return acc;
  }, [columns, filteredTasks]);

  const checklistStats = (task) => {
    const directTotal = Number(task.checklist_total || 0);
    const directDone = Number(task.checklist_done || 0);
    if (directTotal > 0 || directDone > 0) return { total: directTotal, done: directDone };
    const list = normalizeChecklist(task.checklist);
    return { total: list.length, done: list.filter((item) => item.done).length };
  };

  const onDragStart = (event, task) => {
    event.dataTransfer.setData('text/plain', String(task.id));
    event.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(task.id);
  };

  const onDragEnd = () => {
    setDraggingTaskId(null);
  };

  const onDropToColumn = async (event, column) => {
    event.preventDefault();
    const taskId = Number(event.dataTransfer.getData('text/plain'));
    if (!taskId || !column?.id) return;
    const targetPosition = (grouped[column.id] || []).length;

    setTasks((prev) =>
      prev.map((task) =>
        task.id === taskId ? { ...task, board_column_id: column.id, status: column.base_status, position: targetPosition } : task
      )
    );

    try {
      const res = await api.put(`/tareas/${taskId}`, { board_column_id: column.id, position: targetPosition });
      setTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...res.data } : task)));
    } catch (err) {
      console.error(err);
      await loadBoard();
    } finally {
      setDraggingTaskId(null);
    }
  };

  const addColumn = async (event) => {
    event.preventDefault();
    if (!newColumnDraft.title.trim()) return;
    setSaving(true);
    try {
      await api.post('/tareas/columns', {
        title: newColumnDraft.title.trim(),
        base_status: newColumnDraft.base_status,
        position: columns.length,
      });
      setNewColumnDraft({ title: '', base_status: 'PENDIENTE' });
      await loadBoard();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'No se pudo crear la columna.');
    } finally {
      setSaving(false);
    }
  };

  const removeColumn = async (columnId) => {
    if (!confirm('Eliminar esta columna? Las tarjetas se reasignaran automaticamente.')) return;
    setSaving(true);
    try {
      await api.delete(`/tareas/columns/${columnId}`);
      await loadBoard();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const createTask = async (event) => {
    event.preventDefault();
    if (!createDraft.title.trim() || !createDraft.column_id) return;
    setSaving(true);
    try {
      const colId = Number(createDraft.column_id);
      await api.post('/tareas', {
        title: createDraft.title.trim(),
        description: createDraft.description || null,
        context: createDraft.context || null,
        priority: createDraft.priority,
        due_date: createDraft.due_date || null,
        blocked_reason: createDraft.blocked_reason || null,
        estimated_minutes: createDraft.estimated_minutes ? Number(createDraft.estimated_minutes) : null,
        board_column_id: colId,
        position: (grouped[colId] || []).length,
        checklist: [],
      });
      setCreateDraft((prev) => ({ ...prev, title: '', description: '', context: '', due_date: '', blocked_reason: '', estimated_minutes: '' }));
      setShowCreate(false);
      await loadBoard();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!editDraft?.id) return;
    setSaving(true);
    try {
      await api.put(`/tareas/${editDraft.id}`, {
        title: editDraft.title,
        description: editDraft.description || null,
        context: editDraft.context || null,
        priority: editDraft.priority,
        due_date: editDraft.due_date || null,
        board_column_id: Number(editDraft.board_column_id || 0) || null,
        blocked_reason: editDraft.blocked_reason || null,
        estimated_minutes: editDraft.estimated_minutes ? Number(editDraft.estimated_minutes) : null,
        checklist: (editDraft.checklistItems || []).map((item, index) => ({ id: item.id || `item_${index}`, text: item.text, done: Boolean(item.done) })),
      });
      await loadBoard();
      setSelectedTask((prev) => (prev ? { ...prev, ...editDraft } : prev));
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const deleteTask = async (taskId) => {
    if (!confirm('Eliminar esta tarjeta?')) return;
    setSaving(true);
    try {
      await api.delete(`/tareas/${taskId}`);
      setSelectedTask(null);
      await loadBoard();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const addChecklistItem = () => {
    const text = prompt('Nuevo item de checklist:');
    if (!text || !text.trim()) return;
    setEditDraft((prev) => ({ ...prev, checklistItems: [...(prev.checklistItems || []), { id: `item_${Date.now()}`, text: text.trim(), done: false }] }));
  };

  const toggleChecklistItem = (itemId) => {
    setEditDraft((prev) => ({
      ...prev,
      checklistItems: (prev.checklistItems || []).map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)),
    }));
  };

  const removeChecklistItem = (itemId) => {
    setEditDraft((prev) => ({ ...prev, checklistItems: (prev.checklistItems || []).filter((item) => item.id !== itemId) }));
  };

  const refreshTaskLinks = async () => {
    if (!selectedTask?.id) return;
    const [linksRes, sourcesRes] = await Promise.all([api.get(`/tareas/${selectedTask.id}/links`), api.get(`/tareas/${selectedTask.id}/link-sources`)]);
    setTaskLinks(Array.isArray(linksRes.data) ? linksRes.data : []);
    setTaskSources({
      drive_files: Array.isArray(sourcesRes.data?.drive_files) ? sourcesRes.data.drive_files : [],
      emails: Array.isArray(sourcesRes.data?.emails) ? sourcesRes.data.emails : [],
    });
  };

  const attachDrive = async (role) => {
    if (!selectedTask?.id || !selectedDriveLinkId) return;
    setSaving(true);
    try {
      await api.post(`/tareas/${selectedTask.id}/links/drive`, { drive_link_id: Number(selectedDriveLinkId), role });
      await refreshTaskLinks();
      await loadBoard();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'No fue posible vincular el archivo de Drive.');
    } finally {
      setSaving(false);
    }
  };

  const attachEmail = async () => {
    if (!selectedTask?.id || !selectedEmailId) return;
    setSaving(true);
    try {
      await api.post(`/tareas/${selectedTask.id}/links/email`, { communication_id: Number(selectedEmailId), role: 'evidence' });
      await refreshTaskLinks();
      await loadBoard();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || 'No fue posible vincular el correo.');
    } finally {
      setSaving(false);
    }
  };

  const removeLink = async (linkId) => {
    if (!selectedTask?.id) return;
    setSaving(true);
    try {
      await api.delete(`/tareas/${selectedTask.id}/links/${linkId}`);
      await refreshTaskLinks();
      await loadBoard();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const groupedLinks = useMemo(
    () => ({
      inputs: taskLinks.filter((link) => link.role === 'input'),
      attachments: taskLinks.filter((link) => link.role === 'attachment'),
      evidence: taskLinks.filter((link) => link.role === 'evidence'),
    }),
    [taskLinks]
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Escritorio - Tablero operativo</div>
          <div className="page-subtitle">Gestiona tareas del despacho como tarjetas accionables</div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
          <button className="btn btn-ghost" onClick={() => navigate('/cases')}>Ver casos</button>
          <button className="btn btn-primary" onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'Cerrar' : '+ Tarjeta'}</button>
        </div>
      </div>

      <div className="page-body">
        <div className="toolbar" style={{ marginBottom: 'var(--sp-3)', gap: 'var(--sp-2)', alignItems: 'stretch' }}>
          <div className="search-wrap" style={{ maxWidth: '360px' }}>
            <span className="search-icon">*</span>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por tarea, caso o contexto" />
          </div>

          <form onSubmit={addColumn} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input value={newColumnDraft.title} onChange={(event) => setNewColumnDraft((prev) => ({ ...prev, title: event.target.value }))} placeholder="Nueva columna" style={{ minWidth: '180px' }} />
            <select value={newColumnDraft.base_status} onChange={(event) => setNewColumnDraft((prev) => ({ ...prev, base_status: event.target.value }))}>
              {COLUMN_BASE_STATUS.map((status) => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>
            <button className="btn btn-secondary" type="submit" disabled={saving}>+ Columna</button>
          </form>
        </div>

        {showCreate && (
          <form className="card" onSubmit={createTask} style={{ marginBottom: 'var(--sp-4)', padding: 'var(--sp-4)' }}>
            <div className="form-grid">
              <div className="form-group full">
                <label className="form-label">Titulo *</label>
                <input value={createDraft.title} onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Columna</label>
                <select value={createDraft.column_id} onChange={(event) => setCreateDraft((prev) => ({ ...prev, column_id: event.target.value }))}>
                  {columns.map((column) => (
                    <option key={column.id} value={column.id}>{column.title}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Prioridad</label>
                <select value={createDraft.priority} onChange={(event) => setCreateDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                  {Object.keys(PRIORITY_LABEL).map((priority) => (
                    <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Fecha limite</label>
                <input type="date" value={createDraft.due_date} onChange={(event) => setCreateDraft((prev) => ({ ...prev, due_date: event.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Tiempo estimado (min)</label>
                <input type="number" min="0" value={createDraft.estimated_minutes} onChange={(event) => setCreateDraft((prev) => ({ ...prev, estimated_minutes: event.target.value }))} />
              </div>
              <div className="form-group full">
                <label className="form-label">Contexto juridico</label>
                <textarea rows={2} value={createDraft.context} onChange={(event) => setCreateDraft((prev) => ({ ...prev, context: event.target.value }))} />
              </div>
              <div className="form-group full">
                <label className="form-label">Descripcion</label>
                <textarea rows={2} value={createDraft.description} onChange={(event) => setCreateDraft((prev) => ({ ...prev, description: event.target.value }))} />
              </div>
              <div className="form-group full">
                <label className="form-label">Bloqueo (si aplica)</label>
                <textarea rows={2} value={createDraft.blocked_reason} onChange={(event) => setCreateDraft((prev) => ({ ...prev, blocked_reason: event.target.value }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
              <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Guardando...' : 'Crear tarjeta'}</button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="loading">Cargando tablero...</div>
        ) : (
          <div className="tasks-board-grid" style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr))` }}>
            {columns.map((column) => (
              <section
                key={column.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => onDropToColumn(event, column)}
                style={{ border: '1px solid var(--border)', background: 'var(--bg-1)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)', minHeight: '420px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: 'var(--sp-2)' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{column.title} ({grouped[column.id]?.length || 0})</div>
                  <button className="btn btn-ghost btn-sm" onClick={() => removeColumn(column.id)} style={{ padding: '0 6px', color: '#E87A7A' }}>X</button>
                </div>

                {(grouped[column.id] || []).map((task) => {
                  const stats = checklistStats(task);
                  return (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onClick={setSelectedTask}
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
                      isDragging={draggingTaskId === task.id}
                      linksCount={Number(task.links_count || 0)}
                      checklistDone={stats.done}
                      checklistTotal={stats.total}
                    />
                  );
                })}

                {(grouped[column.id] || []).length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', opacity: draggingTaskId ? 0.7 : 1 }}>Suelta aqui una tarjeta</div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>

      {selectedTask && editDraft && (
        <div className="modal-overlay" onClick={() => setSelectedTask(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'grid', placeItems: 'center', zIndex: 40 }}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()} style={{ width: 'min(980px, 96vw)', maxHeight: '90vh', overflow: 'auto', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--sp-4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-3)' }}>
              <div>
                <div className="page-title" style={{ fontSize: '1.2rem' }}>Tarjeta #{editDraft.id}</div>
                {editDraft.case_number && <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/cases/${editDraft.case_id}`)} style={{ padding: 0 }}>{editDraft.case_number} - {editDraft.case_title}</button>}
              </div>
              <button className="btn btn-ghost" onClick={() => setSelectedTask(null)}>Cerrar</button>
            </div>

            <div className="form-grid">
              <div className="form-group full"><label className="form-label">Titulo</label><input value={editDraft.title || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, title: event.target.value }))} /></div>
              <div className="form-group">
                <label className="form-label">Columna</label>
                <select value={editDraft.board_column_id || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, board_column_id: event.target.value }))}>
                  {columns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Prioridad</label>
                <select value={editDraft.priority || 'MEDIA'} onChange={(event) => setEditDraft((prev) => ({ ...prev, priority: event.target.value }))}>
                  {Object.keys(PRIORITY_LABEL).map((priority) => <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Fecha limite</label><input type="date" value={editDraft.due_date || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, due_date: event.target.value }))} /></div>
              <div className="form-group"><label className="form-label">Tiempo estimado (min)</label><input type="number" min="0" value={editDraft.estimated_minutes || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, estimated_minutes: event.target.value }))} /></div>
              <div className="form-group full"><label className="form-label">Contexto juridico</label><textarea rows={2} value={editDraft.context || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, context: event.target.value }))} /></div>
              <div className="form-group full"><label className="form-label">Descripcion</label><textarea rows={2} value={editDraft.description || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, description: event.target.value }))} /></div>
              <div className="form-group full"><label className="form-label">Bloqueo</label><textarea rows={2} value={editDraft.blocked_reason || ''} onChange={(event) => setEditDraft((prev) => ({ ...prev, blocked_reason: event.target.value }))} /></div>

              <div className="form-group full task-checklist-editor">
                <div className="task-checklist-header">
                  <label className="form-label">Checklist</label>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={addChecklistItem}>+ Item</button>
                </div>
                {(editDraft.checklistItems || []).length === 0 ? (
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Sin items de checklist.</div>
                ) : (
                  <div className="task-checklist-list">
                    {(editDraft.checklistItems || []).map((item) => (
                      <div key={item.id} className={`task-checklist-row ${item.done ? 'task-checklist-row-done' : ''}`}>
                        <input type="checkbox" checked={Boolean(item.done)} onChange={() => toggleChecklistItem(item.id)} />
                        <span className="task-checklist-text">{item.text}</span>
                        <button className="task-checklist-remove" type="button" onClick={() => removeChecklistItem(item.id)} title="Quitar">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group full" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                <label className="form-label">Insumos y adjuntos (Drive)</label>
                {linksLoading ? (
                  <div className="loading">Cargando fuentes...</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <select value={selectedDriveLinkId} onChange={(event) => setSelectedDriveLinkId(event.target.value)} style={{ minWidth: '280px' }}>
                        <option value="">Selecciona archivo de Drive del caso</option>
                        {taskSources.drive_files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                      </select>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => attachDrive('input')} disabled={!selectedDriveLinkId || saving}>Agregar como insumo</button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => attachDrive('attachment')} disabled={!selectedDriveLinkId || saving}>Agregar como adjunto</button>
                    </div>

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Insumos</div>
                    {groupedLinks.inputs.map((link) => (
                      <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <a href={link.drive_web_view_link || parseMetadata(link.metadata).web_view_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>{link.drive_name || link.label}</a>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeLink(link.id)} style={{ color: '#E87A7A' }}>Quitar</button>
                      </div>
                    ))}

                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '4px' }}>Adjuntos</div>
                    {groupedLinks.attachments.map((link) => (
                      <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <a href={link.drive_web_view_link || parseMetadata(link.metadata).web_view_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>{link.drive_name || link.label}</a>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeLink(link.id)} style={{ color: '#E87A7A' }}>Quitar</button>
                      </div>
                    ))}
                  </>
                )}
              </div>

              <div className="form-group full" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                <label className="form-label">Correos vinculados</label>
                {linksLoading ? (
                  <div className="loading">Cargando correos...</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                      <select value={selectedEmailId} onChange={(event) => setSelectedEmailId(event.target.value)} style={{ minWidth: '320px' }}>
                        <option value="">Selecciona correo del expediente</option>
                        {taskSources.emails.map((email) => {
                          const metadata = parseMetadata(email.metadata);
                          const subject = metadata.subject || String(email.content || '').split('\n')[0] || `Correo #${email.id}`;
                          return <option key={email.id} value={email.id}>{subject}</option>;
                        })}
                      </select>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={attachEmail} disabled={!selectedEmailId || saving}>Vincular correo</button>
                    </div>

                    {groupedLinks.evidence.map((link) => (
                      <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                        <span style={{ fontSize: '0.78rem' }}>{link.label}</span>
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeLink(link.id)} style={{ color: '#E87A7A' }}>Quitar</button>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-4)' }}>
              <button className="btn btn-danger" onClick={() => deleteTask(editDraft.id)} disabled={saving}>Eliminar</button>
              <button className="btn btn-primary" onClick={saveEdit} disabled={saving}>{saving ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}


