import axios from 'axios';

// En despliegues separados, VITE_API_URL apunta al backend.
// En dev queda vacio y usa el proxy de Vite (/api -> localhost:4000).
const API_BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
});

// Interceptor para errores 401
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('sc_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Reattach token on page load
const token = localStorage.getItem('sc_token');
if (token) {
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
}

export default api;
