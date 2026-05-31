/**
 * ChatMessage.jsx — Burbuja de mensaje en el panel de Claudia
 */

import { useState } from 'react';

// Nombres legibles para las herramientas del agente
const TOOL_LABELS = {
  search_cases:             'Buscar casos',
  get_case_brief:           'Leer expediente',
  list_pending_tasks:       'Ver tareas pendientes',
  list_upcoming_deadlines:  'Ver vencimientos',
  list_case_communications: 'Leer comunicaciones',
  analyze_text:             'Analizar texto',
  add_case_note:            'Agregar nota interna',
  create_task:              'Crear tarea',
  update_case:              'Actualizar caso',
  update_task_status:       'Actualizar tarea',
  create_deadline:          'Crear vencimiento',
  propose_email_send:       'Proponer correo',
};

function ToolCallRow({ call }) {
  const [expanded, setExpanded] = useState(false);
  const label = TOOL_LABELS[call.name] || call.name;
  const argsStr = call.args && Object.keys(call.args).length
    ? JSON.stringify(call.args).replace(/[{}"]/g, '').slice(0, 60)
    : null;

  return (
    <div className={`tool-call-row tool-call-row--${call.phase}`}>
      <span className="tool-call-dot" />
      <div className="tool-call-body">
        <div className="tool-call-header" onClick={() => call.output_preview && setExpanded((v) => !v)}>
          <span className="tool-call-name">{label}</span>
          {argsStr && <span className="tool-call-args">{argsStr}</span>}
          {call.output_preview && (
            <span className="tool-call-toggle">{expanded ? '▲' : '▼'}</span>
          )}
        </div>
        {expanded && call.output_preview && (
          <div className="tool-call-preview">{call.output_preview}</div>
        )}
      </div>
    </div>
  );
}

export default function ChatMessage({ message }) {
  const isUser      = message.role === 'user';
  const isStreaming = message.streaming;
  const isError     = message.error;
  const statusSteps = Array.isArray(message.statusSteps) ? message.statusSteps : [];
  const toolCalls   = Array.isArray(message.toolCalls)   ? message.toolCalls   : [];

  // Renderiza **negrita** como elementos React, sin innerHTML. Antes
  // usábamos dangerouslySetInnerHTML con un boldify por regex: si el modelo
  // devolvía contenido con HTML (prompt injection desde un email/mensaje
  // del cliente metido al contexto), el navegador lo ejecutaba — vector XSS.
  // Ahora el texto fuera de **...** es texto plano y React lo escapa solo.
  const boldify = (text) => {
    if (!text) return null;
    const parts = [];
    const regex = /\*\*(.+?)\*\*/g;
    let last = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(<strong key={`b-${key++}`}>{match[1]}</strong>);
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  const renderContent = (text) => {
    if (!text) return null;

    const lines = text.split('\n');
    return lines.map((line, i) => {
      if (!line.trim()) return <br key={i} />;

      if (line.match(/^[-•*]\s/)) {
        const content = line.replace(/^[-•*]\s/, '');
        return (
          <div key={i} className="msg-bullet">
            <span className="msg-bullet-dot">·</span>
            <span>{boldify(content)}</span>
          </div>
        );
      }

      return (
        <p key={i}>{boldify(line)}</p>
      );
    });
  };

  return (
    <div className={`chat-msg ${isUser ? 'chat-msg--user' : 'chat-msg--assistant'} ${isError ? 'chat-msg--error' : ''}`}>
      {!isUser && (
        <div className="chat-msg-avatar">Φ</div>
      )}
      <div className="chat-msg-bubble">
        <div className="chat-msg-content">

          {/* Status steps — ruta de razonamiento */}
          {!isUser && statusSteps.length > 0 && (
            <div className="chat-msg-status">
              <div className="chat-msg-status-label">
                {isStreaming ? 'Phi está trabajando' : 'Ruta operativa seguida'}
              </div>
              {statusSteps.map((step) => (
                <div
                  key={step.id || `${step.label}-${step.ts || 'step'}`}
                  className={`chat-msg-status-step chat-msg-status-step--${step.state || 'running'}`}
                >
                  <span className="chat-msg-status-dot" />
                  <span>{step.label}</span>
                </div>
              ))}
            </div>
          )}

          {/* Tool calls — herramientas ejecutadas */}
          {!isUser && toolCalls.length > 0 && (
            <div className="tool-calls">
              <div className="tool-calls-label">
                {isStreaming && toolCalls.some((c) => c.phase === 'running')
                  ? 'Consultando sistema…'
                  : `${toolCalls.length} ${toolCalls.length === 1 ? 'herramienta usada' : 'herramientas usadas'}`}
              </div>
              {toolCalls.map((call) => (
                <ToolCallRow key={call.id} call={call} />
              ))}
            </div>
          )}

          {renderContent(message.content)}

          {isStreaming && !message.content && statusSteps.length === 0 && toolCalls.length === 0 && (
            <span className="chat-cursor" />
          )}
          {isStreaming && (message.content || toolCalls.length > 0) && (
            <span className="chat-cursor" />
          )}
        </div>
      </div>
    </div>
  );
}
