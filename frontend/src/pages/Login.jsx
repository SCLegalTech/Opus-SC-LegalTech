import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import phiMark from '../assets/brand/logo-aureo.png';
import '../styles/onboarding.css';

// Inicio de sesion de Opus SC LegalTech.

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

export default function Login() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const googleButtonRef = useRef(null);

  const [view, setView] = useState('login'); // 'login' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authConfig, setAuthConfig] = useState({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);

  const googleEnabled = useMemo(
    () => Boolean(GOOGLE_CLIENT_ID && authConfig?.google_enabled),
    [authConfig],
  );

  useEffect(() => {
    api.get('/auth/config')
      .then((res) => setAuthConfig(res.data))
      .catch(() => setAuthConfig({ google_enabled: Boolean(GOOGLE_CLIENT_ID) }));
  }, []);

  // Carga el script de Google Identity una sola vez.
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || window.google || document.getElementById('google-identity-script')) return;
    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGoogleReady(true);
    document.head.appendChild(script);
  }, []);

  // Inicializa y renderiza el botÃ³n de Google (solo en la vista de login).
  useEffect(() => {
    if (view !== 'login' || !googleEnabled || !window.google) return;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: async (response) => {
        setError('');
        setLoading(true);
        try {
          await loginWithGoogle({ credential: response.credential });
          navigate('/');
        } catch (err) {
          setError(err.response?.data?.error || 'No se pudo ingresar con Google');
        } finally {
          setLoading(false);
        }
      },
    });

    if (googleButtonRef.current) {
      googleButtonRef.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 330,
        text: 'signin_with',
        shape: 'rectangular',
      });
      setGoogleReady(true);
    }
  }, [view, googleEnabled, googleReady, loginWithGoogle, navigate]);

  const switchView = (next) => {
    setView(next);
    setError('');
    setNotice('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'No se pudo iniciar sesiÃ³n. Revisa tus datos.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const generic = 'Si existe una cuenta con ese correo, te enviaremos un enlace para restablecer tu contraseÃ±a.';
    try {
      const { data } = await api.post('/auth/forgot-password', { email: email.trim() });
      setNotice(data?.message || generic);
    } catch {
      // El backend responde genÃ©rico siempre; ante un fallo de red mostramos lo mismo.
      setNotice(generic);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ob-root ob-split">
      <div className="ob-video-overlay" />

      {/* Panel editorial sobre el video */}
      <aside className="ob-aside">
        <Link to="/" className="ob-aside-top" aria-label="Opus Â· ir al inicio">
          <img src={phiMark} alt="" className="ob-aside-mark" />
          <div className="ob-aside-brand"><strong>Opus</strong> Â· SC LegalTech</div>
        </Link>

        <div>
          <span className="ob-kicker">Acceso a la plataforma</span>
          <h1 className="ob-serif ob-aside-headline" style={{ marginTop: 14 }}>
            Bienvenido de vuelta a la operaciÃ³n de tu firma.
          </h1>
          <p className="ob-aside-lead">
            Tus casos, comunicaciones y plazos te esperan donde los dejaste,
            con control humano sobre cada accion relevante.
          </p>
          <ul className="ob-aside-points">
            <li><span>â€”</span> Expediente vivo: contexto listo para decidir.</li>
            <li><span>â€”</span> Seguimiento judicial de solo lectura.</li>
            <li><span>â€”</span> Acciones relevantes con aprobacion humana trazable.</li>
          </ul>
        </div>

        <div className="ob-aside-foot">Smart Crypto Legal S.A.S Â· BogotÃ¡ Â· Colombia</div>
      </aside>

      {/* Formulario: inicio de sesiÃ³n o recuperaciÃ³n de contraseÃ±a */}
      <section className="ob-form-col">
        {view === 'login' ? (
          <form className="ob-form" onSubmit={handleSubmit} noValidate>
            <Link to="/" className="ob-mark-link" aria-label="Ir al inicio">
              <img src={phiMark} alt="" className="ob-form-mark" />
            </Link>
            <span className="ob-kicker">Inicia sesiÃ³n</span>
            <h2 className="ob-serif ob-h1">Ingresa a Opus</h2>
            <p className="ob-sub">
              Usa tu correo y contraseÃ±a{googleEnabled ? ', o continÃºa con Google' : ''}.
            </p>

            {googleEnabled && (
              <>
                <div className="ob-google-shell">
                  <div ref={googleButtonRef} />
                  {!googleReady && <span className="ob-hint">Preparando acceso seguroâ€¦</span>}
                </div>
                <div className="ob-divider"><span>o con tu correo</span></div>
              </>
            )}

            <div className="ob-field">
              <label className="ob-label">Correo electrÃ³nico</label>
              <input
                className="ob-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="abogado@tufirma.com"
                autoComplete="email"
                autoFocus
              />
            </div>

            <div className="ob-field">
              <label className="ob-label">ContraseÃ±a</label>
              <input
                className="ob-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tu contraseÃ±a"
                autoComplete="current-password"
              />
            </div>

            <button type="button" className="ob-forgot-link" onClick={() => switchView('forgot')}>
              Â¿Olvidaste tu contraseÃ±a?
            </button>

            {error && <div className="ob-error-box">{error}</div>}

            <button className="ob-btn" type="submit" disabled={loading}>
              {loading ? 'Verificandoâ€¦' : 'Entrar'}
            </button>

            <div className="ob-foot-note">
              No tienes cuenta? <a href="mailto:admin@sclegaltech.com?subject=Opus%20SC%20LegalTech%20acceso" className="ob-link">Contacta a SC LegalTech</a>
            </div>
          </form>
        ) : (
          <form className="ob-form" onSubmit={handleForgot} noValidate>
            <Link to="/" className="ob-mark-link" aria-label="Ir al inicio">
              <img src={phiMark} alt="" className="ob-form-mark" />
            </Link>
            <span className="ob-kicker">Recuperar acceso</span>
            <h2 className="ob-serif ob-h1">Â¿Olvidaste tu contraseÃ±a?</h2>
            <p className="ob-sub">
              Escribe tu correo y te enviaremos un enlace para crear una nueva
              contraseÃ±a. El enlace vence en una hora.
            </p>

            {notice && <div className="ob-notice">{notice}</div>}

            <div className="ob-field">
              <label className="ob-label">Correo electrÃ³nico</label>
              <input
                className="ob-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="abogado@tufirma.com"
                autoComplete="email"
                autoFocus
              />
            </div>

            {error && <div className="ob-error-box">{error}</div>}

            <button className="ob-btn" type="submit" disabled={loading}>
              {loading ? 'Enviandoâ€¦' : 'Enviar enlace de recuperaciÃ³n'}
            </button>

            <div className="ob-foot-note">
              <button
                type="button"
                className="ob-link"
                style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
                onClick={() => switchView('login')}
              >
                â† Volver a iniciar sesiÃ³n
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
