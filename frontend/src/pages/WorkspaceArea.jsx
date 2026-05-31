import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const AREAS = {
  recepcion: {
    title: 'Recepcion',
    subtitle: 'Entrada, calificacion y conversion antes del trabajo juridico formal.',
    formula: 'Recepcion = entrada',
    status: 'Espacio preparado para conectar formularios, inbox y onboarding.',
    primaryAction: { label: 'Ver clientes', path: '/clients' },
    secondaryAction: { label: 'Ver despacho', path: '/' },
    sections: [
      { title: 'Entrada', label: 'Zona viva', items: ['usuarios', 'solicitudes', 'documentos iniciales', 'mensajes de llegada'] },
      { title: 'Prospectos', label: 'Por clasificar', items: ['datos de contacto', 'necesidad juridica', 'origen del contacto', 'siguiente paso comercial'] },
      { title: 'Entrevistas', label: 'Agenda futura', items: ['reunion inicial', 'minuta de entrevista', 'preguntas pendientes', 'responsable'] },
      { title: 'Viabilidad', label: 'Decision', items: ['evaluacion preliminar', 'riesgo', 'honorarios sugeridos', 'conversion a cliente'] },
    ],
  },
  oficina: {
    title: 'Oficina',
    subtitle: 'Trabajo juridico, organizacion, criterio y valor economico del despacho.',
    formula: 'Oficina = trabajo',
    status: 'Mapa operativo sin tocar integraciones externas en curso.',
    primaryAction: { label: 'Ir al escritorio', path: '/tasks' },
    secondaryAction: { label: 'Ver casos', path: '/cases' },
    sections: [
      { title: 'Escritorio', label: 'Produccion', items: ['redacta', 'proyecta', 'corrige', 'sustenta', 'analiza', 'prepara estrategia'], path: '/tasks' },
      { title: 'Expedientes', label: 'Organizacion', items: ['carpetas', 'asuntos', 'actuaciones', 'documentos', 'terminos', 'pruebas'], path: '/cases' },
      { title: 'Biblioteca', label: 'Criterio', items: ['normas', 'jurisprudencia', 'doctrina', 'precedentes', 'plantillas base'], path: '/library' },
      { title: 'Caja fuerte', label: 'Valor economico', items: ['honorarios', 'contratos', 'gastos', 'rentabilidad'], path: '/vault' },
    ],
  },
  biblioteca: {
    title: 'Biblioteca',
    subtitle: 'Conocimiento, fundamento y criterios internos reutilizables.',
    formula: 'Biblioteca = criterio',
    status: 'Lista para recibir normas, jurisprudencia, doctrina y plantillas cuando exista el repositorio documental.',
    primaryAction: { label: 'Volver a oficina', path: '/office' },
    secondaryAction: { label: 'Ver casos', path: '/cases' },
    sections: [
      { title: 'Normas', label: 'Base juridica', items: ['constitucion', 'leyes', 'decretos', 'reglamentos', 'circulares'] },
      { title: 'Jurisprudencia', label: 'Decision judicial', items: ['sentencias clave', 'lineas decisionales', 'citas frecuentes', 'criterios por tema'] },
      { title: 'Doctrina', label: 'Analisis', items: ['articulos', 'libros', 'conceptos academicos', 'notas de estudio'] },
      { title: 'Plantillas base', label: 'Reutilizable', items: ['memoriales', 'oficios', 'recursos', 'minutas', 'respuestas tipo'] },
    ],
  },
  caja: {
    title: 'Caja fuerte',
    subtitle: 'Custodia economica y valor patrimonial del trabajo juridico.',
    formula: 'Caja fuerte = valor economico',
    status: 'Vista conceptual; no mueve datos contables ni integra proveedores externos.',
    primaryAction: { label: 'Ver casos', path: '/cases' },
    secondaryAction: { label: 'Volver a oficina', path: '/office' },
    sections: [
      { title: 'Honorarios', label: 'Acuerdo', items: ['contratos', 'igualas', 'anticipos', 'acuerdos economicos'] },
      { title: 'Gastos', label: 'Operacion', items: ['gastos del caso', 'reembolsos', 'costas', 'soportes'] },
      { title: 'Rentabilidad', label: 'Lectura', items: ['por asunto', 'por cliente', 'por proyecto', 'distribucion de ingresos'] },
    ],
  },
};

function AreaTile({ section, onNavigate }) {
  const clickable = Boolean(section.path);

  return (
    <button
      className={`area-tile${clickable ? '' : ' area-tile-static'}`}
      type="button"
      onClick={() => clickable && onNavigate(section.path)}
    >
      <div className="area-tile-top">
        <div>
          <div className="area-tile-title">{section.title}</div>
          <div className="area-tile-label">{section.label}</div>
        </div>
        <span className="area-tile-arrow">{clickable ? '>' : '-'}</span>
      </div>
      <div className="area-list">
        {section.items.map(item => <span key={item}>{item}</span>)}
      </div>
    </button>
  );
}

const RECEPTION_STAGES = [
  { key: 'entrada', label: 'Entrada', detail: 'Correo, llamada, formulario o referido' },
  { key: 'identidad', label: 'Identidad', detail: 'Cliente, contacto y contraparte' },
  { key: 'clasificacion', label: 'Clasificacion', detail: 'Servicio, urgencia y entidad' },
  { key: 'decision', label: 'Decision', detail: 'Crear caso, solicitar datos o descartar' },
];

const ANALYSIS_RULES = [
  ['Identidad', 'cliente, documento, email y telefono'],
  ['Materia', 'PQRS, tutela, contrato, laboral u otro'],
  ['Urgencia', 'terminos, vencimientos y riesgo inmediato'],
  ['Soportes', 'anexos, radicados, respuestas y pruebas'],
  ['Viabilidad', 'ruta sugerida y faltantes antes de convertir'],
];

function ReceptionStat({ label, value, tone }) {
  return (
    <div className={`reception-stat ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReceptionInboxRow({ item, onOpen }) {
  const status = item.status || 'NUEVO';
  return (
    <button type="button" className="reception-inbox-row" onClick={() => onOpen(item.id)}>
      <span className="reception-row-source">{item.intake_channel || 'Caso'}</span>
      <span className="reception-row-main">
        <strong>{item.client_name || 'Cliente por validar'}</strong>
        <small>{item.title}</small>
      </span>
      <span className={`reception-row-status ${status.toLowerCase()}`}>{status.replaceAll('_', ' ')}</span>
    </button>
  );
}

function emailDisplayName(value) {
  if (!value) return 'Remitente por validar';
  const match = value.match(/^"?([^"<]+)"?\s*</);
  return (match?.[1] || value).trim();
}

function formatMailDate(value) {
  if (!value) return 'Fecha sin leer';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function getGoogleActionMessage(err, fallback) {
  const code = err.response?.data?.code;
  if (code === 'GMAIL_SCOPE_REQUIRED' || code === 'GOOGLE_RECONNECT_REQUIRED') {
    return 'Reconecta Google en Ajustes para habilitar acciones de Gmail como leido y descartar.';
  }
  return err.response?.data?.error || fallback;
}

function ReceptionMailRow({ message, canModify, actionLoading, onLink, onMarkRead, onDiscard }) {
  const disabledActions = !canModify || actionLoading === message.gmail_message_id;

  return (
    <div className={`reception-mail-row ${message.unread ? 'unread' : ''}`}>
      <div className="reception-mail-marker">{message.unread ? 'N' : 'G'}</div>
      <div className="reception-mail-main">
        <div className="reception-mail-meta">
          <strong>{emailDisplayName(message.from)}</strong>
          <span>{formatMailDate(message.date)}</span>
        </div>
        <div className="reception-mail-subject">{message.subject || 'Sin asunto'}</div>
        <p>{message.snippet || 'Sin vista previa disponible.'}</p>
        <div className="reception-mail-tags">
          {message.has_attachments && <span>Adjuntos</span>}
          <span>Thread {message.thread_id?.slice(0, 8) || 'sin hilo'}</span>
        </div>
      </div>
      <div className="reception-mail-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => onLink(message)}>
          Vincular a caso
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={disabledActions || !message.unread}
          title={canModify ? 'Marcar como leido en Gmail' : 'Reconecta Google para autorizar acciones de Gmail'}
          onClick={() => onMarkRead(message)}
        >
          Leido
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={disabledActions}
          title={canModify ? 'Mover a papelera en Gmail' : 'Reconecta Google para autorizar acciones de Gmail'}
          onClick={() => onDiscard(message)}
        >
          Descartar
        </button>
      </div>
    </div>
  );
}

function ReceptionLinkDialog({
  message,
  cases,
  caseSearch,
  onSearchChange,
  onSearch,
  loading,
  linking,
  error,
  selectedIds,
  onClose,
  onToggle,
  onLink,
}) {
  if (!message) return null;
  const selectedCount = selectedIds.length;

  return (
    <div className="modal-overlay">
      <div className="modal reception-link-modal">
        <div className="modal-header">
          <div>
            <div className="modal-title">Vincular correo a expedientes</div>
            <div className="reception-link-subject">{message.subject || 'Sin asunto'}</div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}>x</button>
        </div>
        <div className="reception-link-search">
          <input
            value={caseSearch}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar caso por numero, titulo o cliente"
          />
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSearch}>
            Buscar
          </button>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        <div className="reception-link-summary">
          <span>{selectedCount ? `${selectedCount} seleccionado${selectedCount === 1 ? '' : 's'}` : 'Selecciona uno o varios expedientes'}</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!selectedCount || linking}
            onClick={onLink}
          >
            Vincular seleccionados
          </button>
        </div>
        <div className="reception-case-picker">
          {loading ? (
            <div className="reception-empty">Cargando casos...</div>
          ) : cases.length === 0 ? (
            <div className="reception-empty">No hay casos para vincular con esta busqueda.</div>
          ) : (
            cases.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`reception-case-option ${selectedIds.includes(item.id) ? 'selected' : ''}`}
                onClick={() => onToggle(item.id)}
                disabled={linking}
              >
                <span className="reception-case-check">{selectedIds.includes(item.id) ? 'OK' : '+'}</span>
                <span>{item.case_number || `Caso ${item.id}`}</span>
                <strong>{item.title}</strong>
                <small>{item.client_name || 'Cliente por validar'}</small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ReceptionArea() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [googleStatus, setGoogleStatus] = useState({ loading: true, connected: false });
  const [recentCases, setRecentCases] = useState([]);
  const [newCases, setNewCases] = useState([]);
  const [mailbox, setMailbox] = useState({ messages: [], unavailable: null });
  const [linkingMessage, setLinkingMessage] = useState(null);
  const [caseChoices, setCaseChoices] = useState([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [caseLoading, setCaseLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState([]);
  const [mailActionLoading, setMailActionLoading] = useState(null);
  const [mailNotice, setMailNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeLane, setActiveLane] = useState('entrada');

  const loadReception = async () => {
    setLoading(true);
    try {
      const [statsRes, recentRes, newRes, googleRes, inboxRes] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/dashboard/recent'),
        api.get('/cases?status=NUEVO&limit=8'),
        api.get('/google/status').catch(() => ({ data: { connected: false } })),
        api.get('/google/gmail/inbox?maxResults=8', { timeout: 45000 })
          .catch(err => ({ data: { messages: [], unavailable: err.response?.data?.code || err.message } })),
      ]);
      setStats(statsRes.data);
      setRecentCases(recentRes.data || []);
      setNewCases(newRes.data?.cases || []);
      setGoogleStatus({ loading: false, ...googleRes.data });
      setMailbox({
        messages: inboxRes.data?.messages || [],
        unavailable: inboxRes.data?.unavailable || null,
      });
    } catch (err) {
      console.error(err);
      setGoogleStatus(prev => ({ ...prev, loading: false }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReception();
  }, []);

  const queue = useMemo(() => {
    const source = newCases.length ? newCases : recentCases;
    return source.slice(0, 6);
  }, [newCases, recentCases]);

  const openCase = (id) => {
    if (id) navigate(`/cases/${id}`);
  };

  const loadCaseChoices = async (search = '') => {
    setCaseLoading(true);
    setLinkError('');
    try {
      const params = new URLSearchParams({ limit: '12' });
      if (search.trim()) params.set('search', search.trim());
      const res = await api.get(`/cases?${params}`);
      setCaseChoices(res.data?.cases || []);
    } catch (err) {
      console.error(err);
      setLinkError('No fue posible cargar los casos disponibles.');
    } finally {
      setCaseLoading(false);
    }
  };

  const openLinkDialog = (message) => {
    setLinkingMessage(message);
    setCaseSearch('');
    setSelectedCaseIds([]);
    setLinkError('');
    loadCaseChoices('');
  };

  const toggleCaseSelection = (caseId) => {
    setSelectedCaseIds(prev => (
      prev.includes(caseId)
        ? prev.filter(id => id !== caseId)
        : [...prev, caseId]
    ));
  };

  const linkMessageToCases = async () => {
    if (!linkingMessage?.thread_id) return;
    if (!selectedCaseIds.length) {
      setLinkError('Selecciona al menos un expediente.');
      return;
    }

    setLinking(true);
    setLinkError('');
    try {
      await Promise.all(selectedCaseIds.map(caseId => (
        api.post(`/cases/${caseId}/google/gmail/sync`, {
          threadId: linkingMessage.thread_id,
          maxResults: 20,
        }, { timeout: 180000 })
      )));
      const firstCaseId = selectedCaseIds[0];
      setMailNotice(`Correo vinculado a ${selectedCaseIds.length} expediente${selectedCaseIds.length === 1 ? '' : 's'}.`);
      setLinkingMessage(null);
      setSelectedCaseIds([]);
      navigate(`/cases/${firstCaseId}`);
    } catch (err) {
      console.error(err);
      setLinkError(err.response?.data?.error || 'No fue posible vincular el correo al caso.');
    } finally {
      setLinking(false);
    }
  };

  const markMessageRead = async (message) => {
    setMailActionLoading(message.gmail_message_id);
    setMailNotice('');
    try {
      await api.patch(`/google/gmail/messages/${message.gmail_message_id}/read`);
      setMailbox(prev => ({
        ...prev,
        messages: prev.messages.map(item => (
          item.gmail_message_id === message.gmail_message_id
            ? { ...item, unread: false, labels: (item.labels || []).filter(label => label !== 'UNREAD') }
            : item
        )),
      }));
      setMailNotice('Correo marcado como leido en Gmail.');
    } catch (err) {
      console.error(err);
      setMailNotice(getGoogleActionMessage(err, 'No fue posible marcar el correo como leido.'));
    } finally {
      setMailActionLoading(null);
    }
  };

  const discardMessage = async (message) => {
    setMailActionLoading(message.gmail_message_id);
    setMailNotice('');
    try {
      await api.post(`/google/gmail/messages/${message.gmail_message_id}/trash`);
      setMailbox(prev => ({
        ...prev,
        messages: prev.messages.filter(item => item.gmail_message_id !== message.gmail_message_id),
      }));
      setMailNotice('Correo movido a la papelera de Gmail.');
    } catch (err) {
      console.error(err);
      setMailNotice(getGoogleActionMessage(err, 'No fue posible descartar el correo.'));
    } finally {
      setMailActionLoading(null);
    }
  };

  const closeLinkDialog = () => {
    setLinkingMessage(null);
    setSelectedCaseIds([]);
    setLinkError('');
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Recepcion</div>
          <div className="page-subtitle">Bandeja de entrada, triage y preparacion del trabajo juridico.</div>
        </div>
        <div className="area-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/clients')}>
            Clientes
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/cases')}>
            Crear o revisar caso
          </button>
        </div>
      </div>

      <div className="page-body">
        <section className="reception-command">
          <div className="reception-command-main">
            <div className="reception-command-label">Mesa de entrada</div>
            <h2>Prioriza solicitudes antes de abrir expediente.</h2>
            <p>
              Revisa entradas nuevas, ubica al cliente, identifica la urgencia y decide
              si el asunto se convierte en caso, queda pendiente de datos o se descarta.
            </p>
            <div className="reception-command-actions">
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/cases')}>
                Revisar entradas
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings?section=integraciones')}>
                Ajustes de entrada
              </button>
            </div>
          </div>
          <div className="reception-google-status">
            <span className={`reception-live-dot ${googleStatus.connected ? 'on' : ''}`} />
            <div>
              <strong>{googleStatus.connected ? 'Gmail conectado' : 'Gmail sin conectar'}</strong>
              <small>
                {googleStatus.connected
                  ? `${googleStatus.email}${googleStatus.gmail_modify_enabled ? ' - acciones activas' : ' - reconecta para acciones'}`
                  : 'Configura Google para habilitar entrada por correo'}
              </small>
              <div className="reception-source-stack">
                <span className={googleStatus.connected ? 'active' : ''}>Gmail</span>
                <span>WhatsApp proximo</span>
              </div>
            </div>
          </div>
        </section>

        <section className="reception-stats">
          <ReceptionStat label="Entradas nuevas" value={newCases.length} tone="gold" />
          <ReceptionStat label="Casos activos" value={stats?.active_cases ?? '-'} />
          <ReceptionStat label="Tareas abiertas" value={stats?.tasks?.open ?? '-'} />
          <ReceptionStat label="Alertas proximas" value={stats?.deadlines?.open ?? '-'} tone="warn" />
        </section>

        <section className="reception-panel reception-mailbox-panel">
          <div className="reception-panel-head">
            <div>
              <span>Bandeja Gmail de la firma</span>
              <strong>{mailbox.messages.length ? `${mailbox.messages.length} correos recientes` : 'Entrada general'}</strong>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={loadReception}>Actualizar Gmail</button>
          </div>

          {mailNotice && (
            <div className="reception-mail-notice">
              {mailNotice}
            </div>
          )}

          <div className="reception-mail-source-bar">
            <div className="active">
              <strong>Gmail</strong>
              <span>{googleStatus.connected ? 'Lectura activa' : 'Sin conexion'}</span>
            </div>
            <div>
              <strong>WhatsApp</strong>
              <span>Proximo canal</span>
            </div>
            <div>
              <strong>Drive</strong>
              <span>Expediente documental</span>
            </div>
          </div>

          {mailbox.unavailable ? (
            <div className="reception-empty reception-mail-empty">
              No fue posible leer la bandeja general ahora. Revisa la conexion de Google o vuelve a actualizar.
            </div>
          ) : mailbox.messages.length === 0 ? (
            <div className="reception-empty reception-mail-empty">
              No hay correos recientes en la bandeja de entrada.
            </div>
          ) : (
            <div className="reception-mail-list">
              {mailbox.messages.map(message => (
                <ReceptionMailRow
                  key={message.gmail_message_id}
                  message={message}
                  canModify={Boolean(googleStatus.gmail_modify_enabled)}
                  actionLoading={mailActionLoading}
                  onLink={openLinkDialog}
                  onMarkRead={markMessageRead}
                  onDiscard={discardMessage}
                />
              ))}
            </div>
          )}
        </section>

        <section className="reception-layout">
          <div className="reception-panel reception-inbox-panel">
            <div className="reception-panel-head">
              <div>
                <span>Cola de entrada</span>
                <strong>{loading ? 'Cargando...' : `${queue.length} asuntos visibles`}</strong>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={loadReception}>Actualizar</button>
            </div>

            <div className="reception-lanes">
              {RECEPTION_STAGES.map(stage => (
                <button
                  key={stage.key}
                  type="button"
                  className={`reception-lane ${activeLane === stage.key ? 'active' : ''}`}
                  onClick={() => setActiveLane(stage.key)}
                >
                  <strong>{stage.label}</strong>
                  <span>{stage.detail}</span>
                </button>
              ))}
            </div>

            <div className="reception-inbox-list">
              {queue.length === 0 ? (
                <div className="reception-empty">
                  No hay entradas nuevas en este momento.
                </div>
              ) : (
                queue.map(item => <ReceptionInboxRow key={item.id} item={item} onOpen={openCase} />)
              )}
            </div>
          </div>

          <aside className="reception-panel reception-analysis-panel">
            <div className="reception-panel-head compact">
              <div>
                <span>Analisis preparado</span>
                <strong>Checklist de Sala</strong>
              </div>
            </div>
            <div className="reception-analysis-list">
              {ANALYSIS_RULES.map(([title, body]) => (
                <div key={title} className="reception-analysis-rule">
                  <span>{title}</span>
                  <p>{body}</p>
                </div>
              ))}
            </div>
            <div className="reception-next-box">
              <strong>Siguiente capa</strong>
              <span>Convertir cada entrada en borrador de caso con sugerencia de cliente, servicio, urgencia y documentos faltantes.</span>
            </div>
          </aside>
        </section>
      </div>

      <ReceptionLinkDialog
        message={linkingMessage}
        cases={caseChoices}
        caseSearch={caseSearch}
        onSearchChange={setCaseSearch}
        onSearch={() => loadCaseChoices(caseSearch)}
        loading={caseLoading}
        linking={linking}
        error={linkError}
        selectedIds={selectedCaseIds}
        onClose={closeLinkDialog}
        onToggle={toggleCaseSelection}
        onLink={linkMessageToCases}
      />
    </>
  );
}

export default function WorkspaceArea({ area }) {
  const navigate = useNavigate();
  const config = AREAS[area] || AREAS.oficina;

  if (area === 'recepcion') return <ReceptionArea />;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">{config.title}</div>
          <div className="page-subtitle">{config.subtitle}</div>
        </div>
        <div className="area-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(config.secondaryAction.path)}>
            {config.secondaryAction.label}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(config.primaryAction.path)}>
            {config.primaryAction.label}
          </button>
        </div>
      </div>

      <div className="page-body">
        <div className="area-hero">
          <div>
            <div className="area-formula">{config.formula}</div>
            <p>{config.status}</p>
          </div>
          <div className="area-boundary">
            UI preparada sin tocar Drive, Anthropic, Gmail ni credenciales.
          </div>
        </div>

        <div className="area-grid">
          {config.sections.map(section => (
            <AreaTile key={section.title} section={section} onNavigate={navigate} />
          ))}
        </div>
      </div>
    </>
  );
}
