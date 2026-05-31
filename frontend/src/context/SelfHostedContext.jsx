import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const SelfHostedContext = createContext(null);

const DEFAULT_CONTEXT = {
  organization_id: null,
  edition: 'self_hosted',
  features: {
    api_access: true,
    calendar_sync: true,
    case_tracking: true,
    doc_ai: true,
    drive: true,
    expediente_vivo: true,
    gamification: true,
    gmail_triage: true,
    judicial_tracking: true,
    kaizen: true,
    macrocasos: true,
    projects: true,
    sala_ai_native: true,
    time_tracking: true,
    whatsapp: true,
  },
  branding: null,
  firm: { brand_name: null, logo_url: null },
};

export const SelfHostedProvider = ({ children }) => {
  const { user } = useAuth();
  const [context, setContext] = useState(DEFAULT_CONTEXT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    if (!user) {
      setContext(DEFAULT_CONTEXT);
      setLoading(false);
      return;
    }

    setLoading(true);
    api.get('/onboarding/state')
      .then((res) => {
        const data = res.data || {};
        setContext({
          ...DEFAULT_CONTEXT,
          organization_id: data.organization_id || data.organization?.id || null,
          firm: {
            brand_name: data.firm?.brand_name || data.organization?.brand_name || null,
            logo_url: data.firm?.logo_url || data.organization?.logo_url || null,
          },
        });
      })
      .catch(() => setContext(DEFAULT_CONTEXT))
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const value = {
    ...context,
    loading,
    refresh,
    hasFeature: () => true,
  };

  return <SelfHostedContext.Provider value={value}>{children}</SelfHostedContext.Provider>;
};

export const useSelfHosted = () => {
  const ctx = useContext(SelfHostedContext);
  if (!ctx) {
    return {
      ...DEFAULT_CONTEXT,
      loading: false,
      refresh: () => {},
      hasFeature: () => true,
    };
  }
  return ctx;
};
