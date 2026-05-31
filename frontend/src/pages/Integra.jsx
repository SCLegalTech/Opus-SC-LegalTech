import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useSelfHosted } from '../context/SelfHostedContext';
import phiMark from '../assets/brand/logo-aureo.png';
import '../styles/onboarding.css';

// Integra — onboarding de Opus · SC LegalTech.
// Wizard editorial: copy a la izquierda, opciones a la derecha, notas que
// contemplan alternativas. Incluye marca de la firma (logo + nombre),
// campo libre de contexto e integraciones REALES (Google OAuth vía popup).

const PRACTICE_AREAS = [
  ['penal', 'Penal'], ['civil', 'Civil'], ['laboral', 'Laboral'],
  ['familia', 'Familia'], ['comercial', 'Comercial'], ['administrativo', 'Administrativo'],
  ['tributario', 'Tributario'], ['constitucional', 'Constitucional'], ['corporativo', 'Corporativo'],
  ['propiedad_intelectual', 'Propiedad intelectual'], ['migratorio', 'Migratorio'],
  ['ambiental', 'Ambiental'], ['otro', 'Otro'],
];
const SIZES = [
  ['solo', 'Solo yo', 'Práctica independiente'],
  ['2-5', '2 a 5', 'Equipo pequeño'],
  ['6-15', '6 a 15', 'Firma en crecimiento'],
  ['16-50', '16 a 50', 'Firma consolidada'],
  ['50+', 'Más de 50', 'Gran firma'],
];
const CITIES = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla', 'Cartagena', 'Bucaramanga', 'Cúcuta', 'Pereira', 'Santa Marta', 'Manizales'];

export default function Integra() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { refresh } = useSelfHosted();
  const fileRef = useRef(null);

  const [step, setStep] = useState(0);
  const [areas, setAreas] = useState([]);
  const [size, setSize] = useState('');
  const [jurisdictions, setJurisdictions] = useState(['Bogotá']);
  const [integrations, setIntegrations] = useState([]);
  const [contextNote, setContextNote] = useState('');
  const [brandName, setBrandName] = useState('');
  const [logoUrl, setLogoUrl] = useState(null);
  const [saving, setSaving] = useState(false);

  const [google, setGoogle] = useState({ connected: false, email: null, configured: true, checking: true });
  const [googleConnecting, setGoogleConnecting] = useState(false);

  const TOTAL = 7;

  useEffect(() => {
    api.get('/onboarding/state')
      .then(({ data }) => {
        const p = data.profile || {};
        if (p.practice_areas) setAreas(p.practice_areas);
        if (p.size) setSize(p.size);
        if (p.jurisdictions?.length) setJurisdictions(p.jurisdictions);
        if (p.integrations) setIntegrations(p.integrations);
        if (p.context_note) setContextNote(p.context_note);
        if (data.brand_name) setBrandName(data.brand_name);
        if (data.logo_url) setLogoUrl(data.logo_url);
      })
      .catch(() => {});
    checkGoogle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkGoogle = useCallback(async () => {
    try {
      const { data } = await api.get('/google/status');
      setGoogle({ connected: !!data.connected, email: data.email || null, configured: true, checking: false });
      if (data.connected) setIntegrations((p) => Array.from(new Set([...p, 'gmail', 'calendar', 'drive'])));
    } catch (err) {
      const notConfigured = err.response?.status === 409 || err.response?.data?.code === 'GOOGLE_NOT_CONFIGURED';
      setGoogle({ connected: false, email: null, configured: !notConfigured, checking: false });
    }
  }, []);

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    try {
      const { data } = await api.get('/google/auth/url');
      const popup = window.open(data.url, 'google-oauth', 'width=520,height=680');
      const timer = setInterval(async () => {
        let connected = false;
        try {
          const { data: st } = await api.get('/google/status');
          connected = !!st.connected;
          if (connected) {
            setGoogle({ connected: true, email: st.email || null, configured: true, checking: false });
            setIntegrations((p) => Array.from(new Set([...p, 'gmail', 'calendar', 'drive'])));
          }
        } catch { /* ignore */ }
        if (connected || (popup && popup.closed)) {
          clearInterval(timer); setGoogleConnecting(false);
          if (popup && !popup.closed) popup.close();
        }
      }, 2000);
    } catch (err) {
      setGoogleConnecting(false);
      if (err.response?.status === 409) setGoogle((g) => ({ ...g, configured: false }));
    }
  };

  // Redimensiona el logo en el cliente a máx 256px y lo comprime, para que
  // siempre quepa (antes un PNG grande se rechazaba en silencio). SVG se
  // guarda tal cual (es liviano y escala). Para raster usamos canvas → PNG.
  const onLogoPick = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type === 'image/svg+xml') {
      if (file.size > 120_000) { alert('El SVG es muy grande (máx 120 KB).'); return; }
      const r = new FileReader();
      r.onload = () => setLogoUrl(r.result);
      r.readAsDataURL(file);
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 256;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        // PNG conserva transparencia; el resultado a 256px pesa pocos KB.
        setLogoUrl(canvas.toDataURL('image/png'));
      };
      img.onerror = () => alert('No se pudo leer la imagen.');
      img.src = r.result;
    };
    r.readAsDataURL(file);
  };

  const toggle = (arr, setArr, value) =>
    setArr(arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value]);

  const saveStep = async (complete = false) => {
    setSaving(true);
    try {
      await api.post('/onboarding/save', {
        practice_areas: areas, size, jurisdictions, integrations,
        context_note: contextNote,
        brand_name: brandName || undefined,
        logo_data_url: logoUrl && logoUrl.startsWith('data:') ? logoUrl : undefined,
        complete,
      });
    } catch { /* best-effort */ }
    finally { setSaving(false); }
  };

  const next = async () => { await saveStep(); setStep((s) => Math.min(s + 1, TOTAL - 1)); };
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const finish = async () => { await saveStep(true); await refresh(); navigate('/'); };

  const progress = useMemo(() => Math.round((step / (TOTAL - 1)) * 100), [step]);
  const firstName = user?.name ? user.name.split(' ')[0] : '';
  const previewInitial = (brandName || 'F').trim().charAt(0).toUpperCase();

  return (
    <div className="ob-root ob-wizard">
      <div className="ob-wizard-top">
        <img src={phiMark} alt="" className="ob-wizard-mark" />
        <div className="ob-wizard-brand">Integra · <strong>Opus</strong></div>
        <div className="ob-progress"><div className="ob-progress-fill" style={{ width: `${progress}%` }} /></div>
        <span className="ob-step-count">{step + 1} / {TOTAL}</span>
        <button className="ob-skip" onClick={finish}>Omitir por ahora</button>
      </div>

      <div className="ob-stage">
        {/* 0 · Bienvenida */}
        {step === 0 && (
          <div className="ob-center">
            <span className="ob-kicker">Bienvenido{firstName ? `, ${firstName}` : ''}</span>
            <h1 className="ob-serif ob-step-title">Preparemos tu Opus</h1>
            <p className="ob-step-lead">
              Integra es el ritual de inicio: unas preguntas para entender tu
              firma y conectar tus fuentes de trabajo. Lo que configures aquí
              moldea cómo Opus piensa tu operación, y puedes ajustarlo cuando
              quieras.
            </p>
            <div><button className="ob-cta" onClick={next}>Comenzar</button></div>
          </div>
        )}

        {/* 1 · Áreas */}
        {step === 1 && (
          <div className="ob-step">
            <div className="ob-step-copy">
              <span className="ob-step-num">01 — Tu práctica</span>
              <h2 className="ob-serif ob-step-title">¿En qué áreas ejerces?</h2>
              <p className="ob-step-lead">Opus prioriza el contexto y los plazos según tus áreas. Elige todas las que apliquen.</p>
              <p className="ob-step-aside-note">¿Tu práctica es transversal? Selecciona varias o marca "Otro"; lo afinamos con el uso real.</p>
            </div>
            <div className="ob-options">
              <div className="ob-chips">
                {PRACTICE_AREAS.map(([key, label]) => (
                  <button key={key} className={`ob-chip${areas.includes(key) ? ' is-on' : ''}`}
                    onClick={() => toggle(areas, setAreas, key)}>{label}</button>
                ))}
              </div>
              <Nav onBack={back} onNext={next} disabled={!areas.length} saving={saving} />
            </div>
          </div>
        )}

        {/* 2 · Tamaño */}
        {step === 2 && (
          <div className="ob-step">
            <div className="ob-step-copy">
              <span className="ob-step-num">02 — Tu equipo</span>
              <h2 className="ob-serif ob-step-title">¿Qué tamaño tiene tu firma?</h2>
              <p className="ob-step-lead">Nos ayuda a dimensionar tu operación, los reportes y la colaboración.</p>
              <p className="ob-step-aside-note">Si proyectas crecer, elige tu tamaño de hoy. Opus escala contigo sin reconfigurar.</p>
            </div>
            <div className="ob-options">
              <div className="ob-cards">
                {SIZES.map(([key, label, desc]) => (
                  <button key={key} className={`ob-card${size === key ? ' is-on' : ''}`} onClick={() => setSize(key)}>
                    <div className="ob-card-title">{label}</div>
                    <div className="ob-card-desc">{desc}</div>
                  </button>
                ))}
              </div>
              <Nav onBack={back} onNext={next} disabled={!size} saving={saving} />
            </div>
          </div>
        )}

        {/* 3 · Jurisdicciones */}
        {step === 3 && (
          <div className="ob-step">
            <div className="ob-step-copy">
              <span className="ob-step-num">03 — Tu territorio</span>
              <h2 className="ob-serif ob-step-title">¿Dónde litigas?</h2>
              <p className="ob-step-lead">Las ciudades donde operas determinan qué despachos y plazos vigila el Radar judicial.</p>
              <p className="ob-step-aside-note">Marca las principales ahora; podrás agregar más desde el Radar.</p>
            </div>
            <div className="ob-options">
              <div className="ob-chips">
                {CITIES.map((city) => (
                  <button key={city} className={`ob-chip${jurisdictions.includes(city) ? ' is-on' : ''}`}
                    onClick={() => toggle(jurisdictions, setJurisdictions, city)}>{city}</button>
                ))}
              </div>
              <Nav onBack={back} onNext={next} disabled={!jurisdictions.length} saving={saving} />
            </div>
          </div>
        )}

        {/* 4 · Tu marca (logo + contexto libre) */}
        {step === 4 && (
          <div className="ob-step">
            <div className="ob-step-copy">
              <span className="ob-step-num">04 — Tu marca</span>
              <h2 className="ob-serif ob-step-title">Pon tu sello</h2>
              <p className="ob-step-lead">
                Opus lleva la marca de tu firma. Sube tu logo y confirma tu
                nombre comercial: así verás tu identidad en el sistema, con
                Opus como el motor detrás.
              </p>
              <p className="ob-step-aside-note">
                ¿No tienes logo a mano? Puedes dejarlo en blanco y usar tus
                iniciales por ahora; lo cambias después en Configuración.
              </p>
            </div>
            <div className="ob-options">
              <div className="ob-logo-row">
                <div className="ob-logo-drop" onClick={() => fileRef.current?.click()}>
                  {logoUrl ? <img src={logoUrl} alt="Logo" /> : <span>Subir logo</span>}
                </div>
                <div className="ob-logo-side">
                  <label className="ob-label">Logo de tu firma</label>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={onLogoPick} style={{ display: 'none' }} />
                  <div className="ob-logo-actions">
                    <button type="button" className="ob-logo-link" onClick={() => fileRef.current?.click()}>
                      {logoUrl ? 'Cambiar' : 'Elegir archivo'}
                    </button>
                    {logoUrl && <button type="button" className="ob-logo-link" onClick={() => setLogoUrl(null)}>Quitar</button>}
                  </div>
                  <div className="ob-hint">PNG, JPG o SVG. Máximo 280 KB.</div>
                </div>
              </div>

              <div className="ob-field" style={{ marginTop: 6 }}>
                <label className="ob-label">Nombre comercial de tu firma</label>
                <input className="ob-input" value={brandName} onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Cómo se conoce tu firma" />
              </div>

              <div className="ob-brand-preview">
                <div className="ob-brand-preview-mark">
                  {logoUrl ? <img src={logoUrl} alt="" /> : previewInitial}
                </div>
                <div>
                  <div className="ob-brand-preview-name">{brandName || 'Tu firma'}</div>
                  <div className="ob-brand-preview-sub">Opus</div>
                </div>
              </div>

              <div className="ob-field">
                <label className="ob-label">¿Algo más que debamos saber? <span style={{ color: 'var(--ob-faint)' }}>(opcional)</span></label>
                <textarea className="ob-textarea" value={contextNote} onChange={(e) => setContextNote(e.target.value)}
                  placeholder="Cuéntanos cualquier particularidad de tu operación, sistemas que usas hoy, o lo que esperas de Opus." />
              </div>

              <Nav onBack={back} onNext={next} saving={saving} />
            </div>
          </div>
        )}

        {/* 5 · Integraciones reales */}
        {step === 5 && (
          <div className="ob-step">
            <div className="ob-step-copy">
              <span className="ob-step-num">05 — Tus fuentes</span>
              <h2 className="ob-serif ob-step-title">Conecta tu trabajo</h2>
              <p className="ob-step-lead">Integra concentra tus correos, calendario y documentos en el expediente. Conecta Google ahora con un clic; el resto puede esperar.</p>
              <p className="ob-step-aside-note">¿Prefieres no conectar nada todavía? Puedes saltar y trabajar con carga manual. Conectar después toma diez segundos desde Configuración.</p>
            </div>
            <div className="ob-options">
              <div className="ob-int-list">
                <button className={`ob-int${google.connected ? ' is-on' : ''}`}
                  onClick={() => !google.connected && google.configured && connectGoogle()}
                  disabled={!google.configured || googleConnecting || google.connected}>
                  <div className="ob-int-body">
                    <div className="ob-int-name">Google Workspace</div>
                    <div className="ob-int-desc">
                      Gmail, Calendar y Drive en una sola conexión.
                      {google.connected && google.email ? ` · ${google.email}` : ''}
                    </div>
                  </div>
                  {google.connected
                    ? <span className="ob-int-state ob-int-state--connected">Conectado ✓</span>
                    : !google.configured
                      ? <span className="ob-int-premium">No disponible aquí</span>
                      : <span className="ob-int-state">{googleConnecting ? 'Conectando…' : 'Conectar →'}</span>}
                </button>

                <button className={`ob-int${integrations.includes('folder') ? ' is-on' : ''}`}
                  onClick={() => toggle(integrations, setIntegrations, 'folder')}>
                  <div className="ob-int-body">
                    <div className="ob-int-name">Archivos locales</div>
                    <div className="ob-int-desc">Sube carpetas y documentos desde tu computador.</div>
                  </div>
                  <span className="ob-int-state">{integrations.includes('folder') ? 'Activado ✓' : 'Activar'}</span>
                </button>

                <button className={`ob-int${integrations.includes('whatsapp') ? ' is-on' : ''}`}
                  onClick={() => toggle(integrations, setIntegrations, 'whatsapp')}>
                  <div className="ob-int-body">
                    <div className="ob-int-name">WhatsApp Business</div>
                    <div className="ob-int-desc">Atiende y registra conversaciones con clientes.</div>
                  </div>
                  <span className="ob-int-state">{integrations.includes('whatsapp') ? 'Marcado ✓' : 'Me interesa'}</span>
                </button>

                <button className="ob-int" disabled title="Próximamente">
                  <div className="ob-int-body">
                    <div className="ob-int-name">Microsoft 365</div>
                    <div className="ob-int-desc">Outlook y OneDrive.</div>
                  </div>
                  <span className="ob-int-premium">Próximamente</span>
                </button>
              </div>
              <Nav onBack={back} onNext={next} saving={saving} />
            </div>
          </div>
        )}

        {/* 6 · Listo */}
        {step === 6 && (
          <div className="ob-center">
            <span className="ob-kicker">Todo listo</span>
            <h1 className="ob-serif ob-step-title">Opus está preparado</h1>
            <p className="ob-step-lead">
              Configuramos tu despacho con el perfil de tu firma
              {google.connected ? ' y tu cuenta de Google conectada' : ''}. Todo
              se ajusta cuando quieras desde Configuración.
            </p>
            <div><button className="ob-cta" onClick={finish} disabled={saving}>
              {saving ? 'Preparando…' : 'Entrar a mi despacho'}
            </button></div>
          </div>
        )}
      </div>
    </div>
  );
}

function Nav({ onBack, onNext, disabled, saving, nextLabel = 'Continuar' }) {
  return (
    <div className="ob-nav-row">
      <button className="ob-btn ob-btn--ghost" onClick={onBack} type="button">Atrás</button>
      <button className="ob-cta" onClick={onNext} type="button" disabled={disabled || saving}>
        {saving ? 'Guardando…' : nextLabel}
      </button>
    </div>
  );
}
