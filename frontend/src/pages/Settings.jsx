import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { useSelfHosted } from '../context/SelfHostedContext';
import '../styles/onboarding.css';

const STORAGE_KEY = 'opus-app-settings';

const DEFAULT_CONFIG = {
  firmName: 'SC LegalTech',
  jurisdiction: 'Colombia',
  timezone: 'America/Bogota',
  currency: 'COP',
  defaultWorkspace: 'despacho',
  casePrefix: 'SC',
  caseYear: '2026',
  deadlineWindow: '7',
  intakeSla: '24',
  defaultService: 'PQRS / Tutela',
  requireReview: true,
  mfaRequired: false,
  idleLockMinutes: '30',
  density: 'comfortable',
  showBoundaryNotes: true,
  backupPolicy: 'daily',
  retentionDays: '30',
};

const SECTIONS = [
  { id: 'general',       label: 'General',       eyebrow: 'Identidad' },
  { id: 'firma',         label: 'Firma',         eyebrow: 'Personalización' },
  { id: 'operacion',     label: 'Operacion',     eyebrow: 'Reglas juridicas' },
  { id: 'seguridad',     label: 'Seguridad',     eyebrow: 'Acceso' },
  { id: 'interfaz',      label: 'Interfaz',      eyebrow: 'Experiencia' },
  { id: 'integraciones', label: 'Integraciones', eyebrow: 'Google Workspace' },
  { id: 'datos',         label: 'Datos',         eyebrow: 'Respaldo' },
];

function Field({ label, children, hint }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function SwitchField({ label, checked, onChange, hint }) {
  return (
    <label className="settings-switch-row">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button
        className={`settings-switch${checked ? ' on' : ''}`}
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span />
      </button>
    </label>
  );
}

// ─── SetupGuide ───────────────────────────────────────────────────────────────
// Instrucciones paso a paso para crear credenciales en Google Cloud Console.

function SetupGuide({ redirectUri }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="settings-setup-guide">
      <button
        type="button"
        className="settings-setup-guide-toggle"
        onClick={() => setOpen(p => !p)}
      >
        <span className="settings-setup-guide-icon">?</span>
        <span>Como obtener credenciales de Google</span>
        <span className="settings-setup-guide-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="settings-setup-guide-body">
          <p className="settings-setup-guide-intro">
            Google exige que registres esta aplicacion en Google Cloud Console antes de
            que los usuarios puedan autorizar acceso a Gmail y Drive. El proceso toma
            aproximadamente 10 minutos y es completamente gratuito.
          </p>

          <ol className="settings-setup-steps">
            <li>
              <strong>Crea un proyecto en Google Cloud Console</strong>
              <p>
                Ve a{' '}
                <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">
                  console.cloud.google.com
                </a>{' '}
                e inicia sesion con la cuenta corporativa de SC LegalTech.
                Haz clic en <em>Seleccionar proyecto → Proyecto nuevo</em> y
                nombra el proyecto <code>opus</code> (o el nombre que
                prefieras).
              </p>
            </li>

            <li>
              <strong>Crea las credenciales OAuth 2.0</strong>
              <p>
                Ve a <em>APIs y servicios → Credenciales → Crear credenciales →
                ID de cliente OAuth 2.0</em>. Selecciona{' '}
                <em>Aplicacion web</em>. Si Google te pide configurar primero
                la pantalla de consentimiento, completa el nombre de la app,
                el correo de soporte y vuelve a credenciales.
              </p>
              <p>
                En <em>Origenes JavaScript autorizados</em>, agrega{' '}
                <code>http://localhost:5173</code>. En{' '}
                <em>URIs de redireccionamiento autorizados</em>, agrega exactamente:
              </p>
              <div className="settings-code-block">
                {redirectUri || 'http://localhost:4000/api/google/auth/callback'}
              </div>
              <p>
                Google te dara un <strong>Client ID</strong> y un{' '}
                <strong>Client Secret</strong>. Copialos en el formulario de
                abajo. No uses una cuenta de servicio: esta integracion necesita
                un ID de cliente OAuth de tipo web.
              </p>
            </li>

            <li>
              <strong>Activa las APIs necesarias</strong>
              <p>
                Con las credenciales ya creadas, ve a{' '}
                <em>APIs y servicios → Biblioteca</em>. Busca y activa:
              </p>
              <ul>
                <li><code>Gmail API</code></li>
                <li><code>Google Drive API</code></li>
              </ul>
              <p>
                Si Google vuelve a pedir credenciales, usa el cliente OAuth web
                que acabas de crear.
              </p>
            </li>

            <li>
              <strong>Completa consentimiento, dominios y scopes</strong>
              <p>
                Ve a <em>Google Auth Platform → Branding</em> o a{' '}
                <em>APIs y servicios → Pantalla de consentimiento de OAuth</em>.
                Usa como nombre de app algo reconocible, por ejemplo{' '}
                <code>Opus</code>, y como correo de soporte la cuenta
                corporativa que administrara la conexion.
              </p>
              <p>
                En dominios autorizados escribe solo dominios reales, por ejemplo
                <code>sclegaltech.com</code>. No pegues scopes como dominios:
                <code>www.googleapis.com/auth/gmail.modify</code> pertenece a
                la seccion de permisos, no a dominios autorizados.
              </p>
              <p>En <em>Data Access</em> o <em>Scopes</em>, agrega:</p>
              <ul>
                <li><code>https://www.googleapis.com/auth/userinfo.email</code></li>
                <li><code>https://www.googleapis.com/auth/gmail.modify</code></li>
                <li><code>https://www.googleapis.com/auth/drive.readonly</code></li>
              </ul>
              <p>
                No agregues <code>gmail.send</code> todavia; el envio de correos
                queda para una siguiente fase. En <em>Usuarios de prueba</em>,
                agrega las cuentas que van a conectarse mientras la app este en
                modo prueba.
              </p>
            </li>

            <li>
              <strong>Guarda las credenciales y conecta</strong>
              <p>
                Pega el Client ID y el Client Secret en el formulario. Haz clic
                en <em>Guardar credenciales</em> y luego en{' '}
                <em>Conectar cuenta Google</em>. Seras redirigido a Google para
                autorizar el acceso.
              </p>
            </li>
          </ol>

          <div className="settings-setup-guide-note">
            <strong>Nota de seguridad:</strong> Las credenciales se almacenan
            cifradas en la base de datos del sistema, no en archivos de
            configuracion. Solo los administradores pueden verlas o modificarlas.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CredentialsForm ──────────────────────────────────────────────────────────
// Lee GET /api/google/config y guarda POST /api/google/config

function CredentialsForm({ onSaved }) {
  const [fields, setFields]   = useState({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_REDIRECT_URI: '' });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [msg,     setMsg]     = useState(null); // { type: 'ok'|'error', text }

  useEffect(() => {
    async function load() {
      try {
        const { data: rows } = await api.get('/google/config'); // [{ key, value, is_secret }, ...]
        const map  = {};
        rows.forEach(r => { map[r.key] = r.value || ''; });
        setFields(prev => ({ ...prev, ...map }));
      } catch (err) {
        console.warn('[CredentialsForm] no se pudo cargar config:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const entries = Object.entries(fields)
        .filter(([, v]) => v && v !== '••••••••')
        .map(([key, value]) => ({ key, value }));

      await api.post('/google/config', entries);
      setMsg({ type: 'ok', text: 'Credenciales guardadas correctamente.' });
      onSaved?.();
    } catch (err) {
      setMsg({ type: 'error', text: err.response?.data?.error || err.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="settings-loading">Cargando configuracion...</div>;

  return (
    <div className="settings-credentials-form">
      <h4 className="settings-subsection-title">Credenciales OAuth 2.0</h4>

      <div className="settings-grid">
        <Field label="Client ID" hint="Identificador publico de tu aplicacion en Google Cloud.">
          <input
            type="text"
            placeholder="xxxx.apps.googleusercontent.com"
            value={fields.GOOGLE_CLIENT_ID}
            onChange={e => setFields(p => ({ ...p, GOOGLE_CLIENT_ID: e.target.value }))}
            autoComplete="off"
          />
        </Field>

        <Field label="Client Secret" hint="Clave privada. Nunca la compartas publicamente.">
          <input
            type="password"
            placeholder="GOCSPX-..."
            value={fields.GOOGLE_CLIENT_SECRET}
            onChange={e => setFields(p => ({ ...p, GOOGLE_CLIENT_SECRET: e.target.value }))}
            autoComplete="new-password"
          />
        </Field>

        <Field
          label="URI de redireccion"
          hint="Debe coincidir exactamente con el valor registrado en Google Cloud Console."
        >
          <input
            type="text"
            placeholder="http://localhost:4000/api/google/auth/callback"
            value={fields.GOOGLE_REDIRECT_URI}
            onChange={e => setFields(p => ({ ...p, GOOGLE_REDIRECT_URI: e.target.value }))}
            autoComplete="off"
          />
        </Field>
      </div>

      {msg && (
        <div className={`settings-msg settings-msg--${msg.type}`}>{msg.text}</div>
      )}

      <div className="settings-credentials-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Guardando...' : 'Guardar credenciales'}
        </button>
      </div>
    </div>
  );
}

// ─── GoogleConnectionCard ─────────────────────────────────────────────────────
// Muestra estado de conexion, servicios activos y boton conectar/desconectar.

const SERVICE_DEFS = [
  {
    key:   'gmail_enabled',
    label: 'Gmail',
    icon:  '✉',
    desc:  'Leer bandeja, importar hilos, marcar correos como leidos y descartar entradas.',
  },
  {
    key:   'drive_enabled',
    label: 'Drive',
    icon:  '◫',
    desc:  'Adjuntar archivos desde Google Drive y organizar documentos del caso.',
  },
  {
    key:   'calendar_enabled',
    label: 'Calendar',
    icon:  '◷',
    desc:  'Sincronizar audiencias y vencimientos con el calendario corporativo. (Proximo)',
    soon:  true,
  },
  {
    key:   'contacts_enabled',
    label: 'Contacts',
    icon:  '◉',
    desc:  'Autocompletar partes del caso con datos de la agenda de Google. (Proximo)',
    soon:  true,
  },
];

function GoogleConnectionCard({ credentialsSaved }) {
  const [status,        setStatus]       = useState(null);   // { connected, email, scopes_granted, gmail_enabled, gmail_modify_enabled, drive_enabled }
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [connecting,    setConnecting]   = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error,         setError]        = useState(null);

  const fetchStatus = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const { data } = await api.get('/google/status');
      setStatus(data);
      setError(null);
    } catch (err) {
      setError('No se pudo obtener el estado de Google Workspace.');
      console.warn('[GoogleConnectionCard] status error:', err);
    } finally {
      setLoadingStatus(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus, credentialsSaved]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { data } = await api.get('/google/auth/url');
      window.location.href = data.url;
    } catch (err) {
      if (err.response?.data?.code === 'GOOGLE_NOT_CONFIGURED') {
        setError('Completa primero la configuracion de credenciales OAuth.');
      } else {
        setError(err.response?.data?.error || err.message);
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Esto revocara el acceso de Opus a tu cuenta Google. Podras reconectar cuando quieras.')) return;
    setDisconnecting(true);
    setError(null);
    try {
      await api.post('/google/disconnect');
      await fetchStatus();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <div className="settings-integration-card">
      <div className="settings-integration-card-header">
        <div className="settings-integration-logo">G</div>
        <div>
          <div className="settings-integration-title">Google Workspace</div>
          <div className="settings-integration-subtitle">
            Gmail · Drive · Calendar · Contacts — una sola autorizacion
          </div>
        </div>

        <div className="settings-integration-status-area">
          {loadingStatus ? (
            <span className="settings-badge settings-badge--neutral">Verificando...</span>
          ) : status?.connected ? (
            <>
              <span className="settings-badge settings-badge--ok">Conectado</span>
              <span className="settings-integration-email">{status.email}</span>
            </>
          ) : (
            <span className="settings-badge settings-badge--off">Sin conectar</span>
          )}
        </div>
      </div>

      {/* Grid de servicios */}
      <div className="settings-services-grid">
        {SERVICE_DEFS.map(svc => {
          const active = !svc.soon && status?.connected && status?.[svc.key];
          return (
            <div
              key={svc.key}
              className={`settings-service-card${active ? ' active' : ''}${svc.soon ? ' soon' : ''}`}
            >
              <div className="settings-service-icon">{svc.icon}</div>
              <div className="settings-service-label">{svc.label}</div>
              <div className="settings-service-desc">{svc.desc}</div>
              {active && <div className="settings-service-pill">Activo</div>}
              {svc.soon && <div className="settings-service-pill soon">Pronto</div>}
            </div>
          );
        })}
      </div>

      {error && <div className="settings-msg settings-msg--error">{error}</div>}
      {status?.connected && !status?.gmail_modify_enabled && (
        <div className="settings-msg settings-msg--warn">
          Gmail esta conectado en modo lectura. Reconecta Google para habilitar marcar como leido y descartar desde Recepcion.
        </div>
      )}

      <div className="settings-integration-actions">
        {status?.connected ? (
          <>
            {!status.gmail_modify_enabled && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleConnect}
                disabled={connecting || loadingStatus}
              >
                {connecting ? 'Redirigiendo a Google...' : 'Reconectar permisos Gmail'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? 'Desconectando...' : 'Desconectar cuenta Google'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleConnect}
            disabled={connecting || loadingStatus}
          >
            {connecting ? 'Redirigiendo a Google...' : 'Conectar cuenta Google'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={fetchStatus}
          disabled={loadingStatus}
        >
          Actualizar estado
        </button>
      </div>
    </div>
  );
}

// ─── Seccion de integraciones ─────────────────────────────────────────────────

function IntegracionesSection() {
  const [credSaved, setCredSaved] = useState(0);

  // Leer la URI de redireccion guardada para mostrarla en la guia
  const [redirectUri, setRedirectUri] = useState('');
  useEffect(() => {
    api.get('/google/config')
      .then(({ data: rows }) => {
        const row = rows.find(r => r.key === 'GOOGLE_REDIRECT_URI');
        if (row?.value && row.value !== '••••••••') setRedirectUri(row.value);
      })
      .catch(() => {});
  }, [credSaved]);

  return (
    <div className="settings-integrations-section">
      <SetupGuide redirectUri={redirectUri} />
      <CredentialsForm onSaved={() => setCredSaved(p => p + 1)} />
      <GoogleConnectionCard credentialsSaved={credSaved} />
    </div>
  );
}

// ─── FirmaSection ─────────────────────────────────────────────────────────────
// Personalización de la firma editable después del onboarding: logo, nombre
// comercial, áreas, jurisdicciones y contexto. Mismos datos del wizard Integra,
// guardados vía /api/onboarding/save. Al guardar, refresca el sidebar.

const PRACTICE_AREAS = [
  ['penal', 'Penal'], ['civil', 'Civil'], ['laboral', 'Laboral'],
  ['familia', 'Familia'], ['comercial', 'Comercial'], ['administrativo', 'Administrativo'],
  ['tributario', 'Tributario'], ['constitucional', 'Constitucional'], ['corporativo', 'Corporativo'],
  ['propiedad_intelectual', 'Propiedad intelectual'], ['migratorio', 'Migratorio'],
  ['ambiental', 'Ambiental'], ['otro', 'Otro'],
];
const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga', 'Cúcuta', 'Pereira', 'Santa Marta', 'Manizales'];

function FirmaSection() {
  const { refresh } = useSelfHosted();
  const fileRef = useRef(null);
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);
  const [areas, setAreas] = useState([]);
  const [jurisdictions, setJurisdictions] = useState([]);
  const [contextNote, setContextNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/onboarding/state')
      .then(({ data }) => {
        const p = data.profile || {};
        setBrandName(data.brand_name || '');
        setLogoUrl(data.logo_url || null);
        setAreas(p.practice_areas || []);
        setJurisdictions(p.jurisdictions || []);
        setContextNote(p.context_note || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const toggle = (arr, setArr, v) => setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const onLogoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === 'image/svg+xml') {
      if (file.size > 120_000) { alert('El SVG es muy grande (máx 120 KB).'); return; }
      const r = new FileReader(); r.onload = () => setLogoUrl(r.result); r.readAsDataURL(file); return;
    }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        setLogoUrl(canvas.toDataURL('image/png'));
      };
      img.onerror = () => alert('No se pudo leer la imagen.');
      img.src = r.result;
    };
    r.readAsDataURL(file);
  };

  const save = async () => {
    setSaving(true); setSaved(false);
    try {
      await api.post('/onboarding/save', {
        brand_name: brandName || undefined,
        practice_areas: areas,
        jurisdictions,
        context_note: contextNote,
        logo_data_url: logoUrl === null ? null : (logoUrl?.startsWith('data:') ? logoUrl : undefined),
      });
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch { /* noop */ }
    finally { setSaving(false); }
  };

  if (loading) return <div className="ob-root" style={{ minHeight: 'auto', background: 'none', padding: 0 }}><p style={{ color: 'var(--text-secondary)' }}>Cargando…</p></div>;

  const initial = (brandName || 'F').trim().charAt(0).toUpperCase();

  return (
    <div className="ob-root" style={{ minHeight: 'auto', background: 'none', padding: 0 }}>
      <div className="ob-options" style={{ maxWidth: 640 }}>
        {/* Marca */}
        <div className="ob-logo-row">
          <div className="ob-logo-drop" onClick={() => fileRef.current?.click()}>
            {logoUrl ? <img src={logoUrl} alt="Logo" /> : <span>Subir logo</span>}
          </div>
          <div className="ob-logo-side">
            <label className="ob-label">Logo de tu firma</label>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={onLogoPick} style={{ display: 'none' }} />
            <div className="ob-logo-actions">
              <button type="button" className="ob-logo-link" onClick={() => fileRef.current?.click()}>{logoUrl ? 'Cambiar' : 'Elegir archivo'}</button>
              {logoUrl && <button type="button" className="ob-logo-link" onClick={() => setLogoUrl(null)}>Quitar</button>}
            </div>
            <div className="ob-hint">PNG, JPG o SVG. Se redimensiona automáticamente.</div>
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Nombre comercial</label>
          <input className="ob-input" value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Cómo se conoce tu firma" />
        </div>

        <div className="ob-brand-preview">
          <div className="ob-brand-preview-mark">{logoUrl ? <img src={logoUrl} alt="" /> : initial}</div>
          <div>
            <div className="ob-brand-preview-name">{brandName || 'Tu firma'}</div>
            <div className="ob-brand-preview-sub">Opus</div>
          </div>
        </div>

        <div>
          <label className="ob-label" style={{ marginBottom: 10 }}>Áreas de práctica</label>
          <div className="ob-chips">
            {PRACTICE_AREAS.map(([key, label]) => (
              <button key={key} className={`ob-chip${areas.includes(key) ? ' is-on' : ''}`} onClick={() => toggle(areas, setAreas, key)}>{label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="ob-label" style={{ marginBottom: 10 }}>Jurisdicciones</label>
          <div className="ob-chips">
            {CITIES.map((city) => (
              <button key={city} className={`ob-chip${jurisdictions.includes(city) ? ' is-on' : ''}`} onClick={() => toggle(jurisdictions, setJurisdictions, city)}>{city}</button>
            ))}
          </div>
        </div>

        <div className="ob-field">
          <label className="ob-label">Contexto de tu operación</label>
          <textarea className="ob-textarea" value={contextNote} onChange={(e) => setContextNote(e.target.value)} placeholder="Particularidades de tu firma, sistemas que usas, lo que esperas de Opus." />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="ob-btn" style={{ width: 'auto', padding: '12px 28px' }} onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
          {saved && <span className="ob-hint ob-hint--ok">Cambios guardados ✓</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Settings principal ───────────────────────────────────────────────────────

export default function Settings() {
  const { firm } = useSelfHosted();
  const [activeSection, setActiveSection] = useState('general');
  const [config, setConfig]               = useState(DEFAULT_CONFIG);
  const [saved,  setSaved]                = useState(false);

  // Detectar retorno del callback OAuth y accesos directos a secciones.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('google') === 'connected') {
      setActiveSection('integraciones');
      // Limpiar la URL sin recargar
      const clean = window.location.pathname;
      window.history.replaceState({}, '', clean);
      return;
    }

    const section = params.get('section');
    if (section && SECTIONS.some(s => s.id === section)) {
      setActiveSection(section);
    }
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setConfig(prev => ({ ...prev, ...JSON.parse(stored) }));
    } catch (err) {
      console.warn('No fue posible cargar configuracion local', err);
    }
  }, []);

  const activeMeta = useMemo(
    () => SECTIONS.find(s => s.id === activeSection) || SECTIONS[0],
    [activeSection]
  );

  const update = (key, value) => {
    setSaved(false);
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    setSaved(true);
  };

  const handleReset = () => {
    setConfig(DEFAULT_CONFIG);
    window.localStorage.removeItem(STORAGE_KEY);
    setSaved(false);
  };

  const isLocalSection = activeSection !== 'integraciones';

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">Configuracion</div>
          <div className="page-subtitle">Preferencias globales de la aplicacion y gobierno operativo</div>
        </div>
        {isLocalSection && (
          <div className="area-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleReset}>Restaurar</button>
            <button className="btn btn-primary btn-sm" onClick={handleSave}>Guardar vista local</button>
          </div>
        )}
      </div>

      <div className="page-body">
        {saved && isLocalSection && (
          <div className="settings-notice">
            Configuracion guardada en este navegador.
          </div>
        )}

        <div className="settings-shell">
          <aside className="settings-menu">
            {SECTIONS.map(section => (
              <button
                key={section.id}
                className={`settings-menu-item${activeSection === section.id ? ' active' : ''}`}
                type="button"
                onClick={() => setActiveSection(section.id)}
              >
                <span>{section.eyebrow}</span>
                {section.label}
              </button>
            ))}
          </aside>

          <section className="settings-panel">
            <div className="settings-panel-header">
              <div>
                <div className="settings-panel-eyebrow">{activeMeta.eyebrow}</div>
                <h2>{activeMeta.label}</h2>
              </div>
              {isLocalSection && (
                <span className="settings-local-badge">borrador local</span>
              )}
            </div>

            {/* ── General ── */}
            {activeSection === 'general' && (
              <div className="settings-grid">
                <Field label="Nombre de la firma" hint="Se edita en la sección Firma (personalización de tu marca).">
                  <input value={firm?.brand_name || ''} readOnly placeholder="Tu firma" style={{ opacity: 0.7 }} />
                </Field>
                <Field label="Jurisdiccion base">
                  <input value={config.jurisdiction} onChange={e => update('jurisdiction', e.target.value)} />
                </Field>
                <Field label="Zona horaria">
                  <select value={config.timezone} onChange={e => update('timezone', e.target.value)}>
                    <option value="America/Bogota">America/Bogota</option>
                    <option value="America/New_York">America/New_York</option>
                    <option value="UTC">UTC</option>
                  </select>
                </Field>
                <Field label="Moneda principal">
                  <select value={config.currency} onChange={e => update('currency', e.target.value)}>
                    <option value="COP">COP</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
              </div>
            )}

            {/* ── Operacion ── */}
            {activeSection === 'operacion' && (
              <div className="settings-grid">
                <Field label="Prefijo de casos">
                  <input value={config.casePrefix} onChange={e => update('casePrefix', e.target.value.toUpperCase())} />
                </Field>
                <Field label="Ano operativo">
                  <input value={config.caseYear} onChange={e => update('caseYear', e.target.value)} />
                </Field>
                <Field label="Ventana de vencimientos" hint="Dias que se consideran proximos en bandejas y alertas.">
                  <input type="number" min="1" value={config.deadlineWindow} onChange={e => update('deadlineWindow', e.target.value)} />
                </Field>
                <Field label="SLA de recepcion" hint="Horas esperadas para revisar una nueva entrada.">
                  <input type="number" min="1" value={config.intakeSla} onChange={e => update('intakeSla', e.target.value)} />
                </Field>
                <Field label="Servicio por defecto">
                  <select value={config.defaultService} onChange={e => update('defaultService', e.target.value)}>
                    <option>PQRS / Tutela</option>
                    <option>Contrato</option>
                    <option>Laboral</option>
                    <option>Regulatorio</option>
                    <option>Otro</option>
                  </select>
                </Field>
                <SwitchField
                  label="Exigir revision humana"
                  checked={config.requireReview}
                  onChange={value => update('requireReview', value)}
                  hint="Las sugerencias de IA o integraciones quedan como propuesta antes de aplicar cambios sensibles."
                />
              </div>
            )}

            {/* ── Seguridad ── */}
            {activeSection === 'seguridad' && (
              <div className="settings-grid">
                <SwitchField
                  label="Requerir MFA"
                  checked={config.mfaRequired}
                  onChange={value => update('mfaRequired', value)}
                  hint="Preparado para una politica de doble factor cuando exista el modulo de autenticacion avanzado."
                />
                <Field label="Bloqueo por inactividad">
                  <select value={config.idleLockMinutes} onChange={e => update('idleLockMinutes', e.target.value)}>
                    <option value="15">15 minutos</option>
                    <option value="30">30 minutos</option>
                    <option value="60">60 minutos</option>
                  </select>
                </Field>
                <div className="settings-readonly-card">
                  <strong>Roles actuales</strong>
                  <span>Admin, abogado, asistente. La gestion de usuarios debe conectarse al backend antes de editar permisos reales.</span>
                </div>
              </div>
            )}

            {/* ── Interfaz ── */}
            {activeSection === 'interfaz' && (
              <div className="settings-grid">
                <Field label="Pantalla inicial">
                  <select value={config.defaultWorkspace} onChange={e => update('defaultWorkspace', e.target.value)}>
                    <option value="despacho">Despacho</option>
                    <option value="recepcion">Recepcion</option>
                    <option value="office">Oficina</option>
                  </select>
                </Field>
                <Field label="Densidad visual">
                  <select value={config.density} onChange={e => update('density', e.target.value)}>
                    <option value="comfortable">Comoda</option>
                    <option value="compact">Compacta</option>
                  </select>
                </Field>
                <SwitchField
                  label="Mostrar notas de frontera"
                  checked={config.showBoundaryNotes}
                  onChange={value => update('showBoundaryNotes', value)}
                  hint="Mantiene visibles las notas que separan registros, despacho e integraciones."
                />
              </div>
            )}

            {/* ── Firma (personalización: marca, logo, perfil) ── */}
            {activeSection === 'firma' && <FirmaSection />}

            {/* ── Integraciones (Google Workspace) ── */}
            {activeSection === 'integraciones' && <IntegracionesSection />}

            {/* ── Datos ── */}
            {activeSection === 'datos' && (
              <div className="settings-grid">
                <Field label="Politica de backup">
                  <select value={config.backupPolicy} onChange={e => update('backupPolicy', e.target.value)}>
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="manual">Manual</option>
                  </select>
                </Field>
                <Field label="Retencion minima">
                  <input type="number" min="1" value={config.retentionDays} onChange={e => update('retentionDays', e.target.value)} />
                </Field>
                <div className="settings-readonly-card">
                  <strong>Backup operativo</strong>
                  <span>El respaldo diario ya vive fuera de esta pantalla. Esta seccion define como deberia verse su gobierno dentro de la app.</span>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
