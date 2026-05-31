import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../services/api';

// ── Constantes ────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'operacion',    label: 'Operacion' },
  { id: 'members',      label: 'Clientes' },
  { id: 'actuaciones',  label: 'Actuaciones' },
  { id: 'tareas',       label: 'Tareas' },
  { id: 'vencimientos', label: 'Vencimientos' },
];

const DOCUMENT_GATES = [
  { id: 'poder', label: 'Poder', shortLabel: 'Poder', doneStates: ['ok'] },
  { id: 'contrato', label: 'Contrato', shortLabel: 'Contrato', doneStates: ['ok'] },
  { id: 'evidencia_dano', label: 'Evidencia', shortLabel: 'Evid.', doneStates: ['ok'] },
  { id: 'honorarios', label: 'Honorarios', shortLabel: 'Pago', doneStates: ['pago_reportado', 'ok'] },
];

const LANE_LABELS = {
  cuantia_alta_contacto_y_cierre: 'Cuantia alta',
  cuantia_media_completar: 'Cuantia media',
  cuantia_baja_lote_documental: 'Cuantia baja',
};

const STATUS_OPTIONS = ['ACTIVO','EN_ESPERA','CERRADO','ARCHIVADO'];

const PRIORITY_COLORS = {
  CRITICA: '#e74c3c',
  ALTA:    '#e67e22',
  MEDIA:   '#f1c40f',
  BAJA:    '#27ae60',
};

const URGENCY_COLORS = {
  CRITICO: '#e74c3c',
  ALTO:    '#e67e22',
  MEDIO:   '#f1c40f',
  BAJO:    '#27ae60',
};

const ACT_TYPE_LABELS = {
  AUDIENCIA:   'Audiencia',
  RADICACION:  'Radicación',
  NOTIFICACION:'Notificación',
  CONTESTACION:'Contestación',
  SENTENCIA:   'Sentencia',
  APELACION:   'Apelación',
  SEGUIMIENTO: 'Seguimiento',
  OTRO:        'Otro',
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
}

function daysUntil(d) {
  if (!d) return null;
  const days = Math.ceil((new Date(d) - new Date()) / 86400000);
  return days;
}

function safeMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return {};
  }
}

function gateState(member, gateId) {
  return safeMetadata(member.metadata)?.rb_operacion?.puertas_documentales?.[gateId]?.estado || 'sin_dato';
}

function gateComplete(member, gate) {
  return gate.doneStates.includes(gateState(member, gate.id));
}

function percent(done, total) {
  if (!total) return 0;
  return Math.round((done / total) * 100);
}

// ── Componente Principal ──────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [project, setProject]         = useState(null);
  const [tab, setTab]                 = useState('operacion');
  const [members, setMembers]         = useState([]);
  const [actuaciones, setActuaciones] = useState([]);
  const [tareas, setTareas]           = useState([]);
  const [vencimientos, setVencimientos] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);

  // Formularios
  const [showActForm, setShowActForm]   = useState(false);
  const [showTareaForm, setShowTareaForm] = useState(false);
  const [showVencForm, setShowVencForm] = useState(false);
  const [showLinkCase, setShowLinkCase] = useState(false);

  const [actForm, setActForm] = useState({ type: 'SEGUIMIENTO', title: '', description: '', scheduled_at: '', radicado: '' });
  const [tareaForm, setTareaForm] = useState({ title: '', priority: 'MEDIA', due_date: '', description: '' });
  const [vencForm, setVencForm] = useState({ title: '', due_date: '' });
  const [caseSearch, setCaseSearch] = useState('');
  const [caseResults, setCaseResults] = useState([]);

  // Edición inline del proyecto
  const [editingNextAction, setEditingNextAction] = useState(false);
  const [nextActionDraft, setNextActionDraft] = useState('');

  const loadProject  = useCallback(() => api.get(`/macrocasos/${id}`), [id]);
  const loadMembers  = useCallback(() => api.get(`/macrocasos/${id}/members`), [id]);
  const loadActuaciones = useCallback(() => api.get(`/macrocasos/${id}/actuaciones`), [id]);
  const loadTareas   = useCallback(() => api.get(`/macrocasos/${id}/tareas`), [id]);
  const loadVenc     = useCallback(() => api.get(`/macrocasos/${id}/vencimientos`), [id]);

  useEffect(() => {
    const init = async () => {
      try {
        setLoading(true);
        const [pRes, mRes, aRes, tRes, vRes] = await Promise.all([
          loadProject(), loadMembers(), loadActuaciones(), loadTareas(), loadVenc()
        ]);
        setProject(pRes.data);
        setMembers(mRes.data);
        setActuaciones(aRes.data);
        setTareas(tRes.data);
        setVencimientos(vRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [id]);

  const reloadTab = async () => {
    if (tab === 'members')      { const r = await loadMembers();   setMembers(r.data); }
    if (tab === 'actuaciones')  { const r = await loadActuaciones(); setActuaciones(r.data); }
    if (tab === 'tareas')       { const r = await loadTareas();    setTareas(r.data); }
    if (tab === 'vencimientos') { const r = await loadVenc();      setVencimientos(r.data); }
  };

  // ── Proyecto: estado y next_action ─────────────────────────────────────────
  const changeStatus = async (newStatus) => {
    try {
      await api.patch(`/macrocasos/${id}`, { status: newStatus });
      setProject(p => ({ ...p, status: newStatus }));
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const saveNextAction = async () => {
    setSaving(true);
    try {
      await api.patch(`/macrocasos/${id}`, { next_action: nextActionDraft });
      setProject(p => ({ ...p, next_action: nextActionDraft }));
      setEditingNextAction(false);
    } catch (err) { alert(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  // ── Actuaciones ────────────────────────────────────────────────────────────
  const submitAct = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/macrocasos/${id}/actuaciones`, actForm);
      setShowActForm(false);
      setActForm({ type: 'SEGUIMIENTO', title: '', description: '', scheduled_at: '', radicado: '' });
      const r = await loadActuaciones(); setActuaciones(r.data);
      const rv = await loadVenc(); setVencimientos(rv.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const completeAct = async (actId) => {
    const result = prompt('Resultado de la actuación (opcional):');
    if (result === null) return;
    try {
      await api.patch(`/macrocasos/${id}/actuaciones/${actId}/complete`, { result });
      const r = await loadActuaciones(); setActuaciones(r.data);
      const rv = await loadVenc(); setVencimientos(rv.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Tareas ─────────────────────────────────────────────────────────────────
  const submitTarea = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/macrocasos/${id}/tareas`, tareaForm);
      setShowTareaForm(false);
      setTareaForm({ title: '', priority: 'MEDIA', due_date: '', description: '' });
      const r = await loadTareas(); setTareas(r.data);
      const rv = await loadVenc(); setVencimientos(rv.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const completeTarea = async (tareaId) => {
    try {
      await api.patch(`/macrocasos/${id}/tareas/${tareaId}`, { status: 'COMPLETADA' });
      const r = await loadTareas(); setTareas(r.data);
      const rv = await loadVenc(); setVencimientos(rv.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Vencimientos ───────────────────────────────────────────────────────────
  const submitVenc = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/macrocasos/${id}/vencimientos`, vencForm);
      setShowVencForm(false);
      setVencForm({ title: '', due_date: '' });
      const r = await loadVenc(); setVencimientos(r.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const resolveVenc = async (vencId) => {
    try {
      await api.patch(`/macrocasos/${id}/vencimientos/${vencId}/resolve`);
      const r = await loadVenc(); setVencimientos(r.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  // ── Vincular caso ──────────────────────────────────────────────────────────
  const searchCases = async (q) => {
    setCaseSearch(q);
    if (q.length < 2) { setCaseResults([]); return; }
    try {
      const { data } = await api.get(`/cases?search=${encodeURIComponent(q)}&limit=8`);
      setCaseResults(data.cases || data);
    } catch (_) {}
  };

  const linkCase = async (caseId) => {
    try {
      await api.post(`/macrocasos/${id}/members`, { case_id: caseId });
      setShowLinkCase(false); setCaseSearch(''); setCaseResults([]);
      const r = await loadMembers(); setMembers(r.data);
      const rp = await loadProject(); setProject(rp.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const unlinkCase = async (caseId) => {
    if (!confirm('¿Desvincular este caso del proyecto?')) return;
    try {
      await api.delete(`/macrocasos/${id}/members/${caseId}`);
      const r = await loadMembers(); setMembers(r.data);
      const rp = await loadProject(); setProject(rp.data);
    } catch (err) { alert(err.response?.data?.error || err.message); }
  };

  const updateDocumentGate = async (caseId, gate, complete) => {
    setMembers(prev => prev.map(member => {
      if (member.id !== caseId) return member;
      const metadata = safeMetadata(member.metadata);
      const nextState = gate.id === 'honorarios'
        ? (complete ? 'pago_reportado' : 'requiere_conciliacion')
        : (complete ? 'ok' : {
            poder: 'requiere_actualizacion',
            contrato: 'requiere_firma_o_cierre',
            evidencia_dano: 'requiere_soportes',
          }[gate.id] || 'pendiente');

      return {
        ...member,
        metadata: {
          ...metadata,
          rb_operacion: {
            ...(metadata.rb_operacion || {}),
            puertas_documentales: {
              ...(metadata.rb_operacion?.puertas_documentales || {}),
              [gate.id]: {
                ...(metadata.rb_operacion?.puertas_documentales?.[gate.id] || {}),
                estado: nextState,
              },
            },
          },
        },
      };
    }));

    try {
      const { data } = await api.patch(`/macrocasos/${id}/members/${caseId}/document-gate`, {
        gate: gate.id,
        complete,
      });
      setMembers(prev => prev.map(member => (
        member.id === caseId ? { ...member, metadata: data.metadata } : member
      )));
    } catch (err) {
      alert(err.response?.data?.error || err.message);
      const r = await loadMembers();
      setMembers(r.data);
    }
  };

  const operationStats = useMemo(() => {
    const total = members.length;
    const gates = DOCUMENT_GATES.map(gate => {
      const done = members.filter(member => gateComplete(member, gate)).length;
      return { ...gate, done, total, pct: percent(done, total) };
    });
    const doneTotal = gates.reduce((acc, gate) => acc + gate.done, 0);
    const itemTotal = total * DOCUMENT_GATES.length;
    const lanes = members.reduce((acc, member) => {
      const lane = safeMetadata(member.metadata)?.rb_operacion?.priorizacion_semanal?.lane || 'sin_prioridad';
      acc[lane] = (acc[lane] || 0) + 1;
      return acc;
    }, {});
    return { gates, overall: percent(doneTotal, itemTotal), lanes };
  }, [members]);

  if (loading) return <div className="loading-msg">Cargando proyecto…</div>;
  if (!project) return <div className="loading-msg">Proyecto no encontrado.</div>;

  const pendingTareas = tareas.filter(t => !['COMPLETADA','CANCELADA'].includes(t.status)).length;
  const pendingVenc   = vencimientos.filter(v => !v.resolved && new Date(v.due_date) <= new Date(Date.now() + 7*86400000)).length;
  const overdueVenc   = vencimientos.filter(v => !v.resolved && new Date(v.due_date) < new Date()).length;

  return (
    <div className="project-detail">
      {/* ── Header ── */}
      <div className="project-detail-header">
        <div className="project-detail-breadcrumb">
          <Link to="/projects" className="breadcrumb-link">Proyectos</Link>
          <span className="breadcrumb-sep"> / </span>
          <span className="breadcrumb-current">{project.code}</span>
        </div>

        <div className="project-detail-title-row">
          <div>
            <span className={`badge-service ${project.service_type?.toLowerCase()}`}>
              {project.service_type}
            </span>
            <h1 className="project-detail-title">{project.title}</h1>
            {project.entity && (
              <p className="project-detail-entity">vs. {project.entity}</p>
            )}
          </div>
          <div className="project-detail-actions">
            <select
              className="status-select"
              value={project.status}
              onChange={e => changeStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Stats rápidas */}
        <div className="project-detail-stats">
          <div className="proj-stat">
            <strong>{members.length}</strong>
            <span>Clientes</span>
          </div>
          <div className="proj-stat">
            <strong>{actuaciones.filter(a => !a.completed_at).length}</strong>
            <span>Act. pendientes</span>
          </div>
          <div className={`proj-stat ${pendingTareas > 0 ? 'proj-stat-warn' : ''}`}>
            <strong>{pendingTareas}</strong>
            <span>Tareas</span>
          </div>
          <div className={`proj-stat ${overdueVenc > 0 ? 'proj-stat-crit' : pendingVenc > 0 ? 'proj-stat-warn' : ''}`}>
            <strong>{overdueVenc > 0 ? overdueVenc : pendingVenc}</strong>
            <span>{overdueVenc > 0 ? 'Vencidos' : 'Venc. próximos'}</span>
          </div>
          {project.lead_lawyer_name && (
            <div className="proj-stat">
              <strong>{project.lead_lawyer_name}</strong>
              <span>Responsable</span>
            </div>
          )}
        </div>

        {/* Siguiente acción inline */}
        <div className="project-next-action">
          <span className="next-action-label">Próximo hito:</span>
          {editingNextAction ? (
            <span className="next-action-edit">
              <input
                autoFocus
                value={nextActionDraft}
                onChange={e => setNextActionDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveNextAction(); if (e.key === 'Escape') setEditingNextAction(false); }}
              />
              <button className="btn btn-secondary btn-sm" onClick={saveNextAction} disabled={saving}>✓</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingNextAction(false)}>✕</button>
            </span>
          ) : (
            <span
              className="next-action-value"
              onClick={() => { setNextActionDraft(project.next_action || ''); setEditingNextAction(true); }}
            >
              {project.next_action || <em>Sin próximo hito — clic para agregar</em>}
            </span>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="project-tabs">
        {TABS.map(t => {
          let badge = 0;
          if (t.id === 'operacion')    badge = operationStats.overall;
          if (t.id === 'members')      badge = members.length;
          if (t.id === 'actuaciones')  badge = actuaciones.filter(a => !a.completed_at).length;
          if (t.id === 'tareas')       badge = pendingTareas;
          if (t.id === 'vencimientos') badge = vencimientos.filter(v => !v.resolved).length;
          return (
            <button
              key={t.id}
              className={`project-tab ${tab === t.id ? 'project-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {badge > 0 && <span className="tab-badge">{t.id === 'operacion' ? `${badge}%` : badge}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'operacion' && (
        <div className="tab-content project-ops">
          <section className="project-ops-hero">
            <div>
              <span className="ops-kicker">SC LegalTech</span>
              <h2>Operacion documental del proyecto</h2>
              <p>Progreso global por cliente y por documento critico. Cada check actualiza el expediente y recalcula el tablero.</p>
            </div>
            <div className="ops-radial" style={{ '--pct': `${operationStats.overall}%` }}>
              <strong>{operationStats.overall}%</strong>
              <span>global</span>
            </div>
          </section>

          <section className="project-doc-progress">
            {operationStats.gates.map(gate => (
              <article key={gate.id} className="doc-progress-card">
                <div className="doc-progress-head">
                  <span>{gate.label}</span>
                  <strong>{gate.pct}%</strong>
                </div>
                <div className="doc-progress-track">
                  <span style={{ width: `${gate.pct}%` }} />
                </div>
                <p>{gate.done}/{gate.total} clientes cumplidos</p>
              </article>
            ))}
          </section>

          <section className="project-ops-grid">
            <div className="project-ops-panel">
              <div className="ops-panel-header">
                <div>
                  <span className="ops-kicker">Acciones globales</span>
                  <h3>Tareas del proyecto</h3>
                </div>
                <button className="btn btn-primary btn-sm" onClick={() => setTab('tareas')}>Abrir tareas</button>
              </div>
              <div className="ops-task-list">
                {tareas.slice(0, 8).map(t => (
                  <button key={t.id} className="ops-task-row" onClick={() => setTab('tareas')}>
                    <span className={`ops-priority-dot priority-${String(t.priority || '').toLowerCase()}`} />
                    <span>
                      <strong>{t.title}</strong>
                      <em>{t.context || 'Proyecto'}{t.due_date ? ` · ${fmtDate(t.due_date)}` : ''}</em>
                    </span>
                  </button>
                ))}
                {tareas.length === 0 && <p className="empty-tab">No hay tareas globales registradas.</p>}
              </div>
            </div>

            <div className="project-ops-panel">
              <div className="ops-panel-header">
                <div>
                  <span className="ops-kicker">Priorizacion</span>
                  <h3>Segmentos de gestion</h3>
                </div>
              </div>
              <div className="lane-list">
                {Object.entries(operationStats.lanes).map(([lane, count]) => (
                  <div key={lane} className="lane-row">
                    <span>{LANE_LABELS[lane] || 'Sin prioridad'}</span>
                    <strong>{count}</strong>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="project-ops-panel">
            <div className="ops-panel-header">
              <div>
                <span className="ops-kicker">Clientes</span>
                <h3>Matriz de cumplimiento documental</h3>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setTab('members')}>Ver lista completa</button>
            </div>
            <div className="ops-client-matrix">
              <table>
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Prioridad</th>
                    {DOCUMENT_GATES.map(gate => <th key={gate.id} title={gate.label}>{gate.shortLabel || gate.label}</th>)}
                    <th>Proximo paso</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map(member => {
                    const metadata = safeMetadata(member.metadata);
                    const lane = metadata?.rb_operacion?.priorizacion_semanal?.lane;
                    return (
                      <tr key={member.id}>
                        <td>
                          <Link to={`/cases/${member.id}`} className="member-name-link">{member.client_name || member.title}</Link>
                          <span className="member-case-num">{member.case_number}</span>
                        </td>
                        <td><span className="ops-lane-pill">{LANE_LABELS[lane] || 'Sin prioridad'}</span></td>
                        {DOCUMENT_GATES.map(gate => {
                          const checked = gateComplete(member, gate);
                          return (
                            <td key={gate.id}>
                              <label className={`doc-check ${checked ? 'doc-check-done' : ''}`} title={gateState(member, gate.id)}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => updateDocumentGate(member.id, gate, e.target.checked)}
                                />
                                <span>{checked ? 'OK' : 'Falta'}</span>
                              </label>
                            </td>
                          );
                        })}
                        <td className="ops-next-action">{member.next_action || 'Sin siguiente accion'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── Tab: Clientes ── */}
      {tab === 'members' && (
        <div className="tab-content">
          <div className="tab-content-header">
            <span className="tab-content-count">{members.length} clientes vinculados</span>
            <button className="btn btn-secondary" onClick={() => setShowLinkCase(true)}>
              + Vincular caso
            </button>
          </div>

          <div className="members-table-wrap">
            <table className="members-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>C.C.</th>
                  <th>Contacto</th>
                  <th>Honorarios</th>
                  <th>Estado</th>
                  <th>Tareas / Venc</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td>
                      <Link to={`/cases/${m.id}`} className="member-name-link">
                        {m.client_name || '—'}
                      </Link>
                      <span className="member-case-num">{m.case_number}</span>
                    </td>
                    <td className="mono">{m.document_number || '—'}</td>
                    <td>
                      {m.client_email && <div className="member-contact">{m.client_email}</div>}
                      {m.client_phone && <div className="member-contact">{m.client_phone}</div>}
                    </td>
                    <td className="mono">
                      {m.fee ? `$${Number(m.fee).toLocaleString('es-CO')}` : '—'}
                      {m.fee_paid && <span className="badge-paid">Pagado</span>}
                    </td>
                    <td>
                      <span className={`badge-case-status ${m.status?.toLowerCase()}`}>
                        {m.status}
                      </span>
                    </td>
                    <td>
                      {(parseInt(m.tareas_pendientes) > 0 || parseInt(m.vencimientos_proximos) > 0) ? (
                        <span className="member-counters">
                          {parseInt(m.tareas_pendientes) > 0 && (
                            <span className="counter-pill">{m.tareas_pendientes}T</span>
                          )}
                          {parseInt(m.vencimientos_proximos) > 0 && (
                            <span className="counter-pill counter-pill-warn">{m.vencimientos_proximos}V</span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <button
                        className="btn-unlink"
                        onClick={() => unlinkCase(m.id)}
                        title="Desvincular del proyecto"
                      >✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Modal vincular caso */}
          {showLinkCase && (
            <div className="modal-overlay" onClick={() => setShowLinkCase(false)}>
              <div className="modal-box" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Vincular caso existente</h2>
                  <button className="modal-close" onClick={() => setShowLinkCase(false)}>✕</button>
                </div>
                <div className="modal-form">
                  <div className="form-group">
                    <label>Buscar por nombre de cliente o número de caso</label>
                    <input
                      autoFocus
                      type="text"
                      value={caseSearch}
                      onChange={e => searchCases(e.target.value)}
                      placeholder="ej: García o SC-2026-0001"
                    />
                  </div>
                  {caseResults.length > 0 && (
                    <div className="case-search-results">
                      {caseResults.map(c => (
                        <div
                          key={c.id}
                          className="case-search-item"
                          onClick={() => linkCase(c.id)}
                        >
                          <strong>{c.case_number}</strong> — {c.client_name || c.title}
                          {c.service_type && <span className="case-search-type">{c.service_type}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {caseSearch.length >= 2 && caseResults.length === 0 && (
                    <p className="no-results">Sin resultados para "{caseSearch}"</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Actuaciones ── */}
      {tab === 'actuaciones' && (
        <div className="tab-content">
          <div className="tab-content-header">
            <span className="tab-content-count">
              {actuaciones.filter(a => !a.completed_at).length} pendientes · {actuaciones.filter(a => a.completed_at).length} completadas
            </span>
            <button className="btn btn-primary" onClick={() => setShowActForm(!showActForm)}>
              + Actuación
            </button>
          </div>

          {showActForm && (
            <form className="inline-form" onSubmit={submitAct}>
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo</label>
                  <select value={actForm.type} onChange={e => setActForm({...actForm, type: e.target.value})}>
                    {Object.entries(ACT_TYPE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="form-group fg-grow">
                  <label>Título *</label>
                  <input
                    required
                    value={actForm.title}
                    onChange={e => setActForm({...actForm, title: e.target.value})}
                    placeholder="ej: Audiencia de verificación SIC"
                  />
                </div>
                <div className="form-group">
                  <label>Fecha</label>
                  <input type="date" value={actForm.scheduled_at}
                    onChange={e => setActForm({...actForm, scheduled_at: e.target.value})} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group fg-grow">
                  <label>Radicado</label>
                  <input value={actForm.radicado}
                    onChange={e => setActForm({...actForm, radicado: e.target.value})}
                    placeholder="Número de radicado externo" />
                </div>
                <div className="form-group fg-grow">
                  <label>Descripción</label>
                  <input value={actForm.description}
                    onChange={e => setActForm({...actForm, description: e.target.value})} />
                </div>
              </div>
              <div className="inline-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowActForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Registrar actuación</button>
              </div>
            </form>
          )}

          <div className="actuaciones-list">
            {actuaciones.length === 0 && <p className="empty-tab">No hay actuaciones registradas.</p>}
            {actuaciones.map(a => (
              <div key={a.id} className={`actuacion-row ${a.completed_at ? 'act-done' : ''}`}>
                <div className="act-left">
                  <span className={`badge-act-type ${a.type?.toLowerCase()}`}>
                    {ACT_TYPE_LABELS[a.type] || a.type}
                  </span>
                  <div className="act-body">
                    <span className="act-title">{a.title}</span>
                    {a.description && <span className="act-desc">{a.description}</span>}
                    {a.radicado && <span className="act-radicado">Rad. {a.radicado}</span>}
                    {a.result && <span className="act-result">✓ {a.result}</span>}
                  </div>
                </div>
                <div className="act-right">
                  {a.scheduled_at && (
                    <span className={`act-date ${!a.completed_at && daysUntil(a.scheduled_at) <= 3 ? 'act-date-urgent' : ''}`}>
                      {fmtDate(a.scheduled_at)}
                    </span>
                  )}
                  {!a.completed_at && (
                    <button className="btn-complete" onClick={() => completeAct(a.id)}>
                      ✓ Completar
                    </button>
                  )}
                  {a.completed_at && (
                    <span className="act-completed-at">{fmtDate(a.completed_at)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Tareas ── */}
      {tab === 'tareas' && (
        <div className="tab-content">
          <div className="tab-content-header">
            <span className="tab-content-count">{pendingTareas} pendientes</span>
            <button className="btn btn-primary" onClick={() => setShowTareaForm(!showTareaForm)}>
              + Tarea
            </button>
          </div>

          {showTareaForm && (
            <form className="inline-form" onSubmit={submitTarea}>
              <div className="form-row">
                <div className="form-group fg-grow">
                  <label>Título *</label>
                  <input
                    required
                    value={tareaForm.title}
                    onChange={e => setTareaForm({...tareaForm, title: e.target.value})}
                    placeholder="ej: Preparar memorial de respuesta"
                  />
                </div>
                <div className="form-group">
                  <label>Prioridad</label>
                  <select value={tareaForm.priority}
                    onChange={e => setTareaForm({...tareaForm, priority: e.target.value})}>
                    {['CRITICA','ALTA','MEDIA','BAJA'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Fecha límite</label>
                  <input type="date" value={tareaForm.due_date}
                    onChange={e => setTareaForm({...tareaForm, due_date: e.target.value})} />
                </div>
              </div>
              <div className="inline-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowTareaForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Crear tarea</button>
              </div>
            </form>
          )}

          <div className="tareas-list">
            {tareas.length === 0 && <p className="empty-tab">No hay tareas registradas.</p>}
            {tareas.map(t => (
              <div key={t.id} className={`tarea-item ${t.status === 'COMPLETADA' ? 'tarea-done' : ''}`}>
                <button
                  className={`tarea-check ${t.status === 'COMPLETADA' ? 'tarea-check-done' : ''}`}
                  onClick={() => t.status !== 'COMPLETADA' && completeTarea(t.id)}
                >
                  {t.status === 'COMPLETADA' ? '✓' : '○'}
                </button>
                <div className="tarea-body">
                  <span className="tarea-title">{t.title}</span>
                  {t.description && <span className="tarea-desc">{t.description}</span>}
                  <span className="tarea-meta">
                    {t.assigned_to_name && <span>→ {t.assigned_to_name}</span>}
                    {t.due_date && (
                      <span className={daysUntil(t.due_date) < 0 ? 'text-crit' : daysUntil(t.due_date) <= 3 ? 'text-warn' : ''}>
                        {fmtDate(t.due_date)}
                      </span>
                    )}
                  </span>
                </div>
                <span
                  className="tarea-priority-dot"
                  style={{ background: PRIORITY_COLORS[t.priority] || '#ccc' }}
                  title={t.priority}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Vencimientos ── */}
      {tab === 'vencimientos' && (
        <div className="tab-content">
          <div className="tab-content-header">
            <span className="tab-content-count">
              {overdueVenc > 0 && <span className="text-crit">{overdueVenc} vencidos · </span>}
              {vencimientos.filter(v => !v.resolved).length} activos
            </span>
            <button className="btn btn-primary" onClick={() => setShowVencForm(!showVencForm)}>
              + Vencimiento
            </button>
          </div>

          {showVencForm && (
            <form className="inline-form" onSubmit={submitVenc}>
              <div className="form-row">
                <div className="form-group fg-grow">
                  <label>Título *</label>
                  <input
                    required
                    value={vencForm.title}
                    onChange={e => setVencForm({...vencForm, title: e.target.value})}
                    placeholder="ej: Término de traslado SIC"
                  />
                </div>
                <div className="form-group">
                  <label>Fecha *</label>
                  <input
                    required
                    type="date"
                    value={vencForm.due_date}
                    onChange={e => setVencForm({...vencForm, due_date: e.target.value})}
                  />
                </div>
              </div>
              <div className="inline-form-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowVencForm(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary">Agregar vencimiento</button>
              </div>
            </form>
          )}

          <div className="venc-list">
            {vencimientos.length === 0 && <p className="empty-tab">No hay vencimientos registrados.</p>}
            {vencimientos.map(v => {
              const days = daysUntil(v.due_date);
              const isOverdue = !v.resolved && days < 0;
              return (
                <div key={v.id} className={`venc-item ${v.resolved ? 'venc-resolved' : ''} ${isOverdue ? 'venc-overdue' : ''}`}>
                  <div className="venc-urgency-bar"
                    style={{ background: v.resolved ? '#2ecc71' : URGENCY_COLORS[v.urgency] || '#ccc' }}
                  />
                  <div className="venc-body">
                    <span className="venc-title">{v.title}</span>
                    <span className={`venc-date ${isOverdue ? 'text-crit' : days <= 3 ? 'text-warn' : ''}`}>
                      {fmtDate(v.due_date)}
                      {!v.resolved && days !== null && (
                        <em>{isOverdue ? ` (hace ${Math.abs(days)}d)` : days === 0 ? ' (hoy)' : ` (en ${days}d)`}</em>
                      )}
                    </span>
                    {v.resolved && <span className="venc-resolved-label">✓ Resuelto {fmtDate(v.resolved_at)}</span>}
                  </div>
                  {!v.resolved && (
                    <button className="btn-resolve" onClick={() => resolveVenc(v.id)}>
                      Resolver
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
