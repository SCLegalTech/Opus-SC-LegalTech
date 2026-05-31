import { useEffect, useRef, useState } from 'react';
import {
  getConversation,
  listMessages,
  sendText,
  sendTemplate,
  listTemplates,
  markRead,
  linkCase,
  formatPhone,
  formatRelativeTime,
  messageTypeIcon,
} from '../../services/whatsappApi';
import api from '../../services/api';

export default function ConversationView({ conversationId, onChange, onBack }) {
  const [conv, setConv] = useState(null);
  const [within24h, setWithin24h] = useState(false);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);
  const [showLinkCase, setShowLinkCase] = useState(false);
  const scrollRef = useRef(null);

  const load = async () => {
    try {
      setError(null);
      const [{ conversation, within_24h_window }, { messages: msgs }] = await Promise.all([
        getConversation(conversationId),
        listMessages(conversationId, { limit: 100 }),
      ]);
      setConv(conversation);
      setWithin24h(Boolean(within_24h_window));
      setMessages(msgs || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error cargando hilo');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    setLoading(true);
    load();
    // marcar como leído al abrir
    markRead(conversationId).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Polling de mensajes cada 8s mientras el hilo está abierto
  useEffect(() => {
    if (!conversationId) return;
    const interval = setInterval(() => {
      listMessages(conversationId, { limit: 100 })
        .then(({ messages: msgs }) => setMessages(msgs || []))
        .catch(() => {});
    }, 8000);
    return () => clearInterval(interval);
  }, [conversationId]);

  // Auto-scroll al fondo cuando llegan mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  if (!conversationId) {
    return (
      <div className="wa-conversation-view wa-conversation-view--empty" style={{ ...placeholderStyle }}>
        Selecciona una conversación para ver el hilo.
      </div>
    );
  }

  if (loading) return <div style={placeholderStyle}>Cargando hilo…</div>;
  if (error)   return <div style={{ ...placeholderStyle, color: '#E87A7A' }}>{error}</div>;
  if (!conv)   return <div style={placeholderStyle}>Hilo no encontrado.</div>;

  const handleSendText = async (body) => {
    setSending(true);
    try {
      await sendText(conversationId, body);
      await load();
      onChange?.();
    } catch (err) {
      const data = err.response?.data;
      if (data?.error === 'fuera_de_ventana_24h') {
        alert('Fuera de la ventana de 24h. Usa una plantilla aprobada.');
        setShowTemplate(true);
      } else {
        alert(`Error enviando: ${data?.message || err.message}`);
      }
    } finally {
      setSending(false);
    }
  };

  const handleSendTemplate = async (payload) => {
    setSending(true);
    try {
      await sendTemplate(conversationId, payload);
      setShowTemplate(false);
      await load();
      onChange?.();
    } catch (err) {
      alert(`Error enviando plantilla: ${err.response?.data?.message || err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="wa-conversation-view">
      <button className="wa-mobile-back" type="button" onClick={onBack}>
        Volver a conversaciones
      </button>
      <ConvHeader
        conv={conv}
        within24h={within24h}
        onLinkCase={() => setShowLinkCase(true)}
      />
      <div ref={scrollRef} style={{
        flex: 1,
        overflowY: 'auto',
        padding: 'var(--sp-3)',
        background: 'var(--bg-0)',
      }}>
        {messages.length === 0 && (
          <div style={placeholderStyle}>Hilo vacío. Inicia con una plantilla aprobada.</div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} />
        ))}
      </div>
      <Composer
        within24h={within24h}
        sending={sending}
        onSendText={handleSendText}
        onPickTemplate={() => setShowTemplate(true)}
      />
      {showTemplate && (
        <TemplateModal
          onClose={() => setShowTemplate(false)}
          onSubmit={handleSendTemplate}
        />
      )}
      {showLinkCase && (
        <LinkCaseModal
          conversationId={conversationId}
          onClose={() => setShowLinkCase(false)}
          onLinked={async () => {
            setShowLinkCase(false);
            await load();
            onChange?.();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ConvHeader
// ─────────────────────────────────────────────────────────────

function ConvHeader({ conv, within24h, onLinkCase }) {
  return (
    <div style={{
      padding: 'var(--sp-3)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-1)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 'var(--sp-3)',
    }}>
      <div>
        <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
          {conv.contact_name || formatPhone(conv.contact_phone)}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {formatPhone(conv.contact_phone)}
          {conv.case_number && <> · {conv.case_number}</>}
          {conv.client_name && <> · {conv.client_name}</>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <span style={{
          fontSize: '0.65rem',
          padding: '2px 8px',
          borderRadius: 999,
          background: within24h ? 'rgba(45, 78, 48, 0.4)' : 'rgba(232, 122, 122, 0.18)',
          color: within24h ? '#7DB87E' : '#E87A7A',
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}>
          {within24h ? 'VENTANA 24H ABIERTA' : 'FUERA DE VENTANA 24H'}
        </span>
        {!conv.case_id && (
          <button onClick={onLinkCase} style={ghostBtnStyle}>
            Vincular caso
          </button>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// MessageBubble
// ─────────────────────────────────────────────────────────────

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound';
  const align = isOut ? 'flex-end' : 'flex-start';
  const bgColor = isOut ? 'var(--accent-gold, #947F57)' : 'var(--bg-2)';
  const textColor = isOut ? '#000' : 'var(--text)';

  return (
    <div style={{
      display: 'flex',
      justifyContent: align,
      marginBottom: 'var(--sp-2)',
    }}>
      <div style={{
        maxWidth: '70%',
        padding: '8px 12px',
        borderRadius: 12,
        background: bgColor,
        color: textColor,
      }}>
        {msg.message_type !== 'text' && (
          <div style={{ fontSize: '0.65rem', fontWeight: 700, marginBottom: 4, opacity: 0.75 }}>
            [{messageTypeIcon(msg.message_type)}]
            {msg.media_filename && ` ${msg.media_filename}`}
          </div>
        )}
        {msg.body && <div style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.body}</div>}
        {msg.media_caption && (
          <div style={{ fontSize: '0.78rem', marginTop: 4, opacity: 0.85 }}>{msg.media_caption}</div>
        )}
        {msg.template_name && (
          <div style={{ fontSize: '0.62rem', marginTop: 4, opacity: 0.6 }}>plantilla: {msg.template_name}</div>
        )}
        <div style={{
          fontSize: '0.62rem',
          marginTop: 6,
          display: 'flex',
          gap: 6,
          justifyContent: 'flex-end',
          opacity: 0.7,
        }}>
          <span>{formatRelativeTime(msg.created_at)}</span>
          {isOut && (
            <span style={{ fontWeight: 700 }}>
              {msg.status === 'read'      && '✓✓ leído'}
              {msg.status === 'delivered' && '✓✓'}
              {msg.status === 'sent'      && '✓'}
              {msg.status === 'failed'    && '✗ falló'}
              {msg.status === 'queued'    && '…'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Composer
// ─────────────────────────────────────────────────────────────

function Composer({ within24h, sending, onSendText, onPickTemplate }) {
  const [body, setBody] = useState('');

  const handleSubmit = (e) => {
    e?.preventDefault?.();
    const text = body.trim();
    if (!text) return;
    onSendText(text);
    setBody('');
  };

  return (
    <form onSubmit={handleSubmit} style={{
      borderTop: '1px solid var(--border)',
      padding: 'var(--sp-3)',
      background: 'var(--bg-1)',
      display: 'flex',
      gap: 'var(--sp-2)',
      alignItems: 'flex-end',
    }}>
      <button type="button" onClick={onPickTemplate} style={ghostBtnStyle} title="Enviar plantilla HSM">
        Plantilla
      </button>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
        placeholder={within24h
          ? 'Escribe un mensaje… (Enter para enviar, Shift+Enter nueva línea)'
          : 'Fuera de ventana 24h. Usa una plantilla aprobada.'}
        disabled={!within24h || sending}
        rows={2}
        style={{
          flex: 1,
          padding: '8px 10px',
          background: 'var(--bg-2)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: '0.85rem',
          resize: 'none',
          opacity: within24h ? 1 : 0.5,
        }}
      />
      <button
        type="submit"
        disabled={!within24h || sending || !body.trim()}
        style={{
          ...primaryBtnStyle,
          opacity: !within24h || sending || !body.trim() ? 0.4 : 1,
          cursor: !within24h || sending || !body.trim() ? 'not-allowed' : 'pointer',
        }}
      >
        {sending ? 'Enviando…' : 'Enviar'}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// TemplateModal
// ─────────────────────────────────────────────────────────────

function TemplateModal({ onClose, onSubmit }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [vars, setVars] = useState([]);

  useEffect(() => {
    listTemplates()
      .then((d) => setTemplates(d.templates || []))
      .catch(() => setTemplates([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) {
      setVars([]);
      return;
    }
    const tmplVars = Array.isArray(selected.variables) ? selected.variables : [];
    setVars(tmplVars.map((v) => ({ name: v.name, value: '' })));
  }, [selected]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!selected) return;
    onSubmit({
      template_name: selected.name,
      language: selected.language || 'es',
      body_variables: vars.map((v) => v.value),
    });
  };

  return (
    <div style={modalBackdropStyle}>
      <div style={modalStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Enviar plantilla HSM</h3>
          <button onClick={onClose} style={ghostBtnStyle}>Cerrar</button>
        </div>
        {loading && <div style={placeholderStyle}>Cargando catálogo…</div>}
        {!loading && (
          <form onSubmit={handleSubmit}>
            <label style={labelStyle}>Plantilla</label>
            <select
              value={selected?.id || ''}
              onChange={(e) => {
                const t = templates.find((x) => String(x.id) === e.target.value);
                setSelected(t || null);
              }}
              style={inputStyle}
            >
              <option value="">— elegir —</option>
              {templates.map((t) => (
                <option
                  key={t.id}
                  value={t.id}
                  disabled={t.status !== 'approved'}
                >
                  {t.name} ({t.language}) {t.status !== 'approved' ? `· ${t.status}` : ''}
                </option>
              ))}
            </select>

            {selected && (
              <>
                <div style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-2)',
                  padding: 'var(--sp-2)',
                  borderRadius: 'var(--radius)',
                  margin: 'var(--sp-2) 0',
                  whiteSpace: 'pre-wrap',
                }}>
                  {selected.body}
                </div>
                {vars.map((v, idx) => (
                  <div key={idx} style={{ marginBottom: 'var(--sp-2)' }}>
                    <label style={labelStyle}>{`{{${idx + 1}}} ${v.name}`}</label>
                    <input
                      type="text"
                      value={v.value}
                      onChange={(e) => setVars((curr) => {
                        const next = [...curr];
                        next[idx] = { ...next[idx], value: e.target.value };
                        return next;
                      })}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </>
            )}

            <div style={{ display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end', marginTop: 'var(--sp-3)' }}>
              <button type="button" onClick={onClose} style={ghostBtnStyle}>Cancelar</button>
              <button
                type="submit"
                disabled={!selected || selected.status !== 'approved'}
                style={primaryBtnStyle}
              >
                Enviar plantilla
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LinkCaseModal
// ─────────────────────────────────────────────────────────────

function LinkCaseModal({ conversationId, onClose, onLinked }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      api.get('/cases', { params: { search: query, limit: 10 } })
        .then((res) => setResults(Array.isArray(res.data) ? res.data : (res.data?.cases || [])))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  const handleLink = async (caseId) => {
    try {
      await linkCase(conversationId, caseId);
      onLinked();
    } catch (err) {
      alert(`Error vinculando caso: ${err.response?.data?.message || err.message}`);
    }
  };

  return (
    <div style={modalBackdropStyle}>
      <div style={{ ...modalStyle, maxWidth: 500 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Vincular a un caso</h3>
          <button onClick={onClose} style={ghostBtnStyle}>Cerrar</button>
        </div>
        <input
          type="search"
          autoFocus
          placeholder="Buscar por número, título o cliente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={inputStyle}
        />
        <div style={{ marginTop: 'var(--sp-2)', maxHeight: 300, overflowY: 'auto' }}>
          {searching && <div style={placeholderStyle}>Buscando…</div>}
          {!searching && query && results.length === 0 && (
            <div style={placeholderStyle}>Sin resultados.</div>
          )}
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => handleLink(c.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: 'var(--sp-2)',
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                color: 'var(--text)',
                marginBottom: 'var(--sp-1)',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.case_number} · {c.title}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {c.client_name || '—'} · {c.status}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Estilos compartidos
// ─────────────────────────────────────────────────────────────

const placeholderStyle = {
  padding: 'var(--sp-4)',
  fontSize: '0.85rem',
  color: 'var(--text-muted)',
  textAlign: 'center',
};

const ghostBtnStyle = {
  padding: '4px 10px',
  fontSize: '0.72rem',
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  cursor: 'pointer',
};

const primaryBtnStyle = {
  padding: '6px 14px',
  fontSize: '0.78rem',
  background: 'var(--accent-gold, #947F57)',
  border: 'none',
  borderRadius: 'var(--radius)',
  color: '#000',
  fontWeight: 600,
  cursor: 'pointer',
};

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalStyle = {
  background: 'var(--bg-1)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg, 8px)',
  padding: 'var(--sp-4)',
  width: '90%',
  maxWidth: 480,
  maxHeight: '85vh',
  overflowY: 'auto',
};

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-2)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  fontSize: '0.85rem',
};

const labelStyle = {
  display: 'block',
  fontSize: '0.7rem',
  color: 'var(--text-muted)',
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
