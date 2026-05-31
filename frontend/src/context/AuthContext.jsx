import { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { track, resetQueue } from '../hooks/useTracking';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sc_token');
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      api.get('/auth/me')
        .then(res => setUser(res.data))
        .catch(() => { localStorage.removeItem('sc_token'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { token, user } = res.data;
    // Limpiar cola de telemetría pre-auth para no atribuir eventos
    // anónimos al user que recién se autentica.
    resetQueue();
    localStorage.setItem('sc_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(user);
    return user;
  };

  const register = async (payload) => {
    const res = await api.post('/auth/register', payload);
    const { token, user } = res.data;
    resetQueue(); // descartar eventos pre-auth
    localStorage.setItem('sc_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(user);
    // Telemetría: signup completado (primer auth) — alimenta el funnel
    // de activación del módulo admin. Try/catch defensivo: track no debe
    // romper el flow de signup si la cola está en mal estado.
    try { track('signup_completed', { method: 'password' }); } catch { /* ignore */ }
    return user;
  };

  const loginWithGoogle = async ({ credential, requested_role }) => {
    const res = await api.post('/auth/google', { credential, requested_role });
    const { token, user } = res.data;
    resetQueue();
    localStorage.setItem('sc_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(user);
    try { track('signup_completed', { method: 'google' }); } catch { /* ignore */ }
    return user;
  };

  // Aplica una sesión ya emitida por el backend (e.g. tras signup con token
  // de invitación, que devuelve { token, user } en una sola respuesta).
  const applyAuth = ({ token, user: nextUser }) => {
    resetQueue();
    localStorage.setItem('sc_token', token);
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setUser(nextUser);
    try { track('signup_completed', { method: 'invitation' }); } catch { /* ignore */ }
    return nextUser;
  };

  const logout = () => {
    resetQueue(); // descartar telemetría pendiente del user saliendo
    localStorage.removeItem('sc_token');
    delete api.defaults.headers.common['Authorization'];
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, loginWithGoogle, applyAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
