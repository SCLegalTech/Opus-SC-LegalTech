import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ConversationList from '../components/Whatsapp/ConversationList';
import ConversationView from '../components/Whatsapp/ConversationView';
import { listNumbers } from '../services/whatsappApi';

/**
 * Bandeja de WhatsApp.
 *
 * Layout: lista a la izquierda, hilo en el centro. Si no hay número
 * configurado en el backend (configured=false), mostramos un banner
 * con instrucciones de activación.
 */
export default function Whatsapp() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [numbers, setNumbers] = useState([]);
  const [configured, setConfigured] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedId = searchParams.get('c') ? parseInt(searchParams.get('c'), 10) : null;

  useEffect(() => {
    listNumbers()
      .then((d) => {
        setNumbers(d.numbers || []);
        setConfigured(Boolean(d.configured));
      })
      .catch(() => setConfigured(false));
  }, []);

  const handleSelect = (id) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('c', String(id));
      return next;
    });
  };
  const handleBackToList = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('c');
      return next;
    });
  };

  const handleChange = () => setRefreshTick((t) => t + 1);

  return (
    <div className="whatsapp-page">
      {!configured && <ConfigBanner numbers={numbers} />}
      <div className="whatsapp-shell">
        <ConversationList
          selectedId={selectedId}
          onSelect={handleSelect}
          refreshTrigger={refreshTick}
        />
        <ConversationView
          conversationId={selectedId}
          onChange={handleChange}
          onBack={handleBackToList}
        />
      </div>
    </div>
  );
}

function ConfigBanner({ numbers }) {
  return (
    <div style={{
      padding: 'var(--sp-3)',
      background: 'rgba(212, 184, 74, 0.12)',
      borderBottom: '1px solid rgba(212, 184, 74, 0.4)',
      color: '#D4B84A',
      fontSize: '0.78rem',
      lineHeight: 1.5,
    }}>
      <strong>WhatsApp aún no está activado.</strong> Para habilitar la bandeja:
      <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
        <li>Crea la app en Meta Developer Portal y obtén las credenciales.</li>
        <li>Configura las variables <code>WHATSAPP_*</code> en el backend (ver <code>.env.example</code>).</li>
        <li>Inserta el número WABA en la tabla <code>wa_phone_numbers</code>.</li>
        <li>Apunta el webhook de Meta a <code>/api/webhooks/whatsapp</code>.</li>
      </ol>
      {numbers.length > 0 && (
        <div style={{ marginTop: 6 }}>
          Número(s) registrado(s) en BD: {numbers.map((n) => n.display_phone).join(', ')}.
          Falta configurar el access token o el phone_number_id en el entorno.
        </div>
      )}
    </div>
  );
}
