import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { track } from '../hooks/useTracking';

const GOOGLE_SERVICES = [
  {
    key: 'gmail_enabled',
    label: 'Gmail',
    marker: '@',
    stage: 'Activo',
    body: 'Correos importados a comunicaciones de caso.',
  },
  {
    key: 'drive_enabled',
    label: 'Drive',
    marker: '#',
    stage: 'Parcial',
    body: 'Listado de archivos disponible; expediente por caso en curso.',
  },
  {
    key: 'calendar_enabled',
    label: 'Calendar',
    marker: 'C',
    stage: 'Proximo',
    body: 'Audiencias, reuniones y vencimientos.',
    soon: true,
  },
  {
    key: 'contacts_enabled',
    label: 'Contacts',
    marker: 'P',
    stage: 'Proximo',
    body: 'Contactos operativos vinculados a clientes y partes.',
    soon: true,
  },
];

const ROADMAP_INTEGRATIONS = [
  {
    title: 'workflow Workflows',
    status: 'Proximo',
    body: 'Reglas, autorizaciones humanas y automatizaciones operativas.',
  },
  {
    title: 'Anthropic',
    status: 'En desarrollo',
    body: 'Proveedor IA reemplazable para clasificacion, sintesis y drafting.',
  },
  {
    title: 'WhatsApp Business',
    status: 'Fase 2',
    body: 'Canal externo para avisos y seguimiento controlado.',
  },
  {
    title: 'Firma electronica',
    status: 'Fase 2',
    body: 'Envio, versionado y evidencia de documentos firmables.',
  },
];

function IntegrationNotice({ type, children }) {
  if (!children) return null;
  return (
    <div className={`integration-notice integration-notice-${type}`}>
      {children}
    </div>
  );
}

function GoogleServiceTile({ service, connected, status, driveFiles }) {
  const enabled = connected && !service.soon && Boolean(status?.[service.key]);
  const partial = service.key === 'drive_enabled' && enabled;
  const stateLabel = service.soon
    ? service.stage
    : enabled
      ? partial ? 'Parcial' : service.stage
      : 'Sin activar';

  return (
    <div className={`google-service-tile${enabled ? ' active' : ''}${service.soon ? ' soon' : ''}`}>
      <div className="google-service-top">
        <span className="google-service-marker">{service.marker}</span>
        <span className={`google-service-state${enabled ? ' active' : ''}`}>{stateLabel}</span>
      </div>
      <div className="google-service-label">{service.label}</div>
      <div className="google-service-body">{service.body}</div>
      {service.key === 'drive_enabled' && enabled && (
        <div className="google-service-foot">
          {driveFiles.loading
            ? 'Leyendo Drive'
            : driveFiles.error
              ? 'Drive conectado; listado no disponible'
              : `${driveFiles.items.length} archivo${driveFiles.items.length === 1 ? '' : 's'} recientes`}
        </div>
      )}
    </div>
  );
}

function RoadmapCard({ item }) {
  return (
    <div className="integration-card">
      <div>
        <div className="integration-card-title">{item.title}</div>
        <div className="integration-card-sub">{item.body}</div>
      </div>
      <div className="integration-status">{item.status}</div>
    </div>
  );
}

export default function Integrations() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [googleStatus, setGoogleStatus] = useState({ loading: true, connected: false });
  const [driveFiles, setDriveFiles] = useState({ loading: false, items: [], error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadDrivePreview = useCallback(async (status) => {
    if (!status?.connected || !status?.drive_enabled) {
      setDriveFiles({ loading: false, items: [], error: '' });
      return;
    }

    setDriveFiles(prev => ({ ...prev, loading: true, error: '' }));
    try {
      const { data } = await api.get('/drive/files?pageSize=6');
      setDriveFiles({ loading: false, items: data.files || [], error: '' });
    } catch (err) {
      setDriveFiles({ loading: false, items: [], error: err.response?.data?.error || 'No fue posible leer Drive.' });
    }
  }, []);

  const loadStatus = useCallback(async () => {
    setError('');
    try {
      const { data } = await api.get('/google/status');
      const nextStatus = { loading: false, ...data };
      setGoogleStatus(nextStatus);
      await loadDrivePreview(nextStatus);
    } catch (err) {
      setGoogleStatus({ loading: false, connected: false });
      setDriveFiles({ loading: false, items: [], error: '' });
      setError(err.response?.data?.error || 'No fue posible consultar Google Workspace.');
    }
  }, [loadDrivePreview]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Telemetría: detectar transición a "connected" (post-OAuth de Google).
  // Solo dispara cuando va de NO conectado → conectado en la misma sesión,
  // para no inflar eventos en cada re-render con status cacheado.
  const wasConnected = useRef(false);
  useEffect(() => {
    if (googleStatus.loading) return;
    if (googleStatus.connected && !wasConnected.current) {
      track('integration_connected', { provider: 'google' });
    }
    wasConnected.current = googleStatus.connected;
  }, [googleStatus.loading, googleStatus.connected]);

  useEffect(() => {
    const googleConnected = searchParams.get('google') === 'connected';
    const legacyGmailConnected = searchParams.get('gmail') === 'connected';
    if (!googleConnected && !legacyGmailConnected) return;

    const email = searchParams.get('email');
    setNotice(email
      ? `Google Workspace conectado para ${email}.`
      : 'Google Workspace conectado.');

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('google');
    nextParams.delete('gmail');
    nextParams.delete('email');
    nextParams.delete('scopes');
    setSearchParams(nextParams, { replace: true });
    loadStatus();
  }, [searchParams, setSearchParams, loadStatus]);

  const handleConnect = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.get('/google/auth/url');
      window.location.href = data.url;
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'GOOGLE_NOT_CONFIGURED') {
        setError('Google Workspace necesita credenciales OAuth antes de conectar una cuenta.');
      } else {
        setError(err.response?.data?.error || 'No fue posible iniciar la autorizacion con Google.');
      }
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Desconectar la cuenta de Google Workspace? Los correos ya importados se conservan.')) return;
    setBusy(true);
    setError('');
    try {
      await api.post('/google/disconnect');
      setNotice('Cuenta de Google Workspace desconectada.');
      await loadStatus();
    } catch (err) {
      setError(err.response?.data?.error || 'No fue posible desconectar Google Workspace.');
    } finally {
      setBusy(false);
    }
  };

  const connected = Boolean(googleStatus.connected);
  const granted = googleStatus.scopes_granted || [];

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Integraciones</div>
          <div className="page-subtitle">Google Workspace como primera capa operativa del sistema juridico</div>
        </div>
        <div className="area-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings?section=integraciones')}>
            Credenciales
          </button>
          <button className="btn btn-ghost btn-sm" onClick={loadStatus} disabled={googleStatus.loading}>
            Actualizar
          </button>
        </div>
      </div>

      <div className="page-body">
        <IntegrationNotice type="ok">{notice}</IntegrationNotice>
        <IntegrationNotice type="error">{error}</IntegrationNotice>

        <div className="google-workspace-panel">
          <div className="google-workspace-header">
            <div className="google-workspace-logo">G</div>
            <div>
              <div className="google-workspace-title">Google Workspace</div>
              <div className="google-workspace-subtitle">Gmail · Drive · Calendar · Contacts</div>
            </div>

            <div className="google-workspace-state">
              {googleStatus.loading ? (
                <span className="settings-badge settings-badge--neutral">Verificando</span>
              ) : connected ? (
                <>
                  <span className="settings-badge settings-badge--ok">Conectado</span>
                  {googleStatus.email && <span className="google-workspace-email">{googleStatus.email}</span>}
                </>
              ) : (
                <span className="settings-badge settings-badge--off">Sin conectar</span>
              )}
            </div>
          </div>

          <div className="google-services-grid">
            {GOOGLE_SERVICES.map(service => (
              <GoogleServiceTile
                key={service.key}
                service={service}
                connected={connected}
                status={googleStatus}
                driveFiles={driveFiles}
              />
            ))}
          </div>

          <div className="google-workspace-footer">
            <div className="google-scope-row">
              {granted.length > 0 ? (
                granted.map(scope => <span key={scope}>{scope}</span>)
              ) : (
                <span>sin scopes concedidos</span>
              )}
            </div>

            <div className="integration-card-actions">
              {connected ? (
                <button className="btn btn-secondary btn-sm" onClick={handleDisconnect} disabled={busy}>
                  {busy ? 'Desconectando' : 'Desconectar'}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={handleConnect} disabled={busy || googleStatus.loading}>
                  {busy ? 'Redirigiendo' : 'Conectar Google'}
                </button>
              )}
            </div>
          </div>
        </div>

        {driveFiles.items.length > 0 && (
          <div className="drive-preview-panel">
            <div className="detail-section-title">Drive · archivos recientes</div>
            <div className="drive-preview-list">
              {driveFiles.items.map(file => (
                <a
                  key={file.id}
                  className="drive-preview-row"
                  href={file.webViewLink}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{file.name}</span>
                  <small>{file.mimeType?.replace('application/vnd.google-apps.', '') || 'archivo'}</small>
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="integration-grid">
          {ROADMAP_INTEGRATIONS.map(item => (
            <RoadmapCard key={item.title} item={item} />
          ))}
        </div>
      </div>
    </>
  );
}
