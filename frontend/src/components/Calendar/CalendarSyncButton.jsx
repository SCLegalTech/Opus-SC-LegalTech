import { useEffect, useState } from 'react';
import api from '../../services/api';

/**
 * CalendarSyncButton — botón en CaseDetail que empuja vencimientos y
 * audiencias del caso al Google Calendar del abogado.
 *
 * Diseñado como popover explicativo: el usuario abre el botón y ve
 * qué hace, cuántos elementos sincronizables hay, qué se sincronizará
 * y dónde verlo (con link a calendar.google.com).
 */

export default function CalendarSyncButton({ caseId }) {
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [prefs, setPrefs] = useState(null);

  useEffect(() => {
    if (!open) return;
    api.get('/calendar/prefs').then((r) => setPrefs(r.data)).catch(() => setPrefs(null));
  }, [open]);

  const sync = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.post(`/cases/${caseId}/calendar/sync`, {}, { timeout: 60000 });
      const data = res.data;

      // Detectar caso "todo falló por mismo motivo de scope": tratar como error global.
      const allErrors = (data.errors?.length || 0) > 0 && (data.vencimientos === 0 && data.actuaciones === 0);
      const allScopeErrors = allErrors && data.errors.every(
        (e) => /scope|permis|reconect/i.test(e.error)
      );
      if (allScopeErrors) {
        setError({
          msg: 'Google Calendar no autorizó este permiso. Reconecta Google.',
          fix: 'Ve a Ajustes → Integraciones → Google y reconéctate aceptando "Google Calendar".',
          showReconnect: true,
        });
      } else {
        setResult(data);
      }
    } catch (err) {
      const code = err.response?.data?.code;
      if (code === 'CALENDAR_NOT_CONNECTED' || code === 'CALENDAR_SCOPE_REQUIRED') {
        setError({
          msg: 'Google Calendar no está conectado o no autorizó este permiso.',
          fix: 'Ve a Ajustes → Integraciones → Google y reconéctate aceptando "Google Calendar".',
          showReconnect: true,
        });
      } else {
        setError({ msg: err.response?.data?.error || 'Error sincronizando', fix: null });
      }
    } finally {
      setSyncing(false);
    }
  };

  const reconnect = () => {
    // El módulo google-workspace inicia OAuth con el scope actualizado de ALL_SCOPES.
    api.get('/google/auth/url').then((res) => {
      if (res.data?.url) {
        window.location.href = res.data.url;
      }
    }).catch(() => {
      window.location.href = '/integrations';
    });
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen((o) => !o)}
        title="Empuja vencimientos y audiencias al Google Calendar del abogado"
      >
        📅 Sync Calendar
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          zIndex: 100,
          width: 340,
          background: 'var(--bg-2)',
          border: '1px solid var(--border-gold)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--sp-3)',
          boxShadow: 'var(--shadow)',
          color: 'var(--text-primary)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
            <strong style={{ color: 'var(--gold)', fontSize: 13 }}>📅 Google Calendar Sync</strong>
            <button onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16 }}>×</button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 var(--sp-2) 0', lineHeight: 1.4 }}>
            Empuja al Google Calendar del abogado:
          </p>
          <ul style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 var(--sp-2) 0', paddingLeft: 18 }}>
            <li><strong style={{ color: 'var(--text-primary)' }}>Vencimientos</strong> abiertos del caso → eventos de día completo con icono ⏰</li>
            <li><strong style={{ color: 'var(--text-primary)' }}>Audiencias agendadas</strong> → eventos con hora (09:00 default, 1h)</li>
          </ul>

          {!result && !error && (
            <button
              className="btn btn-primary btn-sm"
              onClick={sync}
              disabled={syncing}
              style={{ width: '100%', marginBottom: 'var(--sp-2)' }}
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
          )}

          {result && (
            <div style={{
              background: 'rgba(125,184,126,0.12)',
              border: '1px solid rgba(125,184,126,0.4)',
              borderRadius: 'var(--radius)',
              padding: 'var(--sp-2)',
              marginBottom: 'var(--sp-2)',
            }}>
              <div style={{ color: '#7DB87E', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                ✓ Sincronizado
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                {result.vencimientos} vencimiento{result.vencimientos === 1 ? '' : 's'} · {result.actuaciones} audiencia{result.actuaciones === 1 ? '' : 's'}
                {result.errors?.length > 0 && (
                  <span style={{ color: '#E87A7A' }}> · {result.errors.length} con error</span>
                )}
              </div>
              <a
                href="https://calendar.google.com/calendar/u/0/r/week"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: 6, color: 'var(--gold)', fontSize: 12 }}
              >
                Abrir Google Calendar →
              </a>
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(232,122,122,0.12)',
              border: '1px solid rgba(232,122,122,0.4)',
              borderRadius: 'var(--radius)',
              padding: 'var(--sp-2)',
              marginBottom: 'var(--sp-2)',
            }}>
              <div style={{ color: '#E87A7A', fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
                No se pudo sincronizar
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{error.msg}</div>
              {error.fix && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{error.fix}</div>
              )}
              {error.showReconnect && (
                <button className="btn btn-primary btn-sm" onClick={reconnect} style={{ marginTop: 8, width: '100%' }}>
                  Reconectar Google con Calendar
                </button>
              )}
            </div>
          )}

          {prefs && !prefs.calendar_auto_sync && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 'var(--sp-2)', lineHeight: 1.4 }}>
              💡 <strong>Tip</strong>: hoy sincronizas manualmente. Pronto podrás activar
              auto-sync en Ajustes para que cada vencimiento se empuje solo al
              crearlo.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
