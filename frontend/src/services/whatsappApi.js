/**
 * whatsappApi.js
 * ─────────────────────────────────────────────────────────────
 * Cliente delgado sobre /api/whatsapp/*. Cada función envuelve
 * el axios instance compartido y devuelve solo `data` (sin el
 * envelope HTTP completo).
 */

import api from './api';

// ── Conversaciones ──────────────────────────────────────────

export const listConversations = async (params = {}) => {
  const { data } = await api.get('/whatsapp/conversations', { params });
  return data;
};

export const getConversation = async (id) => {
  const { data } = await api.get(`/whatsapp/conversations/${id}`);
  return data;
};

export const listMessages = async (conversationId, params = {}) => {
  const { data } = await api.get(`/whatsapp/conversations/${conversationId}/messages`, { params });
  return data;
};

export const markRead = async (conversationId) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/read`);
  return data;
};

export const assignConversation = async (conversationId, userId) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/assign`, { user_id: userId });
  return data;
};

export const linkCase = async (conversationId, caseId) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/link-case`, { case_id: caseId });
  return data;
};

export const linkClient = async (conversationId, clientId) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/link-client`, { client_id: clientId });
  return data;
};

// ── Envío ────────────────────────────────────────────────────

export const sendText = async (conversationId, body) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/send-text`, { body });
  return data;
};

export const sendTemplate = async (conversationId, payload) => {
  const { data } = await api.post(`/whatsapp/conversations/${conversationId}/send-template`, payload);
  return data;
};

// ── Plantillas ──────────────────────────────────────────────

export const listTemplates = async () => {
  const { data } = await api.get('/whatsapp/templates');
  return data;
};

export const syncTemplates = async () => {
  const { data } = await api.post('/whatsapp/templates/sync');
  return data;
};

// ── Números WABA ────────────────────────────────────────────

export const listNumbers = async () => {
  const { data } = await api.get('/whatsapp/numbers');
  return data;
};

export const getNumberStatus = async () => {
  const { data } = await api.get('/whatsapp/numbers/status');
  return data;
};

// ── Helpers de presentación ─────────────────────────────────

export const formatPhone = (phone) => {
  if (!phone) return '';
  const cleaned = String(phone).replace(/[^\d+]/g, '');
  // CO: +57 300 123 4567
  if (cleaned.startsWith('+57') && cleaned.length === 13) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }
  return cleaned;
};

export const formatRelativeTime = (iso) => {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '';
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'ahora';
  if (diffMin < 60) return `${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} d`;
  return new Date(ts).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
};

export const messageTypeIcon = (type) => {
  const map = {
    text: '',
    image: 'IMG',
    document: 'DOC',
    audio: 'AUD',
    video: 'VID',
    location: 'LOC',
    template: 'TMPL',
    sticker: 'STK',
    interactive: 'IX',
    contacts: 'CT',
  };
  return map[type] || type?.toUpperCase()?.slice(0, 3) || '?';
};
