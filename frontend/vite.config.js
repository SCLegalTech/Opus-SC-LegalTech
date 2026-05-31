import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000';
const agentProxyTarget = process.env.VITE_AGENT_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/src/components/AgentPanel') || id.includes('/src/context/AgentContext')) {
            return 'agent-panel';
          }

          // Todo node_modules va a un único chunk `vendor`. NO separar React en
          // su propio chunk: librerías que usan React.forwardRef (p. ej. recharts,
          // cuya ruta no contiene "react") caían en otro chunk que se inicializaba
          // antes que React → "Cannot read properties of undefined (reading
          // 'forwardRef')" y pantalla negra en prod. Co-localizar garantiza el
          // orden de inicialización correcto.
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    watch: {
      // Necesario en Docker/WSL2: inotify no propaga desde Windows
      usePolling: true,
      interval: 300,
    },
    proxy: {
      '/api/agent': {
        target: agentProxyTarget,
        changeOrigin: true,
      },
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      }
    }
  }
});
