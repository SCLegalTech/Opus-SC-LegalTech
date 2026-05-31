import { useRef, useEffect, useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import ArtifactChip from './ArtifactChip';
import ChatMessage from './ChatMessage';
import { track } from '../../hooks/useTracking';

const QUICK_PROMPTS = [
  'Revisa este caso y proponme la siguiente accion, riesgos y tareas concretas.',
  'Haz un barrido operativo del expediente y dime que falta por clasificar o completar.',
  'Cruza tareas, vencimientos y correos del caso para priorizar la semana.',
  'Prepara un plan para organizar Drive y Gmail del caso sin ejecutar cambios irreversibles.',
];

const QUICK_ACTIONS = [
  {
    label: 'Diagnostico',
    prompt: 'Dame un diagnostico operativo del contexto activo: tareas, vencimientos, documentos faltantes y siguiente accion sugerida.',
  },
  {
    label: 'Expediente',
    prompt: 'Revisa el expediente activo y proponme como organizar documentos, soportes faltantes y tareas derivadas.',
  },
  {
    label: 'Drive/Gmail',
    prompt: 'Con el contexto actual, propon un plan para revisar Drive y Gmail del caso, priorizando acciones de bajo riesgo.',
  },
];

export default function AgentPanel() {
  const {
    isOpen, togglePanel,
    messages, sendMessage, clearMessages,
    artifacts, addArtifact,
    sessions, currentSessionId, createNewConversation, selectConversation,
    selectedProfile, setSelectedProfile,
    isStreaming, stopStreaming,
    screenContext,
  } = useAgent();

  // F5 — riel por dominio: si la pantalla activa registró acciones, se usan
  // en vez de las genéricas. El chat queda como afordancia secundaria.
  const domainActions = screenContext?.actions?.length ? screenContext.actions : QUICK_ACTIONS;
  const domainPrompts = screenContext?.prompts?.length ? screenContext.prompts : QUICK_PROMPTS;

  const [input, setInput] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState(null);
  const [activeUtilityPanel, setActiveUtilityPanel] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setActiveUtilityPanel(null);
    }
  }, [isOpen]);

  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    const baseHeight = 44;

    if (!input.trim()) {
      element.style.height = `${baseHeight}px`;
      element.style.overflowY = 'hidden';
      return;
    }

    element.style.height = '0px';
    const nextHeight = Math.max(baseHeight, Math.min(element.scrollHeight, 144));
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > 144 ? 'auto' : 'hidden';
  }, [input, isOpen, currentSessionId]);

  useEffect(() => {
    if (!isOpen) return;

    const token = localStorage.getItem('sc_token');
    if (!token) return;

    let active = true;
    setStatusLoading(true);
    setStatusError(null);

    const query = new URLSearchParams({ health: 'true' });
    if (selectedProfile) query.set('profile', selectedProfile);

    const apiBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
    fetch(`${apiBase}/api/agent/status?${query.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!active) return;
        setAgentStatus(data);
      })
      .catch((err) => {
        if (!active) return;
        setStatusError(err.message);
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });

    return () => { active = false; };
  }, [isOpen, selectedProfile]);

  const handleDragOver = (e) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/x-sc-artifact')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/x-sc-artifact');
    if (!raw) return;
    try {
      const artifact = JSON.parse(raw);
      addArtifact(artifact);
    } catch {}
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    // Telemetría: paso del funnel "primera interacción con Phi". El
    // backend deduplica por organization_id al armar el funnel — acá
    // disparamos en cada mensaje para tener también frecuencia de uso.
    track('first_agent_chat', { input_length: input.length });
    sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const currentSessionTitle =
    sessions.find((session) => session.id === currentSessionId)?.title || 'Conversacion Phi';

  const downloadTranscript = () => {
    const lines = [];
    lines.push(`# ${currentSessionTitle}`);
    lines.push(`Fecha: ${new Date().toLocaleString('es-CO')}`);
    if (artifacts.length) {
      lines.push('', '## Contexto activo');
      artifacts.forEach((artifact) => {
        const summary = artifact.summary ? ` - ${artifact.summary}` : '';
        lines.push(`- [${artifact.type}] ${artifact.title || artifact.id}${summary}`);
      });
    }
    lines.push('', '## Transcripcion');
    if (!messages.length) {
      lines.push('', '(Sin mensajes.)');
    }
    messages.forEach((msg) => {
      const role = msg.role === 'user' ? 'Usuario' : 'Phi';
      lines.push('', `### ${role}`);
      lines.push((msg.content || '').trim() || '(sin contenido)');
      if (Array.isArray(msg.toolCalls) && msg.toolCalls.length) {
        lines.push('', '**Tool calls:**');
        msg.toolCalls.forEach((call) => {
          const args = call.args && Object.keys(call.args).length
            ? ` ${JSON.stringify(call.args)}`
            : '';
          const phase = call.phase || 'running';
          const flag = call.ok === false ? ' (error)' : '';
          lines.push(`- ${call.name}${args} -> ${phase}${flag}`);
          if (call.output_preview) {
            lines.push(`  preview: ${String(call.output_preview).slice(0, 240)}`);
          }
        });
      }
      if (Array.isArray(msg.statusSteps) && msg.statusSteps.length) {
        lines.push('', '**Estado:**');
        msg.statusSteps.forEach((step) => {
          lines.push(`- [${step.state}] ${step.label}`);
        });
      }
    });

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    anchor.href = url;
    anchor.download = `phi-${stamp}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const handleClearConversation = () => {
    if (!messages.length && !artifacts.length) return;
    const confirmed = window.confirm(
      'Borrar los mensajes y el contexto de esta conversacion. Tu historial de otras conversaciones no se toca. Continuar?'
    );
    if (confirmed) clearMessages();
  };

  const runtime = agentStatus?.runtime;
  // Lista unificada para el selector: incluye Gemini como opcion remota cuando
  // esta disponible + cada profile local que esta REALMENTE instalado en Ollama.
  // El backend filtra los profiles que apuntan a modelos no descargados (evita
  // los 404 "model not found").
  const providerOptions = Array.isArray(agentStatus?.provider_options) ? agentStatus.provider_options : [];
  const profiles = providerOptions.length > 0 ? providerOptions : (Array.isArray(agentStatus?.profiles) ? agentStatus.profiles : []);
  const providerHealth = agentStatus?.provider_health || agentStatus?.ollama;
  const primaryProvider = agentStatus?.primary_provider || agentStatus?.provider;
  const geminiAvailable = agentStatus?.gemini?.available === true;
  const modelLabel = primaryProvider === 'gemini' && agentStatus?.gemini?.model
    ? agentStatus.gemini.model
    : (runtime?.family_label || runtime?.model_label || runtime?.model || runtime?.ollama_model || 'sin modelo');
  const profileLabel = runtime?.local_profile_label || 'Perfil local';
  const healthLabel = statusLoading
    ? 'verificando'
    : statusError
      ? 'sin conexion'
      : primaryProvider === 'gemini'
        ? (geminiAvailable ? 'gemini listo' : 'gemini sin clave')
        : providerHealth?.ok
          ? ((providerHealth.model_available === false || providerHealth.cli_available === false) ? 'modelo no cargado' : 'listo')
          : runtime?.provider === 'litert_lm'
            ? 'litert offline'
            : 'ollama offline';

  return (
    <>
      <button
        className={`agent-toggle ${isOpen ? 'agent-toggle--active' : ''}`}
        onClick={togglePanel}
        title={isOpen ? 'Cerrar Phi' : 'Abrir Phi - Asistente IA'}
      >
        <span className="agent-toggle-clip">
          <span className="agent-toggle-mark" aria-hidden="true">Opus</span>
        </span>
      </button>

      <aside
        className={`agent-panel ${isOpen ? 'agent-panel--open' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="agent-panel-header">
          <div className="agent-panel-header-left">
            <span className="agent-panel-phi" aria-hidden="true">Opus</span>
            <div>
              <div className="agent-panel-title-row">
                <div className="agent-panel-title">Phi</div>
                <span className={`agent-panel-health agent-panel-health--${(healthLabel === 'listo' || healthLabel === 'gemini listo') ? 'ok' : healthLabel === 'verificando' ? 'neutral' : 'warn'}`}>
                  {healthLabel}
                </span>
              </div>
              <div className="agent-panel-subtitle">SC LegalTech · IA</div>
            </div>
          </div>
          <div className="agent-panel-header-actions">
            <button
              className={`agent-action-btn${activeUtilityPanel === 'history' ? ' agent-action-btn--active' : ''}`}
              onClick={() => setActiveUtilityPanel((value) => value === 'history' ? null : 'history')}
              title="Historial de conversaciones"
            >
              ≡
            </button>
            <button
              className={`agent-action-btn${activeUtilityPanel === 'status' ? ' agent-action-btn--active' : ''}`}
              onClick={() => setActiveUtilityPanel((value) => value === 'status' ? null : 'status')}
              title="Estado del agente"
            >
              i
            </button>
            <button
              className="agent-action-btn"
              onClick={downloadTranscript}
              title="Descargar transcripcion (.md)"
              disabled={!messages.length}
            >
              ↓
            </button>
            <button
              className="agent-action-btn"
              onClick={handleClearConversation}
              title="Borrar mensajes de esta conversacion"
              disabled={!messages.length && !artifacts.length}
            >
              ⌫
            </button>
            <button
              className="agent-action-btn"
              onClick={() => {
                createNewConversation();
                setInput('');
              }}
              title="Nueva conversacion"
            >
              +
            </button>
            <button
              className="agent-action-btn"
              onClick={togglePanel}
              title="Cerrar"
            >
              x
            </button>
          </div>
        </div>

        {activeUtilityPanel && (
          <div className="agent-utility-panel">
            {activeUtilityPanel === 'status' ? (
              <div className="agent-runtime-strip">
                <div className="agent-runtime-main">
                  <span className={`agent-runtime-badge agent-runtime-badge--${(healthLabel === 'listo' || healthLabel === 'gemini listo') ? 'ok' : healthLabel === 'verificando' ? 'neutral' : 'warn'}`}>
                    {healthLabel}
                  </span>
                  <div className="agent-runtime-meta">
                    <strong>{modelLabel}</strong>
                    <span>
                      {profileLabel} | ctx tarea {runtime?.task_options?.num_ctx ?? '-'} | ctx chat {runtime?.chat_options?.num_ctx ?? '-'}
                    </span>
                  </div>
                </div>
                {profiles.length > 0 && (
                  <div className="agent-profile-picker">
                    <label htmlFor="agent-profile-select" className="agent-profile-label">
                      Modelo / perfil
                    </label>
                    <select
                      id="agent-profile-select"
                      className="agent-profile-select"
                      value={selectedProfile || runtime?.local_profile || ''}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                      disabled={isStreaming}
                    >
                      {profiles.map((profile) => (
                        <option
                          key={profile.id}
                          value={profile.id}
                          disabled={profile.available === false}
                        >
                          {profile.family_label} · {profile.model_label}
                          {profile.kind === 'remote' ? ' (en la nube)' : ''}
                          {profile.available === false ? ' — no disponible' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="agent-history agent-history--drawer">
                <div className="agent-history-label">Conversaciones</div>
                <div className="agent-history-list">
                  {sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className={`agent-history-item${session.id === currentSessionId ? ' active' : ''}`}
                      onClick={() => {
                        selectConversation(session.id);
                        setActiveUtilityPanel(null);
                      }}
                      title={session.title}
                    >
                      <span>{session.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {artifacts.length > 0 && (
          <div className="agent-artifacts">
            <div className="agent-artifacts-label">Contexto activo</div>
            <div className="agent-artifacts-list">
              {artifacts.map(a => (
                <ArtifactChip key={`${a.type}-${a.id}`} artifact={a} />
              ))}
            </div>
          </div>
        )}

        {screenContext?.label && (
          <div className="agent-screen-context" title="Contexto de la pantalla activa">
            <span className="agent-screen-context-dot" aria-hidden="true" />
            Contexto: {screenContext.label}
          </div>
        )}

        {(artifacts.length > 0 || messages.length > 0 || screenContext?.actions?.length) && (
          <div className="agent-quick-actions">
            {domainActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="agent-quick-btn"
                onClick={() => {
                  if (isStreaming) return;
                  sendMessage(action.prompt);
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        {artifacts.length === 0 && messages.length === 0 && (
          <div className={`agent-dropzone ${isDragOver ? 'agent-dropzone--over' : ''}`}>
            <span className="agent-dropzone-phi" aria-hidden="true">Opus</span>
            <p className="agent-dropzone-text">
              Arrastra un caso, tarea o cliente aqui para darme contexto
            </p>
            <p className="agent-dropzone-hint">
              O escribeme directamente; tengo acceso al sistema
            </p>
            <div className="agent-prompt-guide">
              {domainPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="agent-prompt-chip"
                  onClick={() => {
                    if (isStreaming) return;
                    sendMessage(prompt);
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {isDragOver && (artifacts.length > 0 || messages.length > 0) && (
          <div className="agent-dragover-indicator">
            Suelta para agregar al contexto
          </div>
        )}

        <div className="agent-messages">
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>

        <form className="agent-input-form" onSubmit={handleSubmit}>
          <textarea
            key={currentSessionId}
            ref={inputRef}
            className="agent-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe un mensaje... (Enter para enviar)"
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button
              type="button"
              className="agent-send-btn agent-send-btn--stop"
              onClick={stopStreaming}
              title="Detener"
            >
              x
            </button>
          ) : (
            <button
              type="submit"
              className="agent-send-btn"
              disabled={!input.trim()}
              title="Enviar"
            >
              ^
            </button>
          )}
        </form>
      </aside>
    </>
  );
}
