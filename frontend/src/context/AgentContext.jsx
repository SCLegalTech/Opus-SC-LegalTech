import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

const AgentContext = createContext(null);

const HISTORY_KEY = 'sc_agent_sessions_v1';
const SIDEBAR_KEY = 'sidebarCollapsed';
const PROFILE_KEY = 'sc_agent_profile_v1';

// Tools que MUTAN estado en el backend. Cuando alguna se ejecuta exitosa,
// disparamos `phi-mutation` en window — las páginas pueden escucharla y
// refetchar para mostrar el cambio sin que el usuario tenga que F5.
const MUTATION_TOOLS = new Set([
  'create_task',
  'update_task',
  'create_case',
  'update_case',
  'create_deadline',
  'add_communication',
  'add_case_note',
  'document_draft',
  'document_mark_signed',
]);

function upsertStatusStep(steps = [], incoming) {
  if (!incoming?.label) return steps;

  const next = Array.isArray(steps) ? [...steps] : [];
  const step = {
    id: incoming.id || `status-${Date.now()}`,
    label: incoming.label,
    state: incoming.state || 'running',
    detail: incoming.detail || null,
    ts: incoming.ts || new Date().toISOString(),
  };

  const index = next.findIndex((item) => item.id === step.id);
  if (index >= 0) next[index] = { ...next[index], ...step };
  else next.push(step);

  return next.slice(-6);
}

function buildSessionTitle(messages = [], artifacts = []) {
  const firstUser = messages.find((msg) => msg.role === 'user' && msg.content?.trim());
  if (firstUser) return firstUser.content.trim().slice(0, 56);
  if (artifacts.length > 0) return `Contexto: ${artifacts[0].title}`;
  return 'Nueva conversacion';
}

function createSession(seed = {}) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  return {
    id,
    title: seed.title || 'Nueva conversacion',
    updatedAt: new Date().toISOString(),
    messages: seed.messages || [],
    artifacts: seed.artifacts || [],
  };
}

// Limpia mensajes huerfanos: si un assistantMsg quedo con streaming:true y sin
// contenido (por un reload/crash), lo borramos para no mostrar burbujas vacias.
function sanitizeSessions(sessions) {
  return sessions.map((session) => ({
    ...session,
    messages: (session.messages || [])
      .map((msg) => (msg.streaming ? { ...msg, streaming: false } : msg))
      .filter((msg) => !(msg.role === 'assistant' && !msg.content?.trim() && !(msg.toolCalls?.length))),
  }));
}

export function AgentProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [sessions, setSessions] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const base = Array.isArray(parsed) && parsed.length ? parsed : [createSession()];
      return sanitizeSessions(base);
    } catch {
      return [createSession()];
    }
  });
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) && parsed[0]?.id ? parsed[0].id : null;
    } catch {
      return null;
    }
  });
  const [isStreaming, setIsStreaming] = useState(false);
  // Contexto de la pantalla activa (F5): cada página registra su etiqueta y sus
  // acciones de dominio, y el panel de Phi las muestra en vez de las genéricas.
  const [screenContext, setScreenContextState] = useState(null);
  const [sidebarUserCollapsed, setSidebarUserCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === 'true'
  );
  const [selectedProfile, setSelectedProfileState] = useState(
    () => localStorage.getItem(PROFILE_KEY) || ''
  );
  const abortRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (!currentSessionId && sessions[0]?.id) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [currentSessionId, sessions]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, String(sidebarUserCollapsed));
  }, [sidebarUserCollapsed]);

  useEffect(() => {
    if (selectedProfile) localStorage.setItem(PROFILE_KEY, selectedProfile);
    else localStorage.removeItem(PROFILE_KEY);
  }, [selectedProfile]);

  const currentSession = useMemo(() => {
    return sessions.find((session) => session.id === currentSessionId) || sessions[0] || createSession();
  }, [sessions, currentSessionId]);

  const messages = currentSession.messages || [];
  const artifacts = currentSession.artifacts || [];
  const isAiFocusMode = isOpen;
  const sidebarCollapsed = isAiFocusMode ? true : sidebarUserCollapsed;

  const patchCurrentSession = useCallback((updater) => {
    setSessions((prev) => {
      const baseline = prev.length ? [...prev] : [createSession()];
      const targetId = currentSessionId || baseline[0].id;
      const index = baseline.findIndex((session) => session.id === targetId);
      const safeIndex = index >= 0 ? index : 0;
      const current = baseline[safeIndex];
      const nextSession = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      baseline[safeIndex] = {
        ...nextSession,
        title: buildSessionTitle(nextSession.messages, nextSession.artifacts),
        updatedAt: new Date().toISOString(),
      };
      return baseline.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    });
  }, [currentSessionId]);

  const togglePanel = useCallback(() => setIsOpen((v) => !v), []);
  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);
  const setSidebarCollapsed = useCallback((value) => setSidebarUserCollapsed(Boolean(value)), []);
  const setSelectedProfile = useCallback((value) => {
    setSelectedProfileState(String(value || '').trim());
  }, []);
  const setScreenContext = useCallback((value) => setScreenContextState(value), []);

  const createNewConversation = useCallback(() => {
    const next = createSession();
    setSessions((prev) => [next, ...prev]);
    setCurrentSessionId(next.id);
    setIsOpen(true);
  }, []);

  const selectConversation = useCallback((sessionId) => {
    setCurrentSessionId(sessionId);
    setIsOpen(true);
  }, []);

  const addArtifact = useCallback((artifact) => {
    patchCurrentSession((session) => {
      const prev = session.artifacts || [];
      const exists = prev.some((item) => item.type === artifact.type && String(item.id) === String(artifact.id));
      if (exists) return session;
      return { ...session, artifacts: [...prev, artifact] };
    });
    setIsOpen(true);
  }, [patchCurrentSession]);

  const removeArtifact = useCallback((type, id) => {
    patchCurrentSession((session) => ({
      ...session,
      artifacts: (session.artifacts || []).filter((item) => !(item.type === type && String(item.id) === String(id))),
    }));
  }, [patchCurrentSession]);

  const clearArtifacts = useCallback(() => {
    patchCurrentSession((session) => ({ ...session, artifacts: [] }));
  }, [patchCurrentSession]);

  const clearMessages = useCallback(() => {
    patchCurrentSession((session) => ({ ...session, messages: [], artifacts: [] }));
  }, [patchCurrentSession]);

  const sendMessage = useCallback(async (content) => {
    if (isStreaming || !content.trim()) return;

    const userMsg = { role: 'user', content: content.trim(), id: Date.now() };
    const assistantMsg = {
      role: 'assistant',
      content: '',
      id: Date.now() + 1,
      streaming: true,
      statusSteps: [],
      toolCalls: [],
    };

    flushSync(() => {
      patchCurrentSession((session) => ({
        ...session,
        messages: [...(session.messages || []), userMsg, assistantMsg],
      }));
    });
    setIsStreaming(true);
    setIsOpen(true);

    const token = localStorage.getItem('sc_token');
    if (!token) {
      patchCurrentSession((session) => ({
        ...session,
        messages: (session.messages || []).map((msg) =>
          msg.id === assistantMsg.id
            ? {
                ...msg,
                content: 'Para hablar con Opus necesito una sesion activa. Ingresa con tu cuenta y vuelvo a abrir esta conversacion con el contexto del sistema.',
                streaming: false,
              }
            : msg
        ),
      }));
      setIsStreaming(false);
      return;
    }

    const history = [...messages, userMsg].map(({ role, content: messageContent }) => ({ role, content: messageContent }));

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const apiBase = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/$/, '') : '';
      const res = await fetch(`${apiBase}/api/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history,
          // selectedProfile puede ser:
          //   - "gemini" -> el backend lo trata como provider remoto (no force skip)
          //   - "qwen2_5_1_5b" o algun perfil local -> backend salta Gemini directo
          //   - null/"" -> backend usa default (Gemini si hay key, sino local)
          profile: selectedProfile && selectedProfile !== 'gemini' ? selectedProfile : null,
          provider: selectedProfile === 'gemini' ? 'gemini' : null,
          artifacts: artifacts.map(({ type, id, title, summary, data }) => ({ type, id, title, summary, data })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;

          try {
            const json = JSON.parse(raw);

            if (json.chunk) {
              patchCurrentSession((session) => ({
                ...session,
                messages: (session.messages || []).map((msg) =>
                  msg.id === assistantMsg.id
                    ? { ...msg, content: msg.content + json.chunk }
                    : msg
                ),
              }));
            }

            if (json.status) {
              patchCurrentSession((session) => ({
                ...session,
                messages: (session.messages || []).map((msg) =>
                  msg.id === assistantMsg.id
                    ? { ...msg, statusSteps: upsertStatusStep(msg.statusSteps, json.status) }
                    : msg
                ),
              }));
            }

            if (json.tool_call) {
              const tc = json.tool_call;
              patchCurrentSession((session) => ({
                ...session,
                messages: (session.messages || []).map((msg) => {
                  if (msg.id !== assistantMsg.id) return msg;
                  const calls = Array.isArray(msg.toolCalls) ? [...msg.toolCalls] : [];
                  if (tc.phase === 'start') {
                    calls.push({ id: `${tc.name}_${Date.now()}`, name: tc.name, args: tc.args || {}, phase: 'running', ts: new Date().toISOString() });
                  } else if (tc.phase === 'end') {
                    // actualiza la última llamada pendiente de ese tool
                    const idx = calls.map((c, i) => ({ c, i })).reverse().find(({ c }) => c.name === tc.name && c.phase === 'running')?.i;
                    if (idx !== undefined) calls[idx] = { ...calls[idx], phase: tc.ok ? 'done' : 'error', ok: tc.ok, output_preview: tc.output_preview || null };
                    // Auto-refresh: si fue una mutación exitosa, avisa al resto de la app.
                    if (tc.ok && MUTATION_TOOLS.has(tc.name)) {
                      window.dispatchEvent(new CustomEvent('phi-mutation', {
                        detail: { tool: tc.name, output_preview: tc.output_preview || null },
                      }));
                    }
                  }
                  return { ...msg, toolCalls: calls };
                }),
              }));
            }

            if (json.error) {
              patchCurrentSession((session) => ({
                ...session,
                messages: (session.messages || []).map((msg) =>
                  msg.id === assistantMsg.id
                    ? { ...msg, content: `Error: ${json.error}`, streaming: false, error: true }
                    : msg
                ),
              }));
            }

            if (json.done) {
              patchCurrentSession((session) => ({
                ...session,
                artifacts: json.context_artifact
                  ? (() => {
                      const currentArtifacts = session.artifacts || [];
                      const exists = currentArtifacts.some((item) =>
                        item.type === json.context_artifact.type && String(item.id) === String(json.context_artifact.id)
                      );
                      return exists ? currentArtifacts : [...currentArtifacts, json.context_artifact];
                    })()
                  : (session.artifacts || []),
                messages: (session.messages || []).map((msg) =>
                  msg.id === assistantMsg.id ? { ...msg, streaming: false } : msg
                ),
              }));
            }
          } catch {
            // ignorar fragmentos incompletos
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        patchCurrentSession((session) => ({
          ...session,
          messages: (session.messages || []).map((msg) =>
            msg.id === assistantMsg.id
              ? { ...msg, content: `Error de conexion: ${err.message}`, streaming: false, error: true }
              : msg
          ),
        }));
      }
    } finally {
      patchCurrentSession((session) => ({
        ...session,
        messages: (session.messages || []).map((msg) =>
          msg.id === assistantMsg.id && msg.streaming ? { ...msg, streaming: false } : msg
        ),
      }));
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [artifacts, isStreaming, messages, patchCurrentSession, selectedProfile]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return (
    <AgentContext.Provider
      value={{
        isOpen,
        isAiFocusMode,
        togglePanel,
        openPanel,
        closePanel,
        messages,
        sendMessage,
        clearMessages,
        artifacts,
        addArtifact,
        removeArtifact,
        clearArtifacts,
        sessions,
        currentSessionId,
        createNewConversation,
        selectConversation,
        sidebarCollapsed,
        setSidebarCollapsed,
        selectedProfile,
        setSelectedProfile,
        isStreaming,
        stopStreaming,
        screenContext,
        setScreenContext,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
}

export const useAgent = () => {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error('useAgent debe usarse dentro de AgentProvider');
  return ctx;
};

/**
 * useScreenContext — una pantalla declara su contexto y acciones de dominio
 * para el riel de Phi (F5). Se limpia al desmontar.
 *
 *   useScreenContext({
 *     label: 'Caso SC-2026-0001',
 *     actions: [{ label: 'Diagnóstico', prompt: '...' }],
 *     prompts: ['Pregunta sugerida 1', ...],   // opcional
 *   }, [caseId]);
 */
export function useScreenContext(config, deps = []) {
  const { setScreenContext } = useAgent();
  useEffect(() => {
    setScreenContext(config || null);
    return () => setScreenContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
