import { useState, useEffect } from 'react';
import api from '../../services/api';

/**
 * ClientPortalInvite — gestor de enlaces públicos de cliente.
 *
 * El abogado genera enlaces para que el cliente acceda al caso sin
 * crear cuenta. Cada enlace puede ser permanente (10 años) o con
 * vigencia limitada. El plano del token solo se muestra al crear —
 * para reusar, regenerar.
 */

const TTL_OPTIONS = [
  { value: 3650, label: 'Permanente' },
  { value: 180,  label: '6 meses' },
  { value: 90,   label: '90 días' },
  { value: 30,   label: '30 días' },
  { value: 7,    label: '7 días' },
];

export default function ClientPortalInvite({ caseId, clientName }) {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [ttl, setTtl] = useState(3650);

  const load = async () => {
    try {
      const res = await api.get(`/cases/${caseId}/portal-tokens`);
      setTokens(res.data?.tokens || []);
    } catch {}
  };

  useEffect(() => { if (open) load(); }, [open, caseId]);

  const generate = async (override = {}) => {
    setGenerating(true);
    setLastUrl(null);
    setCopied(false);
    try {
      const res = await api.post(`/cases/${caseId}/portal-tokens`, {
        label: override.label || (clientName ? `Acceso de ${clientName}` : 'Acceso del cliente'),
        ttl_days: override.ttl_days ?? ttl,
      });
      setLastUrl(res.data?.url);
      await load();
    } catch (err) {
      alert(err.response?.data?.error || 'No se pudo generar el enlace');
    } finally {
      setGenerating(false);
    }
  };

  const regenerate = (token) => {
    if (!confirm('¿Regenerar este enlace? El enlace anterior dejará de funcionar.')) return;
    revoke(token.id, true).then(() => generate({ label: token.label, ttl_days: tokenDaysRemaining(token) || 3650 }));
  };

  const revoke = async (tokenId, silent = false) => {
    if (!silent && !confirm('¿Revocar este enlace? El cliente dejará de tener acceso.')) return;
    try {
      await api.delete(`/cases/${caseId}/portal-tokens/${tokenId}`);
      if (!silent) await load();
    } catch (err) {
      if (!silent) alert(err.response?.data?.error || 'No se pudo revocar');
    }
  };

  const copyUrl = async () => {
    if (!lastUrl) return;
    try {
      await navigator.clipboard.writeText(lastUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert('Selecciona y copia el enlace manualmente.');
    }
  };

  const openInNewWindow = () => {
    if (!lastUrl) return;
    window.open(lastUrl, '_blank', 'noopener');
  };

  return (
    <>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
        Portal público
      </button>

      {open && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 580 }}>
            <div className="modal-header">
              <div className="modal-title">Portal público — enlaces para compartir</div>
              <button className="modal-close" onClick={() => setOpen(false)}>×</button>
            </div>
            <div style={{ padding: 'var(--sp-3)' }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>
                Genera un enlace público para que el cliente vea el estado del caso y descargue documentos compartidos, sin crear cuenta. Por defecto, permanente.
              </p>

              <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end', marginBottom: 'var(--sp-2)' }}>
                <label style={{ fontSize: 12, flex: 1, color: 'var(--text-secondary)' }}>
                  Vigencia
                  <select value={ttl} onChange={(e) => setTtl(Number(e.target.value))} style={{ width: '100%', marginTop: 2 }}>
                    {TTL_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
                <button className="btn btn-primary btn-sm" onClick={() => generate()} disabled={generating}>
                  {generating ? 'Generando…' : 'Generar enlace'}
                </button>
              </div>

              {lastUrl && (
                <div style={{
                  background: 'rgba(125,184,126,0.12)',
                  border: '1px solid rgba(125,184,126,0.4)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--sp-2)',
                  marginBottom: 'var(--sp-2)',
                }}>
                  <div style={{ fontSize: 11, color: '#7DB87E', marginBottom: 4, fontWeight: 700 }}>
                    ✓ Enlace listo — cópialo y compártelo con tu cliente
                  </div>
                  <code style={{
                    display: 'block', wordBreak: 'break-all', fontSize: 12, padding: 6,
                    background: 'var(--bg-1)', color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                    borderRadius: 4, marginBottom: 6,
                  }}>
                    {lastUrl}
                  </code>
                  <div style={{ display: 'flex', gap: 'var(--sp-1)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={copyUrl}>
                      {copied ? '✓ Copiado' : 'Copiar'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={openInNewWindow}>
                      Abrir
                    </button>
                  </div>
                  <small style={{ display: 'block', marginTop: 6, color: 'var(--text-muted)', fontSize: 10 }}>
                    Si pierdes el enlace, regenera uno nuevo desde la lista. El anterior dejará de funcionar.
                  </small>
                </div>
              )}

              <h4 style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, margin: 'var(--sp-3) 0 var(--sp-1) 0' }}>
                Enlaces existentes ({tokens.length})
              </h4>
              {tokens.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Aún no has generado enlaces para este caso.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {tokens.map((t) => {
                    const expired = new Date(t.expires_at) < new Date();
                    const revoked = !!t.revoked_at;
                    const inactive = expired || revoked;
                    return (
                      <div key={t.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 10px',
                        background: 'var(--bg-3)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        fontSize: 12,
                        opacity: inactive ? 0.5 : 1,
                        color: 'var(--text-primary)',
                      }}>
                        <div>
                          <strong>{t.label || 'sin etiqueta'}</strong>
                          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                            {expired ? 'Expirado' : revoked ? 'Revocado' : `Expira ${new Date(t.expires_at).toLocaleDateString('es-CO')}`}
                            {' · '}usos: {t.use_count}
                          </div>
                        </div>
                        {!inactive && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => regenerate(t)}
                              style={{ background: 'transparent', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                              title="Crea un enlace nuevo con la misma etiqueta. El actual deja de funcionar."
                            >
                              Regenerar
                            </button>
                            <button
                              onClick={() => revoke(t.id)}
                              style={{ background: 'transparent', border: 'none', color: '#E87A7A', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
                            >
                              Revocar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function tokenDaysRemaining(token) {
  if (!token.expires_at) return null;
  const days = Math.ceil((new Date(token.expires_at) - new Date()) / 86400000);
  return Math.max(days, 1);
}
