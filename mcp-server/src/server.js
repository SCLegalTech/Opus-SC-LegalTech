/**
 * server.js — SC LegalTech · Opus MCP Server
 *
 * Instancia el McpServer e incorpora todas las herramientas.
 * Este módulo NO inicia el transporte — eso lo hace index.js.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { registerCaseTools      } from './tools/cases.js';
import { registerClientTools    } from './tools/clients.js';
import { registerMacrocasoTools } from './tools/macrocasos.js';
import { registerTaskTools      } from './tools/tasks.js';
import { registerDashboardTools } from './tools/dashboard.js';
import { registerDriveTools     } from './tools/drive.js';
import { registerGmailTools     } from './tools/gmail.js';
import { registerDocumentTools  } from './tools/documents.js';
import { registerAgentTools     } from './tools/agent.js';
import { registerEntityTools    } from './tools/entities.js';
import { registerWhatsappTools  } from './tools/whatsapp.js';
import { registerJudicialTools  } from './tools/judicial.js';
import { runWithActor }           from './actor-context.js';

/**
 * Envuelve `server.tool` para inyectar el flag `_actor_user_id` en cada
 * schema de tool y extraer el actor antes de invocar el handler real. Así
 * todas las tools registradas heredan el comportamiento sin tener que
 * tocarse una por una.
 *
 * Contrato: el backend (mcpClient.service.js) inyecta `_actor_user_id`
 * dentro de `arguments` cuando hay un usuario autenticado. Aquí lo
 * extraemos, lo guardamos en AsyncLocalStorage y lo borramos antes de que
 * el handler vea los argumentos. api-client.js lo lee del store y agrega
 * el header X-On-Behalf-Of al backend.
 */
function patchToolRegistration(server) {
  const original = server.tool.bind(server);
  server.tool = (name, description, schemaShape, handler) => {
    const augmentedShape = {
      ...(schemaShape || {}),
      _actor_user_id: z.union([z.number(), z.string()]).optional()
        .describe('[interno] Inyectado por el backend para impersonación RBAC. No usar manualmente.'),
    };
    const wrappedHandler = async (rawArgs, extra) => {
      const { _actor_user_id, ...cleanArgs } = rawArgs || {};
      return runWithActor(_actor_user_id ?? null, () => handler(cleanArgs, extra), name);
    };
    return original(name, description, augmentedShape, wrappedHandler);
  };
}

export function createServer() {
  const server = new McpServer({
    name:    'opus',
    version: '1.6.0',
  });

  patchToolRegistration(server);

  // Registro de las herramientas agrupadas por dominio
  registerCaseTools(server);       // 1–6   Casos
  registerClientTools(server);     // 7–9   Clientes
  registerMacrocasoTools(server);  // 10–11 Macrocasos
  registerTaskTools(server);       // 12–13 Tareas y vencimientos
  registerDashboardTools(server);  // 14–15 Dashboard / métricas
  registerDriveTools(server);      // 16–19 Google Drive agéntico
  registerGmailTools(server);      // 20–26 Gmail (lectura, ingesta, envío)
  registerDocumentTools(server);   // 27–33 Plantillas, redacción, firma, export
  registerAgentTools(server);      // 34–39 Auditoría agéntica + planes

  registerEntityTools(server);
  registerWhatsappTools(server);   // 40–46 WhatsApp Business (Meta Cloud API)
  registerJudicialTools(server);   // Integraciones judiciales supervisadas

  return server;
}
