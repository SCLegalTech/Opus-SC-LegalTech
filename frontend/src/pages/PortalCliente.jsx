import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';

/**
 * PortalCliente — vista pública para el cliente final.
 * Sin layout autenticado. Token en la URL.
 */

const STATUS_LABEL = {
  NUEVO: 'En revisión',
  EN_PROCESO: 'En curso',
  PENDIENTE: 'Pendiente de información',
  CERRADO: 'Cerrado',
};

export default function PortalCliente() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!token) return;
    const apiBase = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
    const url = apiBase ? `${apiBase}/api/portal/${token}` : `/api/portal/${token}`;
    axios.get(url, { timeout: 30000 })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || err.message || 'Error'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) return <FullPage><p style={{ color: 'var(--text-secondary, #999)' }}>Cargando…</p></FullPage>;
  if (error)   return <FullPage><h2 style={{ color: '#E87A7A' }}>{error}</h2><p style={{ color: 'var(--text-muted, #555)' }}>Pide a tu abogado un nuevo enlace de acceso.</p></FullPage>;
  if (!data?.case) return <FullPage><p style={{ color: 'var(--text-secondary, #999)' }}>No hay información disponible.</p></FullPage>;

  const { case: caseInfo, documents } = data;

  return (
    <FullPage>
      <header style={{ marginBottom: 'var(--sp-4)' }}>
        <div style={{ fontSize: 11, color: 'var(--gold, #947F57)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
          SC LegalTech · Portal del cliente
        </div>
        <h1 style={{ fontSize: 22, margin: '8px 0 4px 0', color: 'var(--text-primary, #fff)' }}>{caseInfo.case_number}</h1>
        <p style={{ color: 'var(--text-secondary, #999)', margin: 0 }}>{caseInfo.title}</p>
        {caseInfo.client_name && (
          <p style={{ color: 'var(--text-muted, #555)', fontSize: 13, marginTop: 4 }}>
            Cliente: <strong style={{ color: 'var(--text-secondary, #999)' }}>{caseInfo.client_name}</strong>
          </p>
        )}
      </header>

      <Card title="Estado del caso">
        <div style={{ display: 'flex', gap: 'var(--sp-4, 16px)', flexWrap: 'wrap' }}>
          <Field label="Estado" value={STATUS_LABEL[caseInfo.status] || caseInfo.status} />
          <Field label="Materia" value={caseInfo.service_type} />
          {caseInfo.next_action && <Field label="Próxima acción" value={caseInfo.next_action} wide />}
          {caseInfo.next_action_date && <Field label="Fecha de próxima acción" value={formatDate(caseInfo.next_action_date)} />}
          {caseInfo.response_deadline && <Field label="Plazo legal" value={formatDate(caseInfo.response_deadline)} />}
        </div>
      </Card>

      {documents && documents.length > 0 && (
        <Card title="Documentos compartidos">
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {documents.map((d) => (
              <li key={d.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border, #2A2A2A)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
                  <span style={{ color: 'var(--text-primary, #fff)' }}>{d.name}</span>
                  {d.drive_file_url && (
                    <a href={d.drive_file_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold, #947F57)' }}>
                      Abrir →
                    </a>
                  )}
                </div>
                <small style={{ color: 'var(--text-muted, #555)' }}>
                  {d.file_type || 'archivo'} · {formatDate(d.created_at)}
                </small>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <footer style={{ textAlign: 'center', color: 'var(--text-muted, #555)', fontSize: 12, padding: 'var(--sp-4) 0' }}>
        Este enlace es personal e intransferible. Tu abogado puede revocar el acceso en cualquier momento.
        <br />
        SC LegalTech · Smart Crypto Legal SAS
      </footer>
    </FullPage>
  );
}

function FullPage({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0, #000)', padding: '40px 20px', color: 'var(--text-primary, #fff)' }}>
      <div style={{
        maxWidth: 700, margin: '0 auto',
        background: 'var(--bg-2, #111)',
        border: '1px solid var(--border, #2A2A2A)',
        padding: 'var(--sp-4, 24px)',
        borderRadius: 12,
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      }}>
        {children}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <section style={{
      marginBottom: 'var(--sp-3, 16px)',
      border: '1px solid var(--border, #2A2A2A)',
      borderLeft: '3px solid var(--gold, #947F57)',
      borderRadius: 8,
      padding: 'var(--sp-3, 16px)',
      background: 'var(--bg-3, #1A1A1A)',
    }}>
      <h3 style={{ margin: '0 0 var(--sp-2) 0', fontSize: 14, color: 'var(--gold, #947F57)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, value, wide }) {
  return (
    <div style={{ minWidth: 140, flex: wide ? '1 1 100%' : undefined }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted, #555)', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontWeight: 500, color: 'var(--text-primary, #fff)' }}>{value || '—'}</div>
    </div>
  );
}

function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

