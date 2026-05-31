import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useScreenContext } from '../context/AgentContext';
import api from '../services/api';
import GmailImportModal from '../components/Gmail/GmailImportModal';
import CapabilityStatus from '../components/CapabilityStatus';
import SalaHeader from '../components/Sala/SalaHeader';
import ExpedienteVivo from '../components/Expediente/ExpedienteVivo';
import TimeEntriesPanel from '../components/TimeTracking/TimeEntriesPanel';
import ClientPortalInvite from '../components/ClientPortal/ClientPortalInvite';
import CalendarSyncButton from '../components/Calendar/CalendarSyncButton';

// ─── Helpers ────────────────────────────────────────────────

const formatCOP = (n) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(n ?? 0);

const formatDate = (d) =>
  d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const formatDateTime = (d) =>
  d ? new Date(d).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const diasHasta = (d) => {
  if (!d) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const f   = new Date(d);  f.setHours(0,0,0,0);
  return Math.ceil((f - hoy) / (1000 * 60 * 60 * 24));
};

const labelDias = (d) => {
  const n = diasHasta(d);
  if (n === null) return '';
  if (n < 0)   return `hace ${Math.abs(n)}d`;
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `en ${n}d`;
};

const normalizeMetadata = (metadata) => {
  if (!metadata) return {};
  if (typeof metadata === 'string') {
    try { return JSON.parse(metadata); }
    catch { return {}; }
  }
  return metadata;
};

const isGmailCommunication = (communication) => {
  const metadata = normalizeMetadata(communication.metadata);
  return communication.type === 'email' && metadata.source === 'gmail';
};

const extractGmailBody = (content = '', snippet = '') => {
  const raw = String(content || '').trim();
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length > 1 && /^(Asunto|De|Para|Fecha):/i.test(parts[0])) {
    return parts.slice(1).join('\n\n').trim() || snippet || raw;
  }
  return snippet || raw;
};

const formatEmailDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const shortenId = (value) => {
  if (!value) return '';
  return value.length > 10 ? `${value.slice(0, 10)}...` : value;
};

const formatFileSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Sin tamano';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

const formatDriveMime = (mimeType = '') => {
  if (!mimeType) return 'Archivo';
  if (mimeType === 'application/vnd.google-apps.folder') return 'Carpeta';
  if (mimeType.includes('document')) return 'Documento';
  if (mimeType.includes('spreadsheet')) return 'Hoja';
  if (mimeType.includes('presentation')) return 'Presentacion';
  if (mimeType.includes('pdf')) return 'PDF';
  if (mimeType.startsWith('image/')) return 'Imagen';
  return mimeType.split('/').pop()?.toUpperCase() || 'Archivo';
};

const isDriveFolder = (file) =>
  (file?.mime_type || file?.mimeType) === 'application/vnd.google-apps.folder';

const driveFolderLabel = (file) => {
  if (file?.parent_folder_name) return file.parent_folder_name;
  const metadata = normalizeMetadata(file?.metadata);
  if (metadata.parent_folder_name) return metadata.parent_folder_name;
  return 'Raiz del expediente';
};

const buildDriveSearchQuery = (query) => {
  const term = String(query || '').trim().replace(/'/g, "\\'");
  return term ? `name contains '${term}' and trashed = false` : 'trashed = false';
};

// ─── Constantes ──────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: 'NUEVO',             label: 'Nuevo' },
  { value: 'EN_PROCESO',        label: 'En proceso' },
  { value: 'PENDIENTE_CLIENTE', label: 'Pend. cliente' },
  { value: 'PENDIENTE_ENTIDAD', label: 'Pend. entidad' },
  { value: 'PENDIENTE_PAGO',    label: 'Pend. pago' },
  { value: 'CERRADO',           label: 'Cerrado' },
  { value: 'ARCHIVADO',         label: 'Archivado' },
];
const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map(s => [s.value, s.label]));

const SERVICE_TYPE_OPTIONS = [
  { type: 'PQRS', label: 'PQRS', fee: 50000 },
  { type: 'TUTELA', label: 'Tutela', fee: 100000 },
  { type: 'PENAL', label: 'Penal', fee: 0 },
  { type: 'CIVIL', label: 'Civil', fee: 0 },
  { type: 'ADMINISTRATIVO', label: 'Administrativo', fee: 0 },
  { type: 'LABORAL', label: 'Laboral', fee: 0 },
  { type: 'CONTRATO', label: 'Contrato', fee: 0 },
  { type: 'SOCIETARIO', label: 'Societario', fee: 0 },
  { type: 'REGULATORIO', label: 'Regulatorio', fee: 0 },
  { type: 'OTRO', label: 'Otro', fee: 0 },
];

const LEGAL_AREA_OPTIONS = [
  ['PENAL', 'Penal'],
  ['CIVIL', 'Civil'],
  ['ADMINISTRATIVO', 'Administrativo'],
  ['LABORAL', 'Laboral'],
  ['CONSTITUCIONAL', 'Constitucional'],
  ['COMERCIAL', 'Comercial'],
  ['FAMILIA', 'Familia'],
  ['OTRO', 'Otro'],
];

const PROCESS_TYPES = {
  PENAL: ['Indagacion', 'Investigacion', 'Juicio oral', 'Incidente de reparacion', 'Ejecucion de penas', 'Otro'],
  CIVIL: ['Verbal', 'Verbal sumario', 'Ejecutivo', 'Responsabilidad civil', 'Pertenencia', 'Familia', 'Otro'],
  ADMINISTRATIVO: ['Reparacion directa', 'Nulidad y restablecimiento', 'Simple nulidad', 'Contractual', 'Tutela contra entidad', 'Derecho de peticion', 'Otro'],
  LABORAL: ['Ordinario laboral', 'Ejecutivo laboral', 'Seguridad social', 'Fuero sindical', 'Otro'],
  CONSTITUCIONAL: ['Tutela', 'Incidente de desacato', 'Cumplimiento', 'Popular/grupo', 'Otro'],
  COMERCIAL: ['Societario', 'Insolvencia', 'Competencia', 'Contrato comercial', 'Otro'],
  FAMILIA: ['Alimentos', 'Custodia', 'Divorcio', 'Union marital', 'Sucesion', 'Otro'],
  OTRO: ['Consulta', 'Concepto', 'Negociacion', 'Otro'],
};

const INTAKE_CHANNEL_FALLBACK = [
  { code: 'WHATSAPP', label: 'WhatsApp' },
  { code: 'EMAIL', label: 'Correo electronico' },
  { code: 'TELEFONO', label: 'Llamada telefonica' },
  { code: 'PRESENCIAL', label: 'Consulta presencial' },
  { code: 'REFERIDO', label: 'Referido por cliente' },
  { code: 'WEB', label: 'Formulario web' },
  { code: 'OTRO', label: 'Otro' },
];

const COMM_ICONS = { note: '◈', email: '✉', call: '☎', message: '◉', system: '⬡' };

const ACTUACION_TYPES = [
  'RADICACION', 'NOTIFICACION', 'RESPUESTA_ENTIDAD',
  'AUDIENCIA', 'FALLO', 'IMPUGNACION', 'RECURSO', 'SEGUIMIENTO', 'OTRO',
];
const ACTUACION_LABELS = {
  RADICACION: 'Radicación', NOTIFICACION: 'Notificación',
  RESPUESTA_ENTIDAD: 'Resp. entidad', AUDIENCIA: 'Audiencia',
  FALLO: 'Fallo', IMPUGNACION: 'Impugnación',
  RECURSO: 'Recurso', SEGUIMIENTO: 'Seguimiento', OTRO: 'Otro',
};

const PRIORITY_OPTIONS = ['CRITICA', 'ALTA', 'MEDIA', 'BAJA'];
const PRIORITY_LABELS  = { CRITICA: 'Crítica', ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' };
const PRIORITY_COLORS  = { CRITICA: '#E87A7A', ALTA: '#D4B84A', MEDIA: '#4A9ED4', BAJA: 'var(--text-muted)' };

const TASK_STATUS_OPTIONS = ['PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'];
const TASK_STATUS_LABELS  = { PENDIENTE: 'Pendiente', EN_CURSO: 'En curso', COMPLETADA: 'Completada', CANCELADA: 'Cancelada' };
const TASK_COLUMNS = [
  { status: 'PENDIENTE', title: 'Por hacer' },
  { status: 'EN_CURSO', title: 'En curso' },
  { status: 'COMPLETADA', title: 'Hechas' },
  { status: 'CANCELADA', title: 'Canceladas' },
];
const TASK_PRIORITY_ORDER = { CRITICA: 0, ALTA: 1, MEDIA: 2, BAJA: 3 };

const URGENCY_COLORS = { CRITICO: '#E87A7A', ALTO: '#D4B84A', MEDIO: '#4A9ED4', BAJO: 'var(--text-muted)' };
const SOURCE_TYPE_OPTIONS = [
  ['nota', 'Nota'],
  ['llamada', 'Llamada'],
  ['correo', 'Correo'],
  ['documento', 'Documento'],
  ['transcripcion', 'Transcripcion'],
  ['otro', 'Otro'],
];
const SUGGESTION_LABELS = {
  next_action: 'Siguiente actuacion',
  task: 'Tarea',
  deadline: 'Vencimiento',
  communication: 'Nota',
};

const DRIVE_CATEGORIES = [
  ['sin_clasificar', 'Sin clasificar'],
  ['ingreso', 'Ingreso'],
  ['cliente', 'Cliente'],
  ['actuacion', 'Actuacion'],
  ['prueba', 'Prueba'],
  ['comunicacion', 'Comunicacion'],
  ['borrador', 'Borrador'],
  ['firmado', 'Firmado'],
];
const DRIVE_CATEGORY_LABELS = Object.fromEntries(DRIVE_CATEGORIES);

const PROVIDER_LABELS = {
  openai: 'API IA',
  litert_lm: 'Gemma oficial local',
  ollama: 'Ollama local',
  local: 'Reglas locales',
};

const providerTone = (analysis) => {
  if (!analysis) return '#9A9FA3';
  if (analysis.provider_error || analysis.provider === 'local') return '#D4B84A';
  if (analysis.provider === 'litert_lm') return '#6EBA74';
  if (analysis.provider === 'ollama') return '#4A9ED4';
  return '#6EBA74';
};

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

const toLines = (value) => safeArray(value).join('\n');
const fromLines = (value) => String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
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

// ─── Sub-componentes ─────────────────────────────────────────

function SectionHeader({ title, action }) {
  return (
    <div className="detail-section-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{title}</span>
      {action}
    </div>
  );
}

function InlineForm({ show, onClose, children }) {
  if (!show) return null;
  return (
    <div style={{
      background: 'var(--bg-3)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: 'var(--sp-4)',
      marginBottom: 'var(--sp-3)',
    }}>
      {children}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose} type="button">Cancelar</button>
      </div>
    </div>
  );
}

function GmailTimelineCard({ communication, onDelete, deleting }) {
  const metadata = normalizeMetadata(communication.metadata);
  const subject = metadata.subject || '(sin asunto)';
  const body = extractGmailBody(communication.content, metadata.snippet);
  const emailDate = formatEmailDate(metadata.date);

  return (
    <article className="gmail-timeline-card">
      <div className="gmail-timeline-card-header">
        <div className="gmail-timeline-main">
          <div className="gmail-timeline-kicker">Correo importado</div>
          <div className="gmail-timeline-subject" title={subject}>{subject}</div>
        </div>
        <div className="gmail-timeline-actions">
          <span className="gmail-timeline-source">Gmail</span>
          <button
            type="button"
            className="btn btn-danger btn-sm gmail-timeline-delete"
            onClick={() => onDelete?.(communication)}
            disabled={deleting}
            title="Eliminar este correo importado del expediente"
          >
            {deleting ? '...' : 'Eliminar'}
          </button>
        </div>
      </div>

      <div className="gmail-timeline-route">
        <div>
          <span>De</span>
          <strong title={metadata.from || ''}>{metadata.from || 'Remitente no disponible'}</strong>
        </div>
        <div>
          <span>Para</span>
          <strong title={metadata.to || ''}>{metadata.to || 'Destinatario no disponible'}</strong>
        </div>
      </div>

      <div className="gmail-timeline-facts">
        {emailDate && <span>{emailDate}</span>}
        {metadata.gmail_thread_id && <span>Hilo {shortenId(metadata.gmail_thread_id)}</span>}
        {metadata.gmail_message_id && <span>Mensaje {shortenId(metadata.gmail_message_id)}</span>}
      </div>

      <details className="gmail-timeline-body">
        <summary>Ver contenido del correo</summary>
        <div className="gmail-timeline-body-text">{body || 'Sin contenido disponible.'}</div>
      </details>
    </article>
  );
}

function DriveDocumentSection({
  files,
  searchQuery,
  setSearchQuery,
  searchResults,
  selectedCategory,
  setSelectedCategory,
  loading,
  searching,
  linkingId,
  unlinkingId,
  error,
  driveWriteEnabled,
  onSearch,
  onLink,
  onUnlink,
}) {
  const linkedIds = new Set(files.map(file => file.drive_file_id));
  const folders = files.filter(isDriveFolder);
  const folderGroups = files.reduce((acc, file) => {
    const key = isDriveFolder(file) ? `folder:${file.drive_file_id}` : (file.parent_drive_file_id || 'root');
    const label = isDriveFolder(file) ? file.name : driveFolderLabel(file);
    if (!acc[key]) acc[key] = { key, label, folder: null, items: [] };
    if (isDriveFolder(file)) acc[key].folder = file;
    else acc[key].items.push(file);
    return acc;
  }, {});
  const groupedFiles = Object.values(folderGroups).sort((a, b) => {
    if (a.key === 'root') return -1;
    if (b.key === 'root') return 1;
    return a.label.localeCompare(b.label, 'es');
  });

  return (
    <div className="detail-section case-drive-section">
      <SectionHeader
        title="Expediente documental"
        action={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onSearch}
            disabled={searching}
          >
            {searching ? 'Buscando...' : 'Buscar en Drive'}
          </button>
        }
      />

      <div className="case-drive-readonly-note">
        <strong>{driveWriteEnabled ? 'Permisos de Drive completos activos' : 'Drive conectado en solo lectura'}</strong>
        <span>
          {driveWriteEnabled
            ? 'Este modulo opera el expediente documental con acceso completo a Drive. Vincular y desvincular aqui sigue siendo un cambio local del expediente.'
            : 'Vincular o desvincular aqui solo cambia el expediente local. No borra, mueve ni sube archivos en Google Drive.'}
        </span>
      </div>

      <div className="case-drive-search">
        <div className="case-drive-search-row">
          <input
            type="search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') onSearch(); }}
            placeholder="Buscar documentos en Drive por nombre"
          />
          <select
            value={selectedCategory}
            onChange={event => setSelectedCategory(event.target.value)}
            title="Categoria para nuevos vinculos"
          >
            {DRIVE_CATEGORIES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        {error && <div className="case-drive-error">{error}</div>}
      </div>

      {searchResults.length > 0 && (
        <div className="case-drive-results">
          <div className="case-drive-subtitle">Resultados de Drive</div>
          {searchResults.map(file => {
            const alreadyLinked = linkedIds.has(file.id);
            return (
              <div key={file.id} className="case-drive-row">
                <div className="case-drive-file-main">
                  <div className="case-drive-file-title" title={file.name}>{file.name}</div>
                  <div className="case-drive-file-meta">
                    <span>{formatDriveMime(file.mimeType)}</span>
                    <span>{formatDate(file.modifiedTime)}</span>
                    <span>{formatFileSize(file.size)}</span>
                  </div>
                </div>
                <div className="case-drive-actions">
                  {file.webViewLink && (
                    <a className="btn btn-ghost btn-sm" href={file.webViewLink} target="_blank" rel="noopener noreferrer">
                      Abrir
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => onLink(file)}
                    disabled={alreadyLinked || linkingId === file.id}
                  >
                    {alreadyLinked ? 'Vinculado' : linkingId === file.id ? 'Vinculando...' : 'Vincular'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="case-drive-linked">
        <div className="case-drive-subtitle">
          Archivos vinculados al caso
          {folders.length > 0 && (
            <span style={{ marginLeft: 'var(--sp-2)', color: 'var(--text-muted)', fontWeight: 400 }}>
              {folders.length} carpeta{folders.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {loading ? (
          <div className="case-drive-empty">Cargando expediente documental...</div>
        ) : files.length === 0 ? (
          <div className="case-drive-empty">Sin documentos Drive vinculados todavia.</div>
        ) : (
          groupedFiles.map(group => (
            <div key={group.key} style={{ marginBottom: 'var(--sp-3)' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--sp-2)',
                padding: '6px 0',
                color: 'var(--gold)',
                fontSize: '0.78rem',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}>
                <span>{group.label}</span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
                  {group.items.length} archivo{group.items.length === 1 ? '' : 's'}
                </span>
              </div>

              {group.folder && (
                <div className="case-drive-row case-drive-row-linked">
                  <div className="case-drive-file-main">
                    <div className="case-drive-file-title" title={group.folder.name}>Carpeta: {group.folder.name}</div>
                    <div className="case-drive-file-meta">
                      <span>{DRIVE_CATEGORY_LABELS[group.folder.category] || group.folder.category || 'Sin clasificar'}</span>
                      <span>Carpeta</span>
                      <span>Mod. {formatDate(group.folder.modified_time)}</span>
                    </div>
                  </div>
                  <div className="case-drive-actions">
                    {group.folder.web_view_link && (
                      <a className="btn btn-ghost btn-sm" href={group.folder.web_view_link} target="_blank" rel="noopener noreferrer">
                        Abrir
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onUnlink(group.folder)}
                      disabled={unlinkingId === group.folder.id}
                      title="Desvincular del expediente local sin modificar Google Drive"
                    >
                      {unlinkingId === group.folder.id ? 'Desvinculando...' : 'Desvincular'}
                    </button>
                  </div>
                </div>
              )}

              {group.items.map(file => (
                <div key={file.id} className="case-drive-row case-drive-row-linked">
                  <div className="case-drive-file-main">
                    <div className="case-drive-file-title" title={file.name}>{file.name}</div>
                    <div className="case-drive-file-meta">
                      <span>{DRIVE_CATEGORY_LABELS[file.category] || file.category || 'Sin clasificar'}</span>
                      <span>{formatDriveMime(file.mime_type)}</span>
                      <span>En {driveFolderLabel(file)}</span>
                      <span>Mod. {formatDate(file.modified_time)}</span>
                      <span>{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                  <div className="case-drive-actions">
                    {file.web_view_link && (
                      <a className="btn btn-ghost btn-sm" href={file.web_view_link} target="_blank" rel="noopener noreferrer">
                        Abrir
                      </a>
                    )}
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => onUnlink(file)}
                      disabled={unlinkingId === file.id}
                      title="Desvincular del expediente local sin modificar Google Drive"
                    >
                      {unlinkingId === file.id ? 'Desvinculando...' : 'Desvincular'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DeleteCommunicationDialog({ communication, onCancel, onConfirm, deleting }) {
  if (!communication) return null;

  const metadata = normalizeMetadata(communication.metadata);
  const gmailItem = isGmailCommunication(communication);
  const subject = metadata.subject || String(communication.content || 'Entrada de la linea de tiempo').split('\n')[0];

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content confirm-modal" onClick={e => e.stopPropagation()}>
        <div className="confirm-modal-mark">!</div>
        <div>
          <div className="confirm-modal-eyebrow">Eliminar de la linea de tiempo</div>
          <h3 className="confirm-modal-title">{subject}</h3>
          <p className="confirm-modal-copy">
            {gmailItem
              ? 'Esta accion elimina la comunicacion del expediente. El mensaje original se conserva en Gmail.'
              : 'Esta accion elimina esta entrada del expediente. No modifica otros registros del caso.'}
          </p>
        </div>
        <div className="confirm-modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={deleting}>
            Cancelar
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={deleting}>
            {deleting ? 'Eliminando...' : 'Eliminar entrada'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskKanbanCard({ task, onOpen, onDragStart }) {
  return (
    <article
      draggable
      onDragStart={(event) => onDragStart(event, task)}
      onClick={() => onOpen(task)}
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
        borderRadius: 'var(--radius)',
        padding: 'var(--sp-2)',
        cursor: 'grab',
        marginBottom: 'var(--sp-2)',
      }}
    >
      <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>{task.title}</div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.66rem', color: PRIORITY_COLORS[task.priority] || 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
          {PRIORITY_LABELS[task.priority] || task.priority}
        </span>
        {task.due_date && (
          <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
            {formatDate(task.due_date)}
          </span>
        )}
      </div>
      {task.context && (
        <div style={{
          marginTop: '5px',
          fontSize: '0.68rem',
          color: 'var(--text-secondary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }} title={task.context}>
          {task.context}
        </div>
      )}
    </article>
  );
}

// ─── Componente principal ─────────────────────────────────────

function SalaCaseHeader({
  c,
  tareasPendientes,
  vencimientosAbiertos,
  latestAnalysis,
  comms,
  driveFiles,
  onOpenSala,
  onOpenGmail,
  onNavigate,
}) {
  const overdueDeadlines = vencimientosAbiertos.filter(v => diasHasta(v.due_date) !== null && diasHasta(v.due_date) < 0);
  const nearDeadlines = vencimientosAbiertos.filter(v => {
    const days = diasHasta(v.due_date);
    return days !== null && days >= 0 && days <= 3;
  });
  const salaStatus = latestAnalysis ? 'activo' : 'prototipo';
  const riskLabel = overdueDeadlines.length > 0
    ? `${overdueDeadlines.length} vencimiento${overdueDeadlines.length === 1 ? '' : 's'} vencido${overdueDeadlines.length === 1 ? '' : 's'}`
    : nearDeadlines.length > 0
      ? `${nearDeadlines.length} vencimiento${nearDeadlines.length === 1 ? '' : 's'} en 72h`
      : !c.next_action
        ? 'Sin siguiente accion'
        : 'Seguimiento controlado';
  const riskStatus = overdueDeadlines.length > 0
    ? 'bloqueado'
    : nearDeadlines.length > 0 || !c.next_action
      ? 'manual_asistido'
      : 'activo';
  const faltantes = [
    !latestAnalysis ? 'Convocar Sala con insumo reciente' : null,
    !c.next_action ? 'Definir proxima mejor accion' : null,
    driveFiles.length === 0 ? 'Vincular evidencia documental' : null,
    vencimientosAbiertos.length === 0 ? 'Confirmar si existen terminos abiertos' : null,
  ].filter(Boolean);
  const nextAction = c.next_action || 'Convocar Sala para diagnosticar riesgos, faltantes y plan sugerido.';

  return (
    <section className="sala-case-header">
      <div className="sala-case-main">
        <div className="sala-case-kicker">Sala del Caso</div>
        <h1>{c.title.length > 92 ? `${c.title.slice(0, 92)}...` : c.title}</h1>
        <div className="sala-case-meta">
          <span className="case-number">{c.case_number}</span>
          <span className={`badge badge-${c.service_type?.toLowerCase()}`}>{c.service_type}</span>
          <span>{c.client_name}</span>
          <CapabilityStatus status={salaStatus} compact />
        </div>
      </div>

      <div className="sala-case-grid">
        <div className="sala-case-panel">
          <span>Riesgo actual</span>
          <strong>{riskLabel}</strong>
          <CapabilityStatus status={riskStatus} compact />
        </div>
        <div className="sala-case-panel wide">
          <span>Proxima mejor accion</span>
          <strong>{nextAction}</strong>
        </div>
        <div className="sala-case-panel">
          <span>Fuentes recientes</span>
          <strong>{comms.length} comunicaciones - {driveFiles.length} documentos</strong>
          <small>{latestAnalysis ? `Ultimo analisis: ${formatDateTime(latestAnalysis.created_at)}` : 'Analisis por convocar'}</small>
        </div>
        <div className="sala-case-panel">
          <span>Faltantes</span>
          <strong>{faltantes.length || 'Sin faltantes criticos visibles'}</strong>
          <small>{faltantes[0] || 'Mantener rastro y revisar proximo cambio.'}</small>
        </div>
      </div>

      <div className="sala-case-actions">
        <button className="btn btn-primary btn-sm" type="button" onClick={onOpenSala}>
          Convocar Sala
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={onOpenGmail}>
          Actualizar Gmail
        </button>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onNavigate('/planes')}>
          Crear plan
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => onNavigate('/aprobaciones')}>
          Ver autorizaciones
        </button>
      </div>
    </section>
  );
}

export default function CaseDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const { user }  = useAuth();

  // ── Core
  const [caseData,    setCaseData]    = useState(null);
  const [comms,       setComms]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [caseOptions, setCaseOptions] = useState({
    service_types: SERVICE_TYPE_OPTIONS,
    intake_channels: INTAKE_CHANNEL_FALLBACK,
    users: [],
  });
  const [editCaseInfo, setEditCaseInfo] = useState(false);
  const [caseDraft, setCaseDraft] = useState(null);
  const [savingCaseInfo, setSavingCaseInfo] = useState(false);

  // ── Actuaciones
  const [actuaciones,      setActuaciones]      = useState([]);
  const [showActForm,      setShowActForm]       = useState(false);
  const [newAct,           setNewAct]            = useState({ type: 'SEGUIMIENTO', title: '', scheduled_at: '', radicado: '', description: '' });
  const [completingAct,    setCompletingAct]     = useState(null); // id de la actuación a completar
  const [actResult,        setActResult]         = useState('');
  const [savingAct,        setSavingAct]         = useState(false);

  // ── Tareas
  const [tareas,       setTareas]       = useState([]);
  const [taskColumns,  setTaskColumns]  = useState([]);
  const [showTareaForm, setShowTareaForm] = useState(false);
  const [newTarea,     setNewTarea]     = useState({
    title: '',
    column_id: '',
    priority: 'MEDIA',
    status: 'PENDIENTE',
    due_date: '',
    description: '',
    context: '',
    required_inputs_text: '',
    attachment_refs_text: '',
    checklist_text: '',
    blocked_reason: '',
    estimated_minutes: '',
  });
  const [savingTarea,  setSavingTarea]  = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState(null);
  const [taskDetailOpen, setTaskDetailOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState(null);
  const [taskLinks, setTaskLinks] = useState([]);
  const [taskSources, setTaskSources] = useState({ drive_files: [], emails: [] });
  const [taskLinksLoading, setTaskLinksLoading] = useState(false);
  const [selectedDriveLinkId, setSelectedDriveLinkId] = useState('');
  const [selectedEmailId, setSelectedEmailId] = useState('');

  // ── Vencimientos
  const [vencimientos, setVencimientos] = useState([]);
  const [showVencimientoForm, setShowVencimientoForm] = useState(false);
  const [newVencimiento, setNewVencimiento] = useState({ title: '', due_date: '', urgency: 'MEDIO' });
  const [savingVencimiento, setSavingVencimiento] = useState(false);

  // ── Comunicaciones
  const [commText,    setCommText]    = useState('');
  const [commType,    setCommType]    = useState('note');
  const [savingComm,  setSavingComm]  = useState(false);
  const [gmailModalOpen, setGmailModalOpen] = useState(false);
  const [deletingCommId, setDeletingCommId] = useState(null);
  const [commPendingDelete, setCommPendingDelete] = useState(null);

  // Drive documental
  const [driveFiles, setDriveFiles] = useState([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveSearchQuery, setDriveSearchQuery] = useState('');
  const [driveSearchResults, setDriveSearchResults] = useState([]);
  const [driveCategory, setDriveCategory] = useState('sin_clasificar');
  const [driveSearching, setDriveSearching] = useState(false);
  const [driveLinkingId, setDriveLinkingId] = useState(null);
  const [driveUnlinkingId, setDriveUnlinkingId] = useState(null);
  const [driveError, setDriveError] = useState('');
  const [driveWriteEnabled, setDriveWriteEnabled] = useState(false);

  // Integraciones judiciales
  const [judicialLinks, setJudicialLinks] = useState([]);
  const [judicialLoading, setJudicialLoading] = useState(false);

  // ── Siguiente actuación (edición inline)
  const [editNext,        setEditNext]        = useState(false);
  const [nextAction,      setNextAction]      = useState('');
  const [nextActionDate,  setNextActionDate]  = useState('');

  // ── Sala / IA
  const [aiAnalyses,       setAiAnalyses]       = useState([]);
  const [salaText,         setSalaText]         = useState('');
  const [salaSourceType,   setSalaSourceType]   = useState('nota');
  const [analyzingSala,    setAnalyzingSala]    = useState(false);
  const [applyingSuggestion, setApplyingSuggestion] = useState(null);
  const [salaError,        setSalaError]        = useState('');

  // ─── Carga de datos ──────────────────────────────────────

  const loadCase = useCallback(async () => {
    try {
      const [c, cm, acts, tar, venc, analyses, columnsRes] = await Promise.all([
        api.get(`/cases/${id}`),
        api.get(`/cases/${id}/communications`),
        api.get(`/cases/${id}/actuaciones`),
        api.get(`/cases/${id}/tareas`),
        api.get(`/cases/${id}/vencimientos`),
        api.get(`/cases/${id}/ai/analyses`),
        api.get('/tareas/columns'),
      ]);
      setCaseData(c.data);
      setNextAction(c.data.next_action || '');
      setNextActionDate(c.data.next_action_date ? c.data.next_action_date.slice(0, 10) : '');
      setComms(cm.data);
      setActuaciones(acts.data);
      setTareas(tar.data);
      setTaskColumns(Array.isArray(columnsRes.data) ? columnsRes.data : []);
      setVencimientos(venc.data);
      setAiAnalyses(analyses.data);
    } catch (err) {
      if (err.response?.status === 404) navigate('/cases');
    }
  }, [id, navigate]);

  const loadDriveFiles = useCallback(async () => {
    setDriveLoading(true);
    setDriveError('');
    try {
      const res = await api.get(`/cases/${id}/drive/files`);
      setDriveFiles(res.data.files || []);
    } catch (err) {
      setDriveError(err.response?.data?.error || 'No fue posible cargar los archivos Drive del caso.');
    } finally {
      setDriveLoading(false);
    }
  }, [id]);

  const loadGoogleStatus = useCallback(async () => {
    try {
      const res = await api.get('/google/status');
      setDriveWriteEnabled(Boolean(res.data?.drive_write_enabled));
    } catch {
      setDriveWriteEnabled(false);
    }
  }, []);

  const loadJudicialLinks = useCallback(async () => {
    setJudicialLoading(true);
    try {
      const res = await api.get(`/judicial-integrations/cases/${id}/links`);
      setJudicialLinks(res.data.links || []);
    } catch {
      setJudicialLinks([]);
    } finally {
      setJudicialLoading(false);
    }
  }, [id]);

  const loadCaseOptions = useCallback(async () => {
    try {
      const res = await api.get('/cases/options');
      setCaseOptions({
        service_types: Array.isArray(res.data?.service_types) ? res.data.service_types : SERVICE_TYPE_OPTIONS,
        intake_channels: Array.isArray(res.data?.intake_channels) ? res.data.intake_channels : INTAKE_CHANNEL_FALLBACK,
        users: Array.isArray(res.data?.users) ? res.data.users : [],
      });
    } catch {
      setCaseOptions(prev => ({ ...prev, service_types: SERVICE_TYPE_OPTIONS, intake_channels: INTAKE_CHANNEL_FALLBACK }));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadCase().finally(() => setLoading(false));
  }, [loadCase]);

  // Auto-refresh tras mutación del agente Phi: cuando el panel agéntico ejecuta
  // create_task, update_case, add_communication, etc., el AgentContext dispara
  // window.event "phi-mutation". Refetchamos el caso para reflejar los cambios.
  useEffect(() => {
    const handler = () => { loadCase(); };
    window.addEventListener('phi-mutation', handler);
    return () => window.removeEventListener('phi-mutation', handler);
  }, [loadCase]);

  // F5 — riel por dominio: el panel de Phi muestra contexto + acciones de ESTE
  // caso. Los prompts incluyen el número de caso para que Phi sepa sobre cuál.
  useScreenContext(
    caseData
      ? {
          label: `${caseData.case_number}${caseData.title ? ` · ${caseData.title}` : ''}`,
          actions: [
            { label: 'Diagnóstico', prompt: `Dame un diagnóstico operativo del caso ${caseData.case_number}: tareas, vencimientos, documentos faltantes y la siguiente acción sugerida.` },
            { label: 'Organizar expediente', prompt: `Revisa el expediente del caso ${caseData.case_number} y propón cómo organizar documentos, soportes faltantes y tareas derivadas.` },
            { label: 'Priorizar', prompt: `Cruza tareas, vencimientos y correos del caso ${caseData.case_number} para priorizar la semana.` },
            { label: 'Siguiente actuación', prompt: `Con el contexto del caso ${caseData.case_number}, propón la siguiente actuación procesal y los riesgos a vigilar.` },
          ],
        }
      : null,
    [caseData?.id, caseData?.case_number],
  );

  useEffect(() => {
    loadDriveFiles();
  }, [loadDriveFiles]);

  useEffect(() => {
    loadGoogleStatus();
  }, [loadGoogleStatus]);

  useEffect(() => {
    loadJudicialLinks();
  }, [loadJudicialLinks]);

  useEffect(() => {
    loadCaseOptions();
  }, [loadCaseOptions]);

  useEffect(() => {
    if (!newTarea.column_id && taskColumns.length > 0) {
      setNewTarea(prev => ({ ...prev, column_id: String(taskColumns[0].id), status: taskColumns[0].base_status || 'PENDIENTE' }));
    }
  }, [taskColumns, newTarea.column_id]);

  // ─── Caso: estado y honorarios ───────────────────────────

  const handleStatusChange = async (newStatus) => {
    try {
      const res = await api.put(`/cases/${id}`, { status: newStatus });
      setCaseData(res.data);
      const cm = await api.get(`/cases/${id}/communications`);
      setComms(cm.data);
    } catch (err) { console.error(err); }
  };

  const handleFeePaid = async (paid) => {
    try {
      const res = await api.put(`/cases/${id}`, { fee_paid: paid });
      setCaseData(res.data);
    } catch (err) { console.error(err); }
  };

  const openCaseInfoEditor = () => {
    setCaseDraft({
      case_number: c.case_number || '',
      title: c.title || '',
      service_type: c.service_type || '',
      legal_area: c.legal_area || c.service_type || '',
      process_type: c.process_type || '',
      entity: c.entity || '',
      intake_channel: c.intake_channel || '',
      filing_date: c.filing_date ? c.filing_date.slice(0, 10) : '',
      response_deadline: c.response_deadline ? c.response_deadline.slice(0, 10) : '',
      assigned_to: c.assigned_to || '',
      drive_folder_id: c.drive_folder_id || '',
      description: c.description || '',
      fee: c.fee ?? '',
    });
    setEditCaseInfo(true);
  };

  const saveCaseInfo = async () => {
    if (!caseDraft?.title || !caseDraft?.service_type) return;
    setSavingCaseInfo(true);
    try {
      const res = await api.put(`/cases/${id}`, {
        case_number: caseDraft.case_number,
        title: caseDraft.title,
        service_type: caseDraft.service_type,
        legal_area: caseDraft.legal_area || null,
        process_type: caseDraft.process_type || null,
        entity: caseDraft.entity || null,
        intake_channel: caseDraft.intake_channel || null,
        filing_date: caseDraft.filing_date || null,
        response_deadline: caseDraft.response_deadline || null,
        assigned_to: caseDraft.assigned_to || null,
        drive_folder_id: caseDraft.drive_folder_id || null,
        description: caseDraft.description || null,
        fee: caseDraft.fee === '' ? 0 : Number(caseDraft.fee),
      });
      setCaseData(res.data);
      setEditCaseInfo(false);
    } catch (err) {
      alert(err.response?.data?.error || 'No fue posible guardar la informacion del caso.');
    } finally {
      setSavingCaseInfo(false);
    }
  };

  const handleSaveNextAction = async () => {
    try {
      const res = await api.put(`/cases/${id}`, {
        next_action: nextAction || null,
        next_action_date: nextActionDate || null,
      });
      setCaseData(res.data);
      setEditNext(false);
    } catch (err) { console.error(err); }
  };

  const handleCompleteNextAction = async () => {
    if (!c.next_action) return;
    try {
      const completed = c.next_action;
      const res = await api.put(`/cases/${id}`, { next_action: null, next_action_date: null });
      await api.post(`/cases/${id}/communications`, {
        type: 'note',
        content: `Siguiente actuacion completada: ${completed}`,
      });
      const cm = await api.get(`/cases/${id}/communications`);
      setCaseData(res.data);
      setNextAction('');
      setNextActionDate('');
      setComms(cm.data);
    } catch (err) { console.error(err); }
  };

  const handleClearNextAction = async () => {
    if (!confirm('Quitar la siguiente actuacion del caso?')) return;
    try {
      const res = await api.put(`/cases/${id}`, { next_action: null, next_action_date: null });
      setCaseData(res.data);
      setNextAction('');
      setNextActionDate('');
    } catch (err) { console.error(err); }
  };

  const handleSearchDrive = async () => {
    setDriveSearching(true);
    setDriveError('');
    try {
      const res = await api.get('/drive/files', {
        params: {
          query: buildDriveSearchQuery(driveSearchQuery),
          pageSize: 12,
        },
      });
      setDriveSearchResults(res.data.files || []);
    } catch (err) {
      setDriveError(err.response?.data?.error || 'No fue posible buscar en Drive.');
    } finally {
      setDriveSearching(false);
    }
  };

  const handleLinkDriveFile = async (file) => {
    if (!file?.id) return;
    setDriveLinkingId(file.id);
    setDriveError('');
    try {
      const res = await api.post(`/cases/${id}/drive/link`, {
        drive_file_id: file.id,
        category: driveCategory,
      });
      const linked = res.data.file;
      setDriveFiles(prev => {
        const exists = prev.some(item => item.id === linked.id || item.drive_file_id === linked.drive_file_id);
        return exists
          ? prev.map(item => (item.id === linked.id || item.drive_file_id === linked.drive_file_id ? linked : item))
          : [linked, ...prev];
      });
    } catch (err) {
      setDriveError(err.response?.data?.error || 'No fue posible vincular el archivo Drive.');
    } finally {
      setDriveLinkingId(null);
    }
  };

  const handleUnlinkDriveFile = async (file) => {
    if (!file?.id) return;
    setDriveUnlinkingId(file.id);
    setDriveError('');
    try {
      await api.delete(`/cases/${id}/drive/files/${file.id}`);
      setDriveFiles(prev => prev.filter(item => item.id !== file.id));
    } catch (err) {
      setDriveError(err.response?.data?.error || 'No fue posible desvincular el archivo Drive.');
    } finally {
      setDriveUnlinkingId(null);
    }
  };

  const handleAnalyzeSala = async () => {
    if (salaText.trim().length < 20) {
      setSalaError('Ingresa al menos 20 caracteres para que la Sala pueda analizar.');
      return;
    }
    setAnalyzingSala(true);
    setSalaError('');
    try {
      const res = await api.post(`/cases/${id}/ai/analyze`, {
        source_text: salaText.trim(),
        source_type: salaSourceType,
      }, {
        timeout: 120000,
      });
      setAiAnalyses(prev => [res.data, ...prev]);
      setSalaText('');
      const cm = await api.get(`/cases/${id}/communications`);
      setComms(cm.data);
    } catch (err) {
      setSalaError(err.response?.data?.error || 'No fue posible generar el analisis.');
    } finally {
      setAnalyzingSala(false);
    }
  };

  const handleApplySuggestion = async (analysisId, suggestionId) => {
    setApplyingSuggestion(suggestionId);
    setSalaError('');
    try {
      await api.post(`/cases/${id}/ai/analyses/${analysisId}/apply`, {
        suggestion_ids: [suggestionId],
      });
      const [c, cm, tar, venc, analyses] = await Promise.all([
        api.get(`/cases/${id}`),
        api.get(`/cases/${id}/communications`),
        api.get(`/cases/${id}/tareas`),
        api.get(`/cases/${id}/vencimientos`),
        api.get(`/cases/${id}/ai/analyses`),
      ]);
      setCaseData(c.data);
      setNextAction(c.data.next_action || '');
      setNextActionDate(c.data.next_action_date ? c.data.next_action_date.slice(0, 10) : '');
      setComms(cm.data);
      setTareas(tar.data);
      setVencimientos(venc.data);
      setAiAnalyses(analyses.data);
    } catch (err) {
      setSalaError(err.response?.data?.error || 'No fue posible aplicar la sugerencia.');
    } finally {
      setApplyingSuggestion(null);
    }
  };

  // ─── Actuaciones ─────────────────────────────────────────

  const handleAddActuacion = async (e) => {
    e.preventDefault();
    if (!newAct.title.trim()) return;
    setSavingAct(true);
    try {
      const res = await api.post(`/cases/${id}/actuaciones`, newAct);
      setActuaciones(prev => [...prev, res.data]);
      setNewAct({ type: 'SEGUIMIENTO', title: '', scheduled_at: '', radicado: '', description: '' });
      setShowActForm(false);
      // Refrescar comms y vencimientos (el backend los crea automáticamente)
      const [cm, venc] = await Promise.all([
        api.get(`/cases/${id}/communications`),
        api.get(`/cases/${id}/vencimientos`),
      ]);
      setComms(cm.data);
      setVencimientos(venc.data);
    } catch (err) { console.error(err); }
    finally { setSavingAct(false); }
  };

  const handleCompleteActuacion = async (actId) => {
    setSavingAct(true);
    try {
      const res = await api.put(`/cases/${id}/actuaciones/${actId}`, {
        completed_at: new Date().toISOString(),
        result: actResult || null,
      });
      setActuaciones(prev => prev.map(a => a.id === actId ? res.data : a));
      setCompletingAct(null);
      setActResult('');
      const [cm, venc] = await Promise.all([
        api.get(`/cases/${id}/communications`),
        api.get(`/cases/${id}/vencimientos`),
      ]);
      setComms(cm.data);
      setVencimientos(venc.data);
    } catch (err) { console.error(err); }
    finally { setSavingAct(false); }
  };

  const handleDeleteActuacion = async (actId) => {
    if (!confirm('¿Eliminar esta actuación? También se eliminarán sus vencimientos asociados.')) return;
    try {
      await api.delete(`/cases/${id}/actuaciones/${actId}`);
      setActuaciones(prev => prev.filter(a => a.id !== actId));
      const venc = await api.get(`/cases/${id}/vencimientos`);
      setVencimientos(venc.data);
    } catch (err) {
      const msg = err.response?.data?.error || 'Error al eliminar';
      alert(msg);
    }
  };

  // ─── Tareas ──────────────────────────────────────────────

  const handleAddTarea = async (e) => {
    e.preventDefault();
    if (!newTarea.title.trim()) return;
    setSavingTarea(true);
    try {
      const colId = Number(newTarea.column_id || 0);
      const nextPosition = (tareasPorColumna[colId] || []).length;
      const res = await api.post(`/cases/${id}/tareas`, {
        title: newTarea.title.trim(),
        description: newTarea.description || null,
        context: newTarea.context || null,
        priority: newTarea.priority,
        board_column_id: colId || null,
        due_date: newTarea.due_date || null,
        required_inputs: fromLines(newTarea.required_inputs_text),
        attachment_refs: fromLines(newTarea.attachment_refs_text),
        checklist: normalizeChecklist(fromLines(newTarea.checklist_text)),
        blocked_reason: newTarea.blocked_reason || null,
        estimated_minutes: newTarea.estimated_minutes ? Number(newTarea.estimated_minutes) : null,
        position: nextPosition,
      });
      setTareas(prev => [...prev, res.data]);
      setNewTarea({
        title: '',
        column_id: taskColumns[0] ? String(taskColumns[0].id) : '',
        priority: 'MEDIA',
        status: 'PENDIENTE',
        due_date: '',
        description: '',
        context: '',
        required_inputs_text: '',
        attachment_refs_text: '',
        checklist_text: '',
        blocked_reason: '',
        estimated_minutes: '',
      });
      setShowTareaForm(false);
      if (res.data?.due_date) {
        const venc = await api.get(`/cases/${id}/vencimientos`);
        setVencimientos(venc.data);
      }
    } catch (err) { console.error(err); }
    finally { setSavingTarea(false); }
  };

  const handleTaskDragStart = (event, tarea) => {
    event.dataTransfer.setData('text/plain', String(tarea.id));
    event.dataTransfer.effectAllowed = 'move';
    setDraggingTaskId(tarea.id);
  };

  const handleDropTaskColumn = async (event, column) => {
    event.preventDefault();
    const raw = event.dataTransfer.getData('text/plain');
    const tareaId = Number(raw);
    if (!tareaId || !column?.id) return;

    const targetTasks = tareasPorColumna[column.id] || [];
    const nextPosition = targetTasks.length;
    setTareas(prev => prev.map(t =>
      t.id === tareaId ? { ...t, board_column_id: column.id, status: column.base_status, position: nextPosition } : t
    ));

    try {
      const res = await api.put(`/tareas/${tareaId}`, { board_column_id: column.id, position: nextPosition });
      setTareas(prev => prev.map(t => t.id === tareaId ? { ...t, ...res.data } : t));
      if (column.base_status === 'COMPLETADA') {
        const [cm, venc] = await Promise.all([
          api.get(`/cases/${id}/communications`),
          api.get(`/cases/${id}/vencimientos`),
        ]);
        setComms(cm.data);
        setVencimientos(venc.data);
      }
    } catch (err) {
      console.error(err);
      await loadCase();
    } finally {
      setDraggingTaskId(null);
    }
  };

  const openTaskDetail = (tarea) => {
    const matchedColumnId = tarea.board_column_id || taskColumns.find(col => col.base_status === tarea.status)?.id || '';
    setTaskDraft({
      ...tarea,
      due_date: tarea.due_date ? String(tarea.due_date).slice(0, 10) : '',
      board_column_id: String(matchedColumnId),
      required_inputs_text: toLines(tarea.required_inputs),
      attachment_refs_text: toLines(tarea.attachment_refs),
      checklist_text: toLines(tarea.checklist),
      checklistItems: normalizeChecklist(tarea.checklist),
      estimated_minutes: tarea.estimated_minutes || '',
    });
    setTaskDetailOpen(true);
    setTaskLinks([]);
    setTaskSources({ drive_files: [], emails: [] });
    setSelectedDriveLinkId('');
    setSelectedEmailId('');
    (async () => {
      setTaskLinksLoading(true);
      try {
        const [linksRes, sourcesRes] = await Promise.all([
          api.get(`/tareas/${tarea.id}/links`),
          api.get(`/tareas/${tarea.id}/link-sources`),
        ]);
        setTaskLinks(Array.isArray(linksRes.data) ? linksRes.data : []);
        setTaskSources({
          drive_files: Array.isArray(sourcesRes.data?.drive_files) ? sourcesRes.data.drive_files : [],
          emails: Array.isArray(sourcesRes.data?.emails) ? sourcesRes.data.emails : [],
        });
      } catch (err) {
        console.error(err);
      } finally {
        setTaskLinksLoading(false);
      }
    })();
  };

  const addChecklistItem = () => {
    const text = prompt('Nuevo item de checklist:');
    if (!text || !text.trim()) return;
    setTaskDraft(prev => ({ ...prev, checklistItems: [...(prev.checklistItems || []), { id: `item_${Date.now()}`, text: text.trim(), done: false }] }));
  };

  const toggleChecklistItem = (itemId) => {
    setTaskDraft(prev => ({
      ...prev,
      checklistItems: (prev.checklistItems || []).map(item => (item.id === itemId ? { ...item, done: !item.done } : item)),
    }));
  };

  const removeChecklistItem = (itemId) => {
    setTaskDraft(prev => ({ ...prev, checklistItems: (prev.checklistItems || []).filter(item => item.id !== itemId) }));
  };

  const refreshTaskLinks = async (taskId) => {
    const [linksRes, sourcesRes] = await Promise.all([
      api.get(`/tareas/${taskId}/links`),
      api.get(`/tareas/${taskId}/link-sources`),
    ]);
    setTaskLinks(Array.isArray(linksRes.data) ? linksRes.data : []);
    setTaskSources({
      drive_files: Array.isArray(sourcesRes.data?.drive_files) ? sourcesRes.data.drive_files : [],
      emails: Array.isArray(sourcesRes.data?.emails) ? sourcesRes.data.emails : [],
    });
  };

  const attachDriveToTask = async (role) => {
    if (!taskDraft?.id || !selectedDriveLinkId) return;
    setSavingTarea(true);
    try {
      await api.post(`/tareas/${taskDraft.id}/links/drive`, { drive_link_id: Number(selectedDriveLinkId), role });
      await refreshTaskLinks(taskDraft.id);
      await loadCase();
    } catch (err) {
      alert(err.response?.data?.error || 'No fue posible vincular el archivo de Drive.');
    } finally {
      setSavingTarea(false);
    }
  };

  const attachEmailToTask = async () => {
    if (!taskDraft?.id || !selectedEmailId) return;
    setSavingTarea(true);
    try {
      await api.post(`/tareas/${taskDraft.id}/links/email`, { communication_id: Number(selectedEmailId), role: 'evidence' });
      await refreshTaskLinks(taskDraft.id);
      await loadCase();
    } catch (err) {
      alert(err.response?.data?.error || 'No fue posible vincular el correo.');
    } finally {
      setSavingTarea(false);
    }
  };

  const unlinkTaskLink = async (linkId) => {
    if (!taskDraft?.id) return;
    setSavingTarea(true);
    try {
      await api.delete(`/tareas/${taskDraft.id}/links/${linkId}`);
      await refreshTaskLinks(taskDraft.id);
      await loadCase();
    } catch (err) {
      console.error(err);
    } finally {
      setSavingTarea(false);
    }
  };

  const saveTaskDetail = async () => {
    if (!taskDraft?.id) return;
    setSavingTarea(true);
    try {
      const res = await api.put(`/tareas/${taskDraft.id}`, {
        title: taskDraft.title,
        description: taskDraft.description || null,
        context: taskDraft.context || null,
        priority: taskDraft.priority,
        board_column_id: Number(taskDraft.board_column_id || 0) || null,
        due_date: taskDraft.due_date || null,
        required_inputs: fromLines(taskDraft.required_inputs_text),
        attachment_refs: fromLines(taskDraft.attachment_refs_text),
        checklist: (taskDraft.checklistItems || []).map((item, index) => ({ id: item.id || `item_${index}`, text: item.text, done: Boolean(item.done) })),
        blocked_reason: taskDraft.blocked_reason || null,
        estimated_minutes: taskDraft.estimated_minutes ? Number(taskDraft.estimated_minutes) : null,
      });
      setTareas(prev => prev.map(t => t.id === taskDraft.id ? { ...t, ...res.data } : t));
      setTaskDraft(prev => ({ ...prev, ...res.data }));
    } catch (err) {
      console.error(err);
    } finally {
      setSavingTarea(false);
    }
  };

  const handleDeleteTarea = async (tareaId) => {
    if (!confirm('Eliminar esta tarea?')) return;
    try {
      await api.delete(`/tareas/${tareaId}`);
      setTareas(prev => prev.filter(t => t.id !== tareaId));
      setTaskDetailOpen(false);
      setTaskDraft(null);
      const venc = await api.get(`/cases/${id}/vencimientos`);
      setVencimientos(venc.data);
    } catch (err) { console.error(err); }
  };

  // ─── Vencimientos ────────────────────────────────────────

  const handleResolveVencimiento = async (vencId) => {
    try {
      const res = await api.put(`/vencimientos/${vencId}/resolve`);
      setVencimientos(prev => prev.map(v => v.id === vencId ? res.data : v));
    } catch (err) { console.error(err); }
  };

  const handleAddVencimiento = async (event) => {
    event.preventDefault();
    if (!newVencimiento.title.trim() || !newVencimiento.due_date) return;
    setSavingVencimiento(true);
    try {
      const res = await api.post(`/cases/${id}/vencimientos`, {
        title: newVencimiento.title.trim(),
        due_date: newVencimiento.due_date,
        urgency: newVencimiento.urgency,
      });
      setVencimientos(prev => [...prev, res.data]);
      setNewVencimiento({ title: '', due_date: '', urgency: 'MEDIO' });
      setShowVencimientoForm(false);
    } catch (err) {
      alert(err.response?.data?.error || 'No fue posible registrar el vencimiento.');
    } finally {
      setSavingVencimiento(false);
    }
  };

  // ─── Comunicaciones ──────────────────────────────────────

  const handleAddComm = async () => {
    if (!commText.trim()) return;
    setSavingComm(true);
    try {
      const res = await api.post(`/cases/${id}/communications`, { type: commType, content: commText.trim() });
      setComms(prev => [...prev, res.data]);
      setCommText('');
    } catch (err) { console.error(err); }
    finally { setSavingComm(false); }
  };

  const requestDeleteCommunication = (communication) => {
    setCommPendingDelete(communication);
  };

  const confirmDeleteCommunication = async () => {
    const communication = commPendingDelete;
    if (!communication) return;
    setDeletingCommId(communication.id);
    try {
      await api.delete(`/cases/${id}/communications/${communication.id}`);
      setComms(prev => prev.filter(cm => cm.id !== communication.id));
      setCommPendingDelete(null);
    } catch (err) {
      alert(err.response?.data?.error || 'No fue posible eliminar la comunicacion.');
    } finally {
      setDeletingCommId(null);
    }
  };

  // ─── Render ───────────────────────────────────────────────

  if (loading) return <div className="loading">Cargando caso…</div>;
  if (!caseData) return null;

  const c = caseData;
  const tareasPendientes = tareas.filter(t => t.status !== 'COMPLETADA' && t.status !== 'CANCELADA');
  const vencimientosAbiertos = vencimientos.filter(v => !v.resolved);
  const diasNextAction = diasHasta(c.next_action_date);
  const latestAnalysis = aiAnalyses[0];
  const latestProviderLabel = latestAnalysis
    ? `${PROVIDER_LABELS[latestAnalysis.provider] || latestAnalysis.provider || 'Local'}${latestAnalysis.model ? ` · ${latestAnalysis.model}` : ''}`
    : '';
  const tareasOrdenadas = [...tareas].sort((a, b) => {
    if (a.board_column_id !== b.board_column_id) return 0;
    const posA = Number.isFinite(Number(a.position)) ? Number(a.position) : 0;
    const posB = Number.isFinite(Number(b.position)) ? Number(b.position) : 0;
    if (posA !== posB) return posA - posB;
    const pa = TASK_PRIORITY_ORDER[a.priority] ?? 9;
    const pb = TASK_PRIORITY_ORDER[b.priority] ?? 9;
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
  const visibleTaskColumns = taskColumns.length > 0 ? taskColumns : TASK_COLUMNS.map((col, index) => ({ id: `legacy_${index}`, title: col.title, base_status: col.status }));
  const columnIds = new Set(visibleTaskColumns.map(col => col.id));
  const tareasPorColumna = visibleTaskColumns.reduce((acc, col) => {
    acc[col.id] = [];
    return acc;
  }, {});
  for (const task of tareasOrdenadas) {
    const ownColumn = columnIds.has(task.board_column_id) ? task.board_column_id : null;
    const fallback = visibleTaskColumns.find(col => col.base_status === task.status)?.id || visibleTaskColumns[0]?.id;
    const key = ownColumn || fallback;
    if (!key) continue;
    if (!tareasPorColumna[key]) tareasPorColumna[key] = [];
    tareasPorColumna[key].push(task);
  }
  const openSalaPanel = () => {
    document.getElementById('sala-analisis')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const caseTrackingLink = judicialLinks[0] || null;

  return (
    <>
      {/* ── Header ── */}
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <button className="back-btn" onClick={() => navigate('/cases')}>← Casos</button>
          <div className="page-title" style={{ fontSize: '1.1rem' }}>
            Sala del Caso
          </div>
          <div className="page-subtitle" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
            <span className="case-number">{c.case_number}</span>
            <span>{c.title.length > 70 ? c.title.slice(0,70) + '...' : c.title}</span>
            <span className={`badge badge-${c.service_type?.toLowerCase()}`}>{c.service_type}</span>
            {c.jurisdiction && c.jurisdiction !== 'CO' && (
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-4)', padding: '2px 7px', borderRadius: '3px' }}>
                {c.jurisdiction}
              </span>
            )}
            {tareasPendientes.length > 0 && (
              <span style={{ fontSize: '0.72rem', color: '#D4B84A' }}>◈ {tareasPendientes.length} tareas</span>
            )}
            {vencimientosAbiertos.length > 0 && (
              <span style={{ fontSize: '0.72rem', color: '#E87A7A' }}>◆ {vencimientosAbiertos.length} venc.</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexShrink: 0 }}>
          <CalendarSyncButton caseId={c.id} />
          <ClientPortalInvite caseId={c.id} clientName={c.client_name} />
          <span
            className={`badge badge-${c.status?.toLowerCase().replace(/_/g, '-')}`}
            style={{ cursor: 'pointer', fontSize: '0.75rem' }}
            title="Ver opciones de estado en el panel lateral"
          >
            {STATUS_LABELS[c.status] || c.status}
          </span>
        </div>
      </div>

      <div className="page-body">
        <SalaHeader caseId={c.id} onAnalyze={openSalaPanel} />

        <SalaCaseHeader
          c={c}
          tareasPendientes={tareasPendientes}
          vencimientosAbiertos={vencimientosAbiertos}
          latestAnalysis={latestAnalysis}
          comms={comms}
          driveFiles={driveFiles}
          onOpenSala={openSalaPanel}
          onOpenGmail={() => setGmailModalOpen(true)}
          onNavigate={navigate}
        />

        <ExpedienteVivo caseId={c.id} />

        <TimeEntriesPanel caseId={c.id} />

        <section className={`case-judicial-link ${caseTrackingLink ? 'case-judicial-link--connected' : ''}`}>
          <div className="case-judicial-pulse" aria-hidden="true" />
          <div className="case-judicial-main">
            <span>Tracking judicial</span>
            <strong>{caseTrackingLink ? 'Expediente vinculado a seguimiento externo' : 'Expediente sin tracking externo'}</strong>
            <p>
              {caseTrackingLink
                ? `Proceso ${caseTrackingLink.external_process_number || 'sin numero externo'} - seguimiento de solo lectura y timeline publico.`
                : 'El release publico permite adapters de case tracking. La radicacion y automatizacion de portales autenticados no estan incluidas.'}
            </p>
          </div>
          <div className="case-judicial-actions">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => navigate('/judicial-agents')}>
              {caseTrackingLink ? 'Ver tracking' : 'Ver adapters'}
            </button>
          </div>
        </section>

        <div className="detail-grid">

          {/* ════════════════════════════════════
              COLUMNA PRINCIPAL (izquierda)
          ════════════════════════════════════ */}
          <div className="detail-main-col">

            {/* ── Información del caso ── */}
            <div className="detail-section">
              <SectionHeader
                title="Información del caso"
                action={
                  !editCaseInfo
                    ? <button className="btn btn-ghost btn-sm" onClick={openCaseInfoEditor}>Editar expediente</button>
                    : null
                }
              />

              {editCaseInfo && caseDraft && (
                <div style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--sp-3)',
                  marginBottom: 'var(--sp-3)',
                }}>
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="form-label">Numero de caso</label>
                      <input value={caseDraft.case_number} onChange={e => setCaseDraft(p => ({ ...p, case_number: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tipo de caso</label>
                      <select value={caseDraft.service_type} onChange={e => {
                        const nextType = e.target.value;
                        const svc = caseOptions.service_types.find(item => item.type === nextType);
                        setCaseDraft(p => ({
                          ...p,
                          service_type: nextType,
                          legal_area: p.legal_area || nextType,
                          fee: Number(p.fee) > 0 ? p.fee : (svc?.fee ?? p.fee),
                        }));
                      }}>
                        {caseOptions.service_types.map(svc => (
                          <option key={svc.type} value={svc.type}>{svc.label || svc.type}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Nombre del caso</label>
                      <input value={caseDraft.title} required onChange={e => setCaseDraft(p => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Area juridica</label>
                      <select value={caseDraft.legal_area} onChange={e => setCaseDraft(p => ({ ...p, legal_area: e.target.value, process_type: '' }))}>
                        <option value="">Seleccionar area...</option>
                        {LEGAL_AREA_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Proceso / tramite</label>
                      <select value={caseDraft.process_type} onChange={e => setCaseDraft(p => ({ ...p, process_type: e.target.value }))}>
                        <option value="">Seleccionar proceso...</option>
                        {(PROCESS_TYPES[caseDraft.legal_area] || PROCESS_TYPES.OTRO).map(type => <option key={type} value={type}>{type}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Entidad accionada</label>
                      <input value={caseDraft.entity} onChange={e => setCaseDraft(p => ({ ...p, entity: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Canal de entrada</label>
                      <select value={caseDraft.intake_channel} onChange={e => setCaseDraft(p => ({ ...p, intake_channel: e.target.value }))}>
                        <option value="">Sin canal</option>
                        {caseOptions.intake_channels.map(channel => (
                          <option key={channel.code} value={channel.code}>{channel.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Radicacion</label>
                      <input type="date" value={caseDraft.filing_date} onChange={e => setCaseDraft(p => ({ ...p, filing_date: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fecha limite legal</label>
                      <input type="date" value={caseDraft.response_deadline} onChange={e => setCaseDraft(p => ({ ...p, response_deadline: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Asignado</label>
                      <select value={caseDraft.assigned_to || ''} onChange={e => setCaseDraft(p => ({ ...p, assigned_to: e.target.value }))}>
                        <option value="">Sin asignar</option>
                        {caseOptions.users.map(option => (
                          <option key={option.id} value={option.id}>{option.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Honorarios</label>
                      <input type="number" min="0" step="1000" value={caseDraft.fee} onChange={e => setCaseDraft(p => ({ ...p, fee: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Expediente Drive (folder ID)</label>
                      <input value={caseDraft.drive_folder_id} onChange={e => setCaseDraft(p => ({ ...p, drive_folder_id: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Descripcion</label>
                      <textarea rows={4} value={caseDraft.description} onChange={e => setCaseDraft(p => ({ ...p, description: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditCaseInfo(false); setCaseDraft(null); }} disabled={savingCaseInfo}>Cancelar</button>
                    <button className="btn btn-primary btn-sm" onClick={saveCaseInfo} disabled={savingCaseInfo || !caseDraft.title || !caseDraft.service_type}>
                      {savingCaseInfo ? 'Guardando...' : 'Guardar expediente'}
                    </button>
                  </div>
                </div>
              )}

              <div className="detail-row">
                <span className="detail-key">N° Caso</span>
                <span className="detail-val case-number">{c.case_number}</span>
              </div>
              <div className="detail-row">
                <span className="detail-key">Tipo</span>
                <span className="detail-val">
                  <span className={`badge badge-${c.service_type?.toLowerCase()}`}>{c.service_type}</span>
                </span>
              </div>
              {(c.legal_area || c.process_type) && (
                <div className="detail-row">
                  <span className="detail-key">Clasificacion</span>
                  <span className="detail-val">
                    {[c.legal_area, c.process_type].filter(Boolean).join(' / ')}
                  </span>
                </div>
              )}
              {c.entity && (
                <div className="detail-row">
                  <span className="detail-key">Entidad accionada</span>
                  <span className="detail-val">{c.entity}</span>
                </div>
              )}
              {c.intake_channel && (
                <div className="detail-row">
                  <span className="detail-key">Canal de entrada</span>
                  <span className="detail-val" style={{ textTransform: 'capitalize', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {c.intake_channel.toLowerCase()}
                  </span>
                </div>
              )}
              <div className="detail-row">
                <span className="detail-key">Radicación</span>
                <span className="detail-val">{formatDate(c.filing_date)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-key">Fecha límite legal</span>
                <span className="detail-val" style={{ color: diasHasta(c.response_deadline) !== null && diasHasta(c.response_deadline) <= 3 ? '#E87A7A' : 'inherit' }}>
                  {formatDate(c.response_deadline)}
                  {c.response_deadline && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 'var(--sp-2)' }}>
                      ({labelDias(c.response_deadline)})
                    </span>
                  )}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-key">Asignado a</span>
                <span className="detail-val">{c.assigned_to_name || '—'}</span>
              </div>
              {c.drive_folder_id && (
                <div className="detail-row">
                  <span className="detail-key">Expediente Drive</span>
                  <a
                    href={`https://drive.google.com/drive/folders/${c.drive_folder_id}`}
                    target="_blank" rel="noopener noreferrer"
                    className="detail-val"
                    style={{ color: 'var(--gold)', fontSize: '0.82rem' }}
                  >
                    Abrir carpeta ↗
                  </a>
                </div>
              )}
              {c.description && (
                <div style={{ marginTop: 'var(--sp-3)', paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--border)' }}>
                  <div className="detail-key" style={{ marginBottom: 'var(--sp-2)' }}>Descripción</div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                    {c.description}
                  </div>
                </div>
              )}
            </div>

            <DriveDocumentSection
              files={driveFiles}
              searchQuery={driveSearchQuery}
              setSearchQuery={setDriveSearchQuery}
              searchResults={driveSearchResults}
              selectedCategory={driveCategory}
              setSelectedCategory={setDriveCategory}
              loading={driveLoading}
              searching={driveSearching}
              linkingId={driveLinkingId}
              unlinkingId={driveUnlinkingId}
              error={driveError}
              driveWriteEnabled={driveWriteEnabled}
              onSearch={handleSearchDrive}
              onLink={handleLinkDriveFile}
              onUnlink={handleUnlinkDriveFile}
            />

            {/* ── Siguiente actuación (edición inline) ── */}
            <div className="detail-section">
              <SectionHeader
                title="Siguiente actuación"
                action={
                  !editNext
                    ? (
                      <div style={{ display: 'flex', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
                        {c.next_action && (
                          <>
                            <button className="btn btn-secondary btn-sm" onClick={handleCompleteNextAction}>Hecha</button>
                            <button className="btn btn-danger btn-sm" onClick={handleClearNextAction}>Eliminar</button>
                          </>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditNext(true)}>Editar</button>
                      </div>
                    )
                    : null
                }
              />

              {editNext ? (
                <div>
                  <div className="form-group" style={{ marginBottom: 'var(--sp-3)' }}>
                    <label className="form-label">Descripción</label>
                    <textarea
                      value={nextAction}
                      onChange={e => setNextAction(e.target.value)}
                      placeholder="Ej: Verificar respuesta del juzgado / notificación de admisión"
                      rows={2}
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--sp-3)' }}>
                    <label className="form-label">Fecha</label>
                    <input
                      type="date"
                      value={nextActionDate}
                      onChange={e => setNextActionDate(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                    <button className="btn btn-primary btn-sm" onClick={handleSaveNextAction}>Guardar</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      setEditNext(false);
                      setNextAction(c.next_action || '');
                      setNextActionDate(c.next_action_date ? c.next_action_date.slice(0,10) : '');
                    }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div>
                  {c.next_action ? (
                    <>
                      <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', marginBottom: 'var(--sp-2)', lineHeight: 1.5 }}>
                        {c.next_action}
                      </div>
                      {c.next_action_date && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                          <span style={{
                            fontSize: '0.82rem',
                            color: diasNextAction !== null && diasNextAction <= 3 ? '#D4B84A' : 'var(--gold)',
                            fontFamily: 'var(--font-editorial)',
                          }}>
                            {formatDate(c.next_action_date)}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            ({labelDias(c.next_action_date)})
                          </span>
                          {diasNextAction !== null && diasNextAction <= 1 && (
                            <span style={{ fontSize: '0.65rem', background: 'rgba(212,184,74,0.15)', color: '#D4B84A', padding: '2px 7px', borderRadius: '3px', fontWeight: 700 }}>
                              URGENTE
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                      Sin siguiente actuación definida
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Sala de analisis ── */}
            <div className="detail-section" id="sala-analisis">
              <SectionHeader title="Sala de analisis" />

              <div style={{ marginBottom: 'var(--sp-3)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                Pega una conversacion, correo, nota o transcripcion. La Sala propone siguiente actuacion, tareas,
                vencimientos y preguntas para revision del abogado.
              </div>

              <div style={{
                background: 'var(--bg-3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 'var(--sp-3)',
                marginBottom: 'var(--sp-3)',
              }}>
                <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
                  {SOURCE_TYPE_OPTIONS.map(([value, label]) => (
                    <button
                      key={value}
                      className={`btn btn-sm ${salaSourceType === value ? 'btn-primary' : 'btn-ghost'}`}
                      type="button"
                      onClick={() => setSalaSourceType(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <textarea
                  value={salaText}
                  onChange={e => setSalaText(e.target.value)}
                  placeholder="Ej: Transcripcion de llamada con el cliente, resumen de correo o relato del estado actual del caso..."
                  rows={5}
                  disabled={analyzingSala}
                  style={{ marginBottom: 'var(--sp-2)' }}
                />
                {analyzingSala && (
                  <div className="sala-progress" role="status" aria-live="polite">
                    <span className="loading-spinner" aria-hidden="true" />
                    <span>La Sala esta leyendo el insumo y construyendo sugerencias...</span>
                  </div>
                )}
                {salaError && (
                  <div style={{ color: '#E87A7A', fontSize: '0.78rem', marginBottom: 'var(--sp-2)' }}>
                    {salaError}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    La Sala sugiere; el abogado decide que aplicar.
                  </span>
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={handleAnalyzeSala}
                    disabled={analyzingSala || salaText.trim().length < 20}
                  >
                    {analyzingSala && <span className="loading-spinner loading-spinner-dark" aria-hidden="true" />}
                    {analyzingSala ? 'Analizando' : 'Convocar Sala'}
                  </button>
                </div>
              </div>

              {!latestAnalysis ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 'var(--sp-2) 0', fontStyle: 'italic' }}>
                  Aun no hay analisis de Sala en este caso.
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', flexWrap: 'wrap', marginBottom: 'var(--sp-2)' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      Ultimo analisis · {latestAnalysis.provider || 'local'} · {formatDateTime(latestAnalysis.created_at)}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {aiAnalyses.length} analisis guardados
                    </div>
                  </div>

                  <div style={{
                    display: 'flex',
                    gap: 'var(--sp-2)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    marginBottom: 'var(--sp-3)',
                  }}>
                    <span className="sala-provider-badge" style={{ borderColor: providerTone(latestAnalysis), color: providerTone(latestAnalysis) }}>
                      {latestProviderLabel}
                    </span>
                    {latestAnalysis.provider_error && (
                      <span className="sala-provider-note">
                        El proveedor fallo o devolvio poco JSON; se completo con reglas locales.
                      </span>
                    )}
                    {latestAnalysis.analysis?.input_signals?.length > 0 && (
                      <span className="sala-provider-note">
                        Senales: {latestAnalysis.analysis.input_signals.join(', ')}
                      </span>
                    )}
                  </div>

                  <div style={{
                    background: 'var(--bg-2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 'var(--sp-3)',
                    marginBottom: 'var(--sp-3)',
                  }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--gold)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 'var(--sp-1)' }}>
                      Relator
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.55 }}>
                      {latestAnalysis.analysis?.executive_summary || 'Sin resumen disponible.'}
                    </div>
                    {latestAnalysis.analysis?.risks?.length > 0 && (
                      <div style={{ marginTop: 'var(--sp-3)' }}>
                        <div style={{ fontSize: '0.78rem', color: '#D4B84A', fontWeight: 700, marginBottom: 'var(--sp-1)' }}>
                          Riesgos o alertas
                        </div>
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', color: 'var(--text-secondary)', fontSize: '0.82rem', lineHeight: 1.5 }}>
                          {latestAnalysis.analysis.risks.slice(0, 4).map((risk, idx) => (
                            <li key={idx}>{risk}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', textTransform: 'uppercase', fontWeight: 700 }}>
                    Sugerencias accionables
                  </div>
                  {latestAnalysis.suggestions?.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                      La Sala no genero sugerencias aplicables.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                      {latestAnalysis.suggestions.map(s => {
                        const applied = s.status === 'applied';
                        return (
                          <div
                            key={s.id}
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius)',
                              padding: 'var(--sp-3)',
                              background: applied ? 'rgba(110,186,116,0.08)' : 'var(--bg-3)',
                              opacity: applied ? 0.75 : 1,
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)', alignItems: 'flex-start' }}>
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', fontWeight: 700, marginBottom: '3px' }}>
                                  {SUGGESTION_LABELS[s.suggestion_type] || s.suggestion_type}
                                </div>
                                <div style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                                  {s.title}
                                </div>
                                {s.payload?.due_date && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Fecha: {formatDate(s.payload.due_date)}
                                  </div>
                                )}
                                {s.payload?.rationale && (
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.35 }}>
                                    {s.payload.rationale}
                                  </div>
                                )}
                              </div>
                              {applied ? (
                                <span style={{ fontSize: '0.72rem', color: '#6EBA74', fontWeight: 700 }}>Aplicada</span>
                              ) : (
                                <button
                                  className="btn btn-primary btn-sm"
                                  type="button"
                                  disabled={applyingSuggestion === s.id}
                                  onClick={() => handleApplySuggestion(latestAnalysis.id, s.id)}
                                >
                                  {applyingSuggestion === s.id ? 'Aplicando...' : 'Aplicar'}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Actuaciones procesales ── */}
            <div className="detail-section">
              <SectionHeader
                title="Actuaciones procesales"
                action={
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowActForm(v => !v)}
                  >
                    {showActForm ? '✕' : '+ Nueva'}
                  </button>
                }
              />

              {/* Formulario inline */}
              <InlineForm show={showActForm} onClose={() => setShowActForm(false)}>
                <form onSubmit={handleAddActuacion}>
                  <div className="form-grid" style={{ marginBottom: 'var(--sp-3)' }}>
                    <div className="form-group">
                      <label className="form-label">Tipo</label>
                      <select value={newAct.type} onChange={e => setNewAct(p => ({ ...p, type: e.target.value }))}>
                        {ACTUACION_TYPES.map(t => (
                          <option key={t} value={t}>{ACTUACION_LABELS[t]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fecha programada</label>
                      <input type="date" value={newAct.scheduled_at}
                        onChange={e => setNewAct(p => ({ ...p, scheduled_at: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Título / descripción breve *</label>
                      <input type="text" value={newAct.title} required
                        placeholder="Ej: Radicación tutela Juzgado 15 Civil Circuito"
                        onChange={e => setNewAct(p => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Número de radicado</label>
                      <input type="text" value={newAct.radicado}
                        placeholder="Opcional"
                        onChange={e => setNewAct(p => ({ ...p, radicado: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingAct}>
                      {savingAct ? '…' : 'Registrar actuación'}
                    </button>
                  </div>
                </form>
              </InlineForm>

              {/* Lista de actuaciones */}
              {actuaciones.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: 'var(--sp-2) 0', fontStyle: 'italic' }}>
                  Sin actuaciones registradas
                </div>
              ) : (
                <div className="timeline">
                  {actuaciones.map(act => {
                    const completada = !!act.completed_at;
                    const vencida = !completada && diasHasta(act.scheduled_at) !== null && diasHasta(act.scheduled_at) < 0;
                    return (
                      <div key={act.id} className="timeline-item">
                        <div className="timeline-dot" style={{
                          background: completada ? 'rgba(110,186,116,0.2)' : vencida ? 'rgba(232,122,122,0.15)' : 'var(--bg-3)',
                          borderColor: completada ? 'rgba(110,186,116,0.5)' : vencida ? 'rgba(232,122,122,0.4)' : 'var(--border)',
                          color: completada ? '#6EBA74' : vencida ? '#E87A7A' : 'var(--text-muted)',
                        }}>
                          {completada ? '✓' : vencida ? '!' : '◯'}
                        </div>
                        <div className="timeline-content" style={{ opacity: completada ? 0.7 : 1 }}>
                          <div className="timeline-meta">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                              <span className="badge-act-type">{ACTUACION_LABELS[act.type] || act.type}</span>
                              {act.radicado && (
                                <span style={{ fontSize: '0.7rem', color: 'var(--gold)' }}>Rad. {act.radicado}</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
                              {act.scheduled_at && (
                                <span style={{ color: vencida ? '#E87A7A' : 'var(--text-muted)' }}>
                                  {formatDate(act.scheduled_at)}
                                  {!completada && <span style={{ opacity: 0.7 }}> ({labelDias(act.scheduled_at)})</span>}
                                </span>
                              )}
                              {completada ? (
                                <span style={{ color: '#6EBA74', fontSize: '0.7rem' }}>
                                  completada {formatDate(act.completed_at)}
                                </span>
                              ) : (
                                !completingAct && (
                                  <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      style={{ padding: '1px 6px', fontSize: '0.72rem', color: '#6EBA74' }}
                                      onClick={() => setCompletingAct(act.id)}
                                    >
                                      ✓ Completar
                                    </button>
                                    <button
                                      className="btn btn-ghost btn-sm"
                                      style={{ padding: '1px 6px', fontSize: '0.72rem', color: '#E87A7A' }}
                                      onClick={() => handleDeleteActuacion(act.id)}
                                    >
                                      ✕
                                    </button>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                          <div className="timeline-text">{act.title}</div>
                          {act.result && (
                            <div style={{ fontSize: '0.8rem', color: '#6EBA74', marginTop: '4px', fontStyle: 'italic' }}>
                              Resultado: {act.result}
                            </div>
                          )}

                          {/* Formulario inline de completar */}
                          {completingAct === act.id && (
                            <div style={{ marginTop: 'var(--sp-3)', background: 'var(--bg-4)', borderRadius: 'var(--radius)', padding: 'var(--sp-3)' }}>
                              <input
                                type="text"
                                value={actResult}
                                onChange={e => setActResult(e.target.value)}
                                placeholder="Resultado / observación (opcional)"
                                style={{ marginBottom: 'var(--sp-2)' }}
                              />
                              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={() => handleCompleteActuacion(act.id)}
                                  disabled={savingAct}
                                >
                                  {savingAct ? '…' : 'Confirmar'}
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => { setCompletingAct(null); setActResult(''); }}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Tareas ── */}
            <div className="detail-section">
              <SectionHeader
                title="Tareas"
                action={
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowTareaForm(v => !v)}
                  >
                    {showTareaForm ? '?' : '+ Nueva'}
                  </button>
                }
              />

              <InlineForm show={showTareaForm} onClose={() => setShowTareaForm(false)}>
                <form onSubmit={handleAddTarea}>
                  <div className="form-grid" style={{ marginBottom: 'var(--sp-3)' }}>
                    <div className="form-group full">
                      <label className="form-label">Titulo *</label>
                      <input type="text" value={newTarea.title} required
                        placeholder="Ej: Redactar escrito de impugnacion"
                        onChange={e => setNewTarea(p => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Columna</label>
                      <select value={newTarea.column_id}
                        onChange={e => {
                          const column = visibleTaskColumns.find(col => String(col.id) === e.target.value);
                          setNewTarea(p => ({ ...p, column_id: e.target.value, status: column?.base_status || p.status }));
                        }}>
                        {visibleTaskColumns.map(col => (
                          <option key={col.id} value={col.id}>{col.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Prioridad</label>
                      <select value={newTarea.priority}
                        onChange={e => setNewTarea(p => ({ ...p, priority: e.target.value }))}>
                        {PRIORITY_OPTIONS.map(p => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fecha limite</label>
                      <input type="date" value={newTarea.due_date}
                        onChange={e => setNewTarea(p => ({ ...p, due_date: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tiempo estimado (min)</label>
                      <input type="number" min="0" value={newTarea.estimated_minutes}
                        onChange={e => setNewTarea(p => ({ ...p, estimated_minutes: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Contexto juridico</label>
                      <textarea rows={2} value={newTarea.context}
                        onChange={e => setNewTarea(p => ({ ...p, context: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Descripcion</label>
                      <textarea rows={2} value={newTarea.description}
                        onChange={e => setNewTarea(p => ({ ...p, description: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Insumos (uno por linea)</label>
                      <textarea rows={3} value={newTarea.required_inputs_text}
                        onChange={e => setNewTarea(p => ({ ...p, required_inputs_text: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Adjuntos/referencias (una por linea)</label>
                      <textarea rows={3} value={newTarea.attachment_refs_text}
                        onChange={e => setNewTarea(p => ({ ...p, attachment_refs_text: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Checklist (uno por linea)</label>
                      <textarea rows={3} value={newTarea.checklist_text}
                        onChange={e => setNewTarea(p => ({ ...p, checklist_text: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Bloqueo</label>
                      <textarea rows={3} value={newTarea.blocked_reason}
                        onChange={e => setNewTarea(p => ({ ...p, blocked_reason: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={savingTarea}>
                      {savingTarea ? '...' : 'Crear tarjeta'}
                    </button>
                  </div>
                </form>
              </InlineForm>

              <div className="tasks-board-scroll">
                <div className="tasks-board-track">
                  {visibleTaskColumns.map(col => (
                    <div
                      key={col.id}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleDropTaskColumn(event, col)}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: 'var(--sp-2)',
                        background: 'var(--bg-3)',
                        minHeight: '160px',
                      }}
                    >
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                        {col.title} ({tareasPorColumna[col.id]?.length || 0})
                      </div>
                      {(tareasPorColumna[col.id] || []).map(t => (
                        <TaskKanbanCard
                          key={t.id}
                          task={t}
                          onOpen={openTaskDetail}
                          onDragStart={handleTaskDragStart}
                        />
                      ))}
                      {(tareasPorColumna[col.id] || []).length === 0 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', opacity: draggingTaskId ? 0.7 : 1 }}>
                          Suelta aqui
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {taskDetailOpen && taskDraft && (
              <div className="modal-overlay" onClick={() => setTaskDetailOpen(false)}>
                <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '860px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
                    <h3 style={{ margin: 0 }}>Tarjeta #{taskDraft.id}</h3>
                    <button className="btn btn-ghost btn-sm" onClick={() => setTaskDetailOpen(false)}>Cerrar</button>
                  </div>
                  <div className="form-grid">
                    <div className="form-group full">
                      <label className="form-label">Titulo</label>
                      <input value={taskDraft.title || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, title: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Columna</label>
                      <select value={taskDraft.board_column_id || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, board_column_id: e.target.value }))}>
                        {visibleTaskColumns.map(col => (
                          <option key={col.id} value={col.id}>{col.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Prioridad</label>
                      <select value={taskDraft.priority || 'MEDIA'}
                        onChange={e => setTaskDraft(p => ({ ...p, priority: e.target.value }))}>
                        {PRIORITY_OPTIONS.map(p => (
                          <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Fecha limite</label>
                      <input type="date" value={taskDraft.due_date || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, due_date: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tiempo estimado (min)</label>
                      <input type="number" min="0" value={taskDraft.estimated_minutes || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, estimated_minutes: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Contexto juridico</label>
                      <textarea rows={2} value={taskDraft.context || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, context: e.target.value }))} />
                    </div>
                    <div className="form-group full">
                      <label className="form-label">Descripcion</label>
                      <textarea rows={2} value={taskDraft.description || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, description: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Insumos</label>
                      <textarea rows={4} value={taskDraft.required_inputs_text || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, required_inputs_text: e.target.value }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Adjuntos/referencias</label>
                      <textarea rows={4} value={taskDraft.attachment_refs_text || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, attachment_refs_text: e.target.value }))} />
                    </div>
                    <div className="form-group full" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <label className="form-label" style={{ margin: 0 }}>Checklist</label>
                        <button className="btn btn-secondary btn-sm" type="button" onClick={addChecklistItem}>+ Item</button>
                      </div>
                      {(taskDraft.checklistItems || []).length === 0 ? (
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Sin items de checklist.</div>
                      ) : (
                        <div style={{ display: 'grid', gap: '6px' }}>
                          {(taskDraft.checklistItems || []).map((item) => (
                            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <input type="checkbox" checked={Boolean(item.done)} onChange={() => toggleChecklistItem(item.id)} />
                              <span style={{ flex: 1, fontSize: '0.8rem', textDecoration: item.done ? 'line-through' : 'none' }}>{item.text}</span>
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeChecklistItem(item.id)} style={{ color: '#E87A7A' }}>X</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="form-group full" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                      <label className="form-label">Insumos y adjuntos (Drive)</label>
                      {taskLinksLoading ? (
                        <div className="loading">Cargando fuentes...</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                            <select value={selectedDriveLinkId} onChange={(event) => setSelectedDriveLinkId(event.target.value)} style={{ minWidth: '280px' }}>
                              <option value="">Selecciona archivo de Drive del caso</option>
                              {taskSources.drive_files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
                            </select>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => attachDriveToTask('input')} disabled={!selectedDriveLinkId || savingTarea}>Agregar como insumo</button>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => attachDriveToTask('attachment')} disabled={!selectedDriveLinkId || savingTarea}>Agregar como adjunto</button>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '4px' }}>Vinculos</div>
                          {taskLinks.filter(link => link.kind === 'drive').map((link) => (
                            <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                              <a href={link.drive_web_view_link || normalizeMetadata(link.metadata).web_view_link} target="_blank" rel="noreferrer" style={{ fontSize: '0.78rem' }}>{link.drive_name || link.label}</a>
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => unlinkTaskLink(link.id)} style={{ color: '#E87A7A' }}>Quitar</button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    <div className="form-group full" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)' }}>
                      <label className="form-label">Correos vinculados</label>
                      {taskLinksLoading ? (
                        <div className="loading">Cargando correos...</div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                            <select value={selectedEmailId} onChange={(event) => setSelectedEmailId(event.target.value)} style={{ minWidth: '320px' }}>
                              <option value="">Selecciona correo del expediente</option>
                              {taskSources.emails.map((email) => {
                                const metadata = normalizeMetadata(email.metadata);
                                const subject = metadata.subject || String(email.content || '').split('\n')[0] || `Correo #${email.id}`;
                                return <option key={email.id} value={email.id}>{subject}</option>;
                              })}
                            </select>
                            <button className="btn btn-secondary btn-sm" type="button" onClick={attachEmailToTask} disabled={!selectedEmailId || savingTarea}>Vincular correo</button>
                          </div>
                          {taskLinks.filter(link => link.kind === 'email').map((link) => (
                            <div key={link.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '4px' }}>
                              <span style={{ fontSize: '0.78rem' }}>{link.label}</span>
                              <button className="btn btn-ghost btn-sm" type="button" onClick={() => unlinkTaskLink(link.id)} style={{ color: '#E87A7A' }}>Quitar</button>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    <div className="form-group">
                      <label className="form-label">Bloqueo</label>
                      <textarea rows={4} value={taskDraft.blocked_reason || ''}
                        onChange={e => setTaskDraft(p => ({ ...p, blocked_reason: e.target.value }))} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--sp-3)' }}>
                    <button className="btn btn-danger btn-sm" onClick={() => handleDeleteTarea(taskDraft.id)} disabled={savingTarea}>Eliminar</button>
                    <button className="btn btn-primary btn-sm" onClick={saveTaskDetail} disabled={savingTarea}>
                      {savingTarea ? '...' : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="detail-section">
              <div className="detail-section-title">
                Línea de tiempo · Comunicaciones
              </div>
              <div className="case-gmail-sync-strip">
                <div>
                  <strong>Gmail conectado al expediente</strong>
                  <span>
                    Actualiza el historial del caso con correos recientes o mensajes del cliente.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm case-gmail-sync-button"
                  onClick={() => setGmailModalOpen(true)}
                  title="Actualizar comunicaciones desde Gmail"
                >
                  <span className="case-gmail-sync-button-mark">G</span>
                  Actualizar desde Gmail
                </button>
              </div>
              <div className="timeline">
                {comms.length === 0 ? (
                  <div className="empty-state" style={{ padding: 'var(--sp-4)' }}>
                    <div className="empty-state-text" style={{ fontSize: '0.85rem' }}>Sin registros aún</div>
                  </div>
                ) : (
                  comms.map(cm => {
                    const gmailItem = isGmailCommunication(cm);
                    return (
                      <div key={cm.id} className="timeline-item">
                        <div
                          className={`timeline-dot${gmailItem ? ' timeline-dot-gmail' : ''}`}
                          style={cm.type === 'system' ? { background: 'var(--bg-4)', color: 'var(--text-muted)', fontSize: '0.6rem' } : {}}
                        >
                          {COMM_ICONS[cm.type] || '◈'}
                        </div>
                        <div
                          className={`timeline-content${gmailItem ? ' timeline-content-gmail' : ''}`}
                          style={cm.type === 'system' ? { opacity: 0.6 } : {}}
                        >
                          <div className="timeline-meta">
                            <span>{gmailItem ? 'Importado desde Gmail' : (cm.author_name || 'Sistema')}</span>
                            <span>{formatDateTime(cm.created_at)}</span>
                          </div>
                          {gmailItem ? (
                            <GmailTimelineCard
                              communication={cm}
                              onDelete={requestDeleteCommunication}
                              deleting={deletingCommId === cm.id}
                            />
                          ) : (
                            <>
                              <div className="timeline-text">{cm.content}</div>
                              <div className="timeline-entry-actions">
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm"
                                  onClick={() => requestDeleteCommunication(cm)}
                                  disabled={deletingCommId === cm.id}
                                >
                                  {deletingCommId === cm.id ? 'Eliminando...' : 'Eliminar entrada'}
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Input nueva comunicación */}
              <div className="comm-input-area" style={{ marginTop: 'var(--sp-4)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', flex: 1 }}>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    {[['note', 'Nota'], ['email', 'Email'], ['call', 'Llamada'], ['message', 'Mensaje']].map(([k, v]) => (
                      <button
                        key={k}
                        className={`btn btn-sm ${commType === k ? 'btn-primary' : 'btn-ghost'}`}
                        onClick={() => setCommType(k)}
                        type="button"
                      >
                        {COMM_ICONS[k]} {v}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={commText}
                    onChange={e => setCommText(e.target.value)}
                    placeholder="Nota, comunicación o actualización del caso…"
                    rows={2}
                    onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleAddComm(); }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleAddComm}
                  disabled={savingComm || !commText.trim()}
                  style={{ alignSelf: 'flex-end' }}
                >
                  {savingComm ? '…' : 'Registrar'}
                </button>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>
                Ctrl + Enter para enviar rápido
              </div>
            </div>

          </div>

          {/* ════════════════════════════════════
              COLUMNA LATERAL (derecha)
          ════════════════════════════════════ */}
          <div className="detail-side-col">

            {/* ── Cliente ── */}
            <div className="detail-section">
              <div className="detail-section-title">Cliente</div>
              <div style={{ marginBottom: 'var(--sp-3)' }}>
                <div style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 'var(--sp-1)' }}>
                  {c.client_name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{c.client_document}</div>
              </div>
              {c.client_email && (
                <div className="detail-row">
                  <span className="detail-key">Email</span>
                  <span className="detail-val" style={{ fontSize: '0.8rem' }}>{c.client_email}</span>
                </div>
              )}
              {c.client_phone && (
                <div className="detail-row">
                  <span className="detail-key">Teléfono</span>
                  <span className="detail-val">{c.client_phone}</span>
                </div>
              )}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 'var(--sp-3)', width: '100%' }}
                onClick={() => navigate('/clients')}>
                Ver perfil del cliente
              </button>
            </div>

            {/* ── Honorarios ── */}
            <div className="detail-section">
              <div className="detail-section-title">Honorarios</div>
              <div style={{ textAlign: 'center', padding: 'var(--sp-3) 0' }}>
                <div style={{ fontFamily: 'var(--font-editorial)', fontSize: '2rem', color: 'var(--gold)' }}>
                  {formatCOP(c.fee)}
                </div>
                <div className={c.fee_paid ? 'fee-paid' : 'fee-unpaid'} style={{ fontSize: '0.85rem', marginTop: 'var(--sp-2)' }}>
                  {c.fee_paid
                    ? `✓ Cobrado${c.fee_paid_at ? ' · ' + formatDate(c.fee_paid_at) : ''}`
                    : '· Pendiente de pago'}
                </div>
              </div>
              <button
                className={`btn btn-sm ${c.fee_paid ? 'btn-secondary' : 'btn-primary'}`}
                style={{ width: '100%', marginTop: 'var(--sp-2)' }}
                onClick={() => handleFeePaid(!c.fee_paid)}
              >
                {c.fee_paid ? 'Marcar como pendiente' : 'Marcar como cobrado'}
              </button>
            </div>

            {/* ── Estado del proceso ── */}
            <div className="detail-section">
              <div className="detail-section-title">Estado</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s.value}
                    className={`btn btn-sm ${c.status === s.value ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: '0.82rem' }}
                    onClick={() => handleStatusChange(s.value)}
                  >
                    <span style={{ marginRight: 'var(--sp-2)', opacity: c.status === s.value ? 1 : 0 }}>▸</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Vencimientos del caso ── */}
            <div className="detail-section">
              <SectionHeader
                title="Vencimientos"
                action={
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowVencimientoForm(v => !v)}>
                    {showVencimientoForm ? 'Cancelar' : '+ Nuevo'}
                  </button>
                }
              />
              {vencimientosAbiertos.length > 0 && (
                <div style={{ color: '#E87A7A', fontSize: '0.72rem', marginBottom: 'var(--sp-2)' }}>
                  {vencimientosAbiertos.length} abierto{vencimientosAbiertos.length === 1 ? '' : 's'}
                </div>
              )}

              {showVencimientoForm && (
                <form onSubmit={handleAddVencimiento} style={{
                  background: 'var(--bg-3)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--sp-3)',
                  marginBottom: 'var(--sp-3)',
                }}>
                  <div className="form-group" style={{ marginBottom: 'var(--sp-2)' }}>
                    <label className="form-label">Titulo</label>
                    <input value={newVencimiento.title} onChange={e => setNewVencimiento(p => ({ ...p, title: e.target.value }))} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--sp-2)' }}>
                    <label className="form-label">Fecha</label>
                    <input type="date" value={newVencimiento.due_date} onChange={e => setNewVencimiento(p => ({ ...p, due_date: e.target.value }))} required />
                  </div>
                  <div className="form-group" style={{ marginBottom: 'var(--sp-3)' }}>
                    <label className="form-label">Urgencia</label>
                    <select value={newVencimiento.urgency} onChange={e => setNewVencimiento(p => ({ ...p, urgency: e.target.value }))}>
                      <option value="CRITICO">Critico</option>
                      <option value="ALTO">Alto</option>
                      <option value="MEDIO">Medio</option>
                      <option value="BAJO">Bajo</option>
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm" type="submit" disabled={savingVencimiento}>
                    {savingVencimiento ? 'Guardando...' : 'Registrar vencimiento'}
                  </button>
                </form>
              )}
              {vencimientos.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                  Sin vencimientos registrados
                </div>
              ) : (
                <div>
                  {vencimientos
                    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
                    .map(v => {
                      const dias = diasHasta(v.due_date);
                      const colorUrgency = URGENCY_COLORS[v.urgency] || 'var(--text-muted)';
                      return (
                        <div key={v.id} className="venc-item" style={{ opacity: v.resolved ? 0.45 : 1 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: '0.8rem',
                              color: v.resolved ? 'var(--text-muted)' : 'var(--text-primary)',
                              textDecoration: v.resolved ? 'line-through' : 'none',
                              marginBottom: '2px',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                              {v.title}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                              <span style={{ fontSize: '0.72rem', color: v.resolved ? 'var(--text-muted)' : colorUrgency, fontWeight: 600 }}>
                                {v.urgency}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: dias !== null && dias < 0 && !v.resolved ? '#E87A7A' : 'var(--text-muted)' }}>
                                {formatDate(v.due_date)} {!v.resolved && `(${labelDias(v.due_date)})`}
                              </span>
                            </div>
                          </div>
                          {!v.resolved && (
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ padding: '2px 7px', fontSize: '0.7rem', color: '#6EBA74', flexShrink: 0 }}
                              onClick={() => handleResolveVencimiento(v.id)}
                              title="Marcar como resuelto"
                            >
                              ✓
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <GmailImportModal
        caseId={id}
        open={gmailModalOpen}
        onClose={() => setGmailModalOpen(false)}
        onImported={() => loadCase()}
        clientEmail={c.client_email}
        clientId={c.client_id}
        clientName={c.client_name}
      />

      <DeleteCommunicationDialog
        communication={commPendingDelete}
        onCancel={() => !deletingCommId && setCommPendingDelete(null)}
        onConfirm={confirmDeleteCommunication}
        deleting={Boolean(deletingCommId)}
      />
    </>
  );
}
