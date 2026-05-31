import { useEffect, useState } from 'react';
import { listConversations, formatPhone, formatRelativeTime, messageTypeIcon } from '../../services/whatsappApi';

const FILTER_TABS = [
  { value: 'open',   label: 'Abiertas' },
  { value: 'closed', label: 'Cerradas' },
  { value: 'all',    label: 'Todas' },
];

const ASSIGNMENT_TABS = [
  { value: '',           label: 'Todos' },
  { value: 'me',         label: 'Mías' },
  { value: 'unassigned', label: 'Sin asignar' },
];

export default function ConversationList({ selectedId, onSelect, refreshTrigger = 0 }) {
  const [filters, setFilters] = useState({ status: 'open', assigned_to: '', search: '' });
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    listConversations({ ...filters, limit: 100 })
      .then((data) => {
        if (!alive) return;
        setItems(data.conversations || []);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.response?.data?.error || err.message || 'Error cargando bandeja');
      })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [filters.status, filters.assigned_to, filters.search, refreshTrigger]);

  // Polling pasivo cada 20s para refrescar la lista
  useEffect(() => {
    const interval = setInterval(() => {
      listConversations({ ...filters, limit: 100 })
        .then((data) => setItems(data.conversations || []))
        .catch(() => {});
    }, 20000);
    return () => clearInterval(interval);
  }, [filters.status, filters.assigned_to, filters.search]);

  return (
    <div className={`wa-conversation-list${selectedId ? ' wa-conversation-list--has-selection' : ''}`}>
      <div style={{ padding: 'var(--sp-3)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--sp-2)' }}>
          <h2 style={{ margin: 0, fontSize: '0.95rem', letterSpacing: '0.02em' }}>Bandeja WhatsApp</h2>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{items.length}</span>
        </div>
        <input
          type="search"
          placeholder="Buscar por nombre o teléfono"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          style={{
            width: '100%',
            padding: '6px 10px',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            background: 'var(--bg-2)',
            color: 'var(--text)',
            fontSize: '0.8rem',
            marginBottom: 'var(--sp-2)',
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          {FILTER_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setFilters((f) => ({ ...f, status: t.value }))}
              style={tabStyle(filters.status === t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {ASSIGNMENT_TABS.map((t) => (
            <button
              key={t.value || 'todos'}
              onClick={() => setFilters((f) => ({ ...f, assigned_to: t.value }))}
              style={tabStyle(filters.assigned_to === t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div style={emptyStyle}>Cargando…</div>}
        {error && <div style={{ ...emptyStyle, color: '#E87A7A' }}>{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div style={emptyStyle}>No hay conversaciones.</div>
        )}
        {items.map((c) => (
          <ConversationRow
            key={c.id}
            conv={c}
            active={c.id === selectedId}
            onClick={() => onSelect(c.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ConversationRow({ conv, active, onClick }) {
  const last = conv.last_message;
  const unread = Number(conv.unread_count || 0) > 0;
  const preview = last
    ? (last.body
        || (last.message_type ? `[${messageTypeIcon(last.message_type)}]` : '')
      )
    : '—';

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        background: active ? 'var(--bg-2)' : 'transparent',
        borderLeft: active ? '3px solid var(--accent-gold, #947F57)' : '3px solid transparent',
        borderTop: 'none',
        borderRight: 'none',
        borderBottom: '1px solid var(--border-soft, rgba(255,255,255,0.04))',
        color: 'var(--text)',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{
          fontWeight: unread ? 700 : 500,
          fontSize: '0.85rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {conv.contact_name || formatPhone(conv.contact_phone)}
        </div>
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', flexShrink: 0 }}>
          {formatRelativeTime(conv.last_message_at)}
        </div>
      </div>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 4,
        gap: 8,
      }}>
        <div style={{
          fontSize: '0.72rem',
          color: unread ? 'var(--text)' : 'var(--text-muted)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
        }}>
          {last?.direction === 'outbound' ? 'Tú: ' : ''}{truncate(preview, 60)}
        </div>
        {unread && (
          <span style={{
            background: 'var(--accent-gold, #947F57)',
            color: '#000',
            fontSize: '0.62rem',
            fontWeight: 700,
            borderRadius: 999,
            padding: '1px 7px',
            minWidth: 18,
            textAlign: 'center',
          }}>
            {conv.unread_count}
          </span>
        )}
      </div>
      <div style={{ marginTop: 4, display: 'flex', gap: 6, fontSize: '0.62rem', color: 'var(--text-muted)' }}>
        {conv.case_number && <span>· {conv.case_number}</span>}
        {conv.client_name && <span>· {conv.client_name}</span>}
        {conv.consent_status === 'pending' && <span style={{ color: '#D4B84A' }}>· consentimiento pendiente</span>}
        {conv.consent_status === 'revoked' && <span style={{ color: '#E87A7A' }}>· consentimiento revocado</span>}
      </div>
    </button>
  );
}

function tabStyle(active) {
  return {
    flex: 1,
    padding: '4px 6px',
    fontSize: '0.7rem',
    background: active ? 'var(--bg-2)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--text-muted)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
  };
}

const emptyStyle = {
  padding: 'var(--sp-4)',
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  textAlign: 'center',
};

function truncate(s, n) {
  const clean = String(s || '').replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n)}…`;
}
