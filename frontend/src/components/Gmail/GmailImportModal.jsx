import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

export default function GmailImportModal({ caseId, open, onClose, onImported, clientEmail, clientId, clientName }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState('client');
  const [query, setQuery] = useState('');
  const [threadId, setThreadId] = useState('');
  const [maxResults, setMaxResults] = useState(20);
  const [dateMode, setDateMode] = useState('30d');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [status, setStatus] = useState({ loading: true, connected: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;

    const defaultMode = clientEmail ? 'client' : 'query';
    setMode(defaultMode);
    setQuery('');
    setThreadId('');
    setMaxResults(20);
    setDateMode('30d');
    setDateFrom('');
    setDateTo('');
    setError('');
    setResult(null);
    setStatus({ loading: true, connected: false });

    api.get('/google/status')
      .then(({ data }) => setStatus({ loading: false, ...data }))
      .catch(() => setStatus({ loading: false, connected: false }));
  }, [open, clientEmail]);

  if (!open) return null;

  const toGmailDate = (value) => value ? value.replaceAll('-', '/') : '';

  const buildClientQuery = () => {
    const parts = [`{from:${clientEmail} to:${clientEmail}}`];
    if (dateMode === '30d') parts.push('newer_than:30d');
    if (dateMode === '90d') parts.push('newer_than:90d');
    if (dateMode === 'custom') {
      if (dateFrom) parts.push(`after:${toGmailDate(dateFrom)}`);
      if (dateTo) parts.push(`before:${toGmailDate(dateTo)}`);
    }
    return parts.join(' ');
  };

  const buildSyncBody = () => {
    if (mode === 'thread') return { threadId: threadId.trim() };
    if (mode === 'client') return { query: buildClientQuery(), maxResults };
    return { query: query.trim(), maxResults };
  };

  const handleEditClientEmail = () => {
    onClose?.();
    navigate(clientId ? `/clients?edit=${clientId}` : '/clients');
  };

  const handleSubmit = async () => {
    setError('');
    setResult(null);

    if (mode === 'client' && !clientEmail) {
      setError('Este cliente no tiene email registrado. Usa busqueda manual o registra el correo del cliente.');
      return;
    }
    if (mode === 'client' && dateMode === 'custom' && !dateFrom && !dateTo) {
      setError('Elige una fecha inicial o final, o cambia el rango a 30 dias, 90 dias o todos.');
      return;
    }
    if (mode === 'query' && !query.trim()) {
      setError('Escribe una busqueda o usa una opcion rapida.');
      return;
    }
    if (mode === 'thread' && !threadId.trim()) {
      setError('Ingresa un ID de hilo de Gmail.');
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post(
        `/cases/${caseId}/google/gmail/sync`,
        buildSyncBody(),
        { timeout: 180000 }
      );
      setResult(data);
      onImported?.(data);
    } catch (err) {
      const code = err.response?.data?.code;
      if (err.code === 'ECONNABORTED') {
        setError('La importacion esta tardando mas de lo esperado. Reduce el maximo de correos o intenta con un rango de fechas mas corto.');
      } else if (code === 'GOOGLE_NOT_CONNECTED') {
        setError('Aun no has conectado tu cuenta de Google. Ve a Ajustes / Integraciones.');
      } else if (code === 'GOOGLE_NOT_CONFIGURED') {
        setError('La integracion de Google no esta configurada. Completa Ajustes / Integraciones.');
      } else if (code === 'GOOGLE_RECONNECT_REQUIRED') {
        setError('Google rechazo la autorizacion actual. Reconecta la cuenta en Ajustes / Integraciones y vuelve a intentar.');
      } else if (code === 'GMAIL_QUERY_INVALID') {
        setError('Gmail no acepto la busqueda. Prueba con 30 dias, 90 dias o ajusta el rango de fechas.');
      } else if (code === 'GMAIL_SCOPE_REQUIRED') {
        setError('La cuenta conectada no autorizo lectura de Gmail. Reconecta Google desde Ajustes / Integraciones.');
      } else {
        setError(err.response?.data?.error || 'No fue posible actualizar desde Gmail.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content gmail-sync-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">Actualizar comunicaciones desde Gmail</h3>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="modal-body gmail-sync-body">
          {status.loading ? (
            <div className="gmail-sync-muted">Verificando conexion...</div>
          ) : !status.connected ? (
            <div className="gmail-sync-alert gmail-sync-alert-error">
              No hay una cuenta de Gmail conectada. Ve a Ajustes / Integraciones para conectar una.
            </div>
          ) : (
            <div className="gmail-sync-connected">
              <span>Cuenta conectada</span>
              <strong>{status.email}</strong>
            </div>
          )}

          <div className="gmail-sync-options">
            {clientEmail ? (
              <button
                type="button"
                className={`gmail-sync-option${mode === 'client' ? ' active' : ''}`}
                onClick={() => { setMode('client'); if (dateMode === 'all') setDateMode('30d'); }}
                disabled={!status.connected}
              >
                <strong>Correos recientes del cliente</strong>
                <span>{clientEmail} · rango configurable</span>
              </button>
            ) : (
              <div className="gmail-sync-option gmail-sync-option-missing">
                <strong>Correos recientes del cliente</strong>
                <span>El cliente no tiene email registrado.</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm gmail-sync-inline-action"
                  onClick={handleEditClientEmail}
                >
                  Agregar correo del cliente
                </button>
              </div>
            )}
            <button
              type="button"
              className={`gmail-sync-option${mode === 'client' && dateMode === 'all' ? ' active' : ''}`}
              onClick={() => { setMode('client'); setDateMode('all'); setMaxResults(prev => Math.max(prev, 100)); }}
              disabled={!status.connected || !clientEmail}
            >
              <strong>Todos los correos del cliente</strong>
              <span>Sin limite de fecha; se revisan hasta {maxResults} coincidencias.</span>
            </button>
          </div>

          {mode === 'client' && clientEmail && (
            <div className="gmail-sync-date-panel">
              <div className="gmail-sync-date-modes">
                {[
                  ['30d', '30 dias'],
                  ['90d', '90 dias'],
                  ['custom', 'Rango'],
                  ['all', 'Todos'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={`btn btn-sm ${dateMode === value ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setDateMode(value)}
                    disabled={submitting}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {dateMode === 'custom' && (
                <div className="gmail-sync-date-range">
                  <label>
                    Desde
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={e => setDateFrom(e.target.value)}
                      disabled={submitting}
                    />
                  </label>
                  <label>
                    Hasta
                    <input
                      type="date"
                      value={dateTo}
                      onChange={e => setDateTo(e.target.value)}
                      disabled={submitting}
                    />
                  </label>
                </div>
              )}
              <small>
                Busqueda protegida: siempre filtra por remitente o destinatario del cliente.
              </small>
            </div>
          )}

          <div className="gmail-sync-advanced-actions">
            <button
              type="button"
              className={`btn btn-sm ${mode === 'query' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode('query')}
              disabled={!status.connected}
            >
              Busqueda manual
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'thread' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setMode('thread')}
              disabled={!status.connected}
            >
              Hilo especifico
            </button>
          </div>

          {mode !== 'thread' && (
            <div className="gmail-sync-field-row">
              <label>
                Maximo de correos a revisar
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={maxResults}
                  onChange={e => setMaxResults(Number(e.target.value) || 20)}
                  disabled={!status.connected || submitting}
                />
              </label>
            </div>
          )}

          {mode === 'query' && (
            <label className="gmail-sync-field">
              Busqueda en Gmail
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="{from:cliente@ejemplo.com to:cliente@ejemplo.com} newer_than:30d"
                disabled={!status.connected || submitting}
              />
              <small>Avanzado: usa from:, to:, subject:, newer_than:. Evita busquedas amplias sin cliente.</small>
            </label>
          )}

          {mode === 'thread' && (
            <label className="gmail-sync-field">
              ID de hilo de Gmail
              <input
                type="text"
                value={threadId}
                onChange={e => setThreadId(e.target.value)}
                placeholder="18c1f2a0b3..."
                disabled={!status.connected || submitting}
              />
              <small>Abre el hilo en Gmail y copia el ID desde la URL.</small>
            </label>
          )}

          {error && <div className="gmail-sync-alert gmail-sync-alert-error">{error}</div>}

          {result && (
            <div className="gmail-sync-result">
              <div className="gmail-sync-result-title">Actualizacion completa</div>
              <div className="gmail-sync-result-stats">
                <span><strong>{result.imported}</strong> nuevos</span>
                <span><strong>{result.skipped}</strong> ya estaban</span>
                <span><strong>{result.total}</strong> revisados</span>
              </div>
              {result.messages?.length > 0 && (
                <div className="gmail-sync-result-list">
                  {result.messages.map(m => (
                    <div key={m.gmail_message_id} className={m.created ? '' : 'muted'}>
                      <span>{m.created ? 'Nuevo' : 'Existente'}</span>
                      <strong>{m.subject || '(sin asunto)'}</strong>
                      <small>{m.from}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>
            {result ? 'Cerrar' : 'Cancelar'}
          </button>
          {!result && (
            <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting || !status.connected}>
              {submitting ? 'Actualizando...' : 'Actualizar desde Gmail'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
