// override:false â€” variables ya seteadas por docker-compose ganan sobre backend/.env.
// Esto permite que el mismo backend/.env sirva para ejecuciÃ³n local (node server.js)
// y para Docker (donde docker-compose.yml define los valores correctos del container).
require('dotenv').config({ override: false });

// Fail-fast: garantiza que JWT_SECRET este definido al boot. Hay codigo legacy
// con fallback a 'sc_secret_2026' (auth.controller.js, middleware/auth.js, modulos
// gmail/google); con esta verificacion el proceso no arranca jamas con ese fallback
// y los `||` quedan como dead code. No valida el contenido para no romper dev local.
if (!process.env.JWT_SECRET) {
  console.error('[boot] JWT_SECRET no esta configurado. Generar con: openssl rand -hex 32');
  process.exit(1);
}

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes         = require('./src/routes/auth.routes');
const casesRoutes        = require('./src/routes/cases.routes');
const clientsRoutes      = require('./src/routes/clients.routes');
const dashboardRoutes    = require('./src/routes/dashboard.routes');
const tareasRoutes       = require('./src/routes/tareas.routes');
const vencimientosRoutes = require('./src/routes/vencimientos.routes');
const entitiesRoutes     = require('./src/routes/entities.routes');
const judicialIntegrationsRoutes = require('./src/routes/judicialIntegrations.routes');
const operationsRoutes   = require('./src/routes/operations.routes');
const webhooksRoutes     = require('./src/routes/webhooks.routes');
const whatsappRoutes     = require('./src/routes/whatsapp.routes');
const prospectsRoutes    = require('./src/routes/prospects.routes');
const organizationsRoutes = require('./src/routes/organizations.routes');
const macrocasosRoutes   = require('./src/routes/macrocasos.routes');
const publicStatusRoutes = require('./src/routes/publicStatus.routes');
const mcpProxyRoutes     = require('./src/routes/mcpProxy.routes');
const legalRequestsRoutes = require('./src/routes/legalRequests.routes');
const cpnuRoutes         = require('./src/routes/cpnu.routes');
const kaizenRoutes       = require('./src/routes/kaizen.routes');
const timeRoutes         = require('./src/routes/timeTracking.routes');
const clientPortalRoutes = require('./src/routes/clientPortal.routes');
const calendarRoutes     = require('./src/routes/googleCalendar.routes');
const inboxRoutes        = require('./src/routes/inbox.routes');
const { myRouter: mcpMyRouter } = require('./src/routes/mcpUsage.routes');
const onboardingRoutes   = require('./src/routes/onboarding.routes');
const eventsRoutes       = require('./src/routes/events.routes');
const googleWorkspace    = require('./src/modules/google-workspace');
const responseWrapper    = require('./src/middleware/responseWrapper');
const agentRoutes        = require('./src/routes/agent.routes');
const {
  templatesRouter,
  documentsRouter,
} = require('./src/routes/documents.routes');
const {
  actionsRouter: agentActionsRouter,
  plansRouter:   agentPlansRouter,
} = require('./src/routes/agentActions.routes');
const proactiveAgent = require('./src/services/proactiveAgent.service');
const { startDailyPriorityScoreLoop } = require('./src/services/operationsPriority.service');
const mcpClient = require('./src/services/mcpClient.service');
const qwenProvider = require('./src/services/agentProviders/qwen.provider');
const waQualityMonitor = require('./src/services/waQualityMonitor.service');
const liveNotify = require('./src/services/liveNotify.service');

const app = express();

// Detras de un proxy/load balancer. Necesario para
// que express vea la IP real del cliente (rate limiting, audit logs).
app.set('trust proxy', 1);

// Helmet con CSP explicita. Evita XSS al restringir desde donde se cargan scripts.
// connectSrc abierto a self porque el frontend sirve por separado en otro origen
// y el browser ya valida CORS desde el lado del API.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://generativelanguage.googleapis.com'],
      frameAncestors: ["'none'"],
      formAction: ["'self'", 'https://chatgpt.com', 'https://chat.openai.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS: lista de origenes separados por coma en CORS_ORIGINS. Soporta wildcards
// por subdominio si fuese necesario via regex. En dev cae a FRONTEND_URL o localhost.
const CORS_ORIGINS = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Lista blanca estricta dirigida por CORS_ORIGINS (data-driven, sin fallback
// permisivo). Los orÃ­genes de desarrollo (puertos de Vite) se agregan de forma
// explÃ­cita en CORS_ORIGINS â€” ver docker-compose.yml / .env. PolÃ­tica F:
// fail-secure, sin regex/fallback hardcodeado ni para dev.
app.use(cors({
  origin: (origin, cb) => {
    // Permitir requests sin Origin (curl, healthchecks).
    if (!origin) return cb(null, true);
    // ChatGPT abre el flujo OAuth de conectores MCP desde un contexto aislado
    // que puede enviar Origin: null. Sin esto, el login OAuth queda bloqueado
    // antes de llegar a /mcp/oauth/authorize.
    if (origin === 'null') return cb(null, true);
    if (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Origen ${origin} no autorizado por CORS`));
  },
  credentials: true,
}));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// WHATSAPP WEBHOOK (Meta Cloud API)
// Se monta ANTES de express.json() porque la verificaciÃ³n de la
// firma X-Hub-Signature-256 (HMAC-SHA256) requiere el body en bruto
// (Buffer). express.json() consumirÃ­a el stream y el HMAC fallarÃ­a.
// El controller hace la verificaciÃ³n, ack 200 inmediato, y procesa
// en background con setImmediate.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Rate limit por IP: Meta reintenta agresivamente, pero un lÃ­mite alto
// (10 req/s sostenido) protege contra abuso si la URL se filtra o se
// inunda intencionalmente. El webhook es pÃºblico y solo HMAC valida
// origen â€” sin este lÃ­mite, el procesamiento en background podrÃ­a
// saturarse aunque las inserciones sean idempotentes.
const whatsappWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Webhook rate limit exceeded' },
});

const whatsappWebhook = require('./src/controllers/whatsappWebhook.controller');
app.get('/api/webhooks/whatsapp', whatsappWebhookLimiter, whatsappWebhook.verifyWebhook);
app.post(
  '/api/webhooks/whatsapp',
  whatsappWebhookLimiter,
  express.raw({ type: '*/*', limit: '5mb' }),
  whatsappWebhook.receiveWebhook
);

app.use(express.json());

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RATE LIMITING
// Protege endpoints sensibles contra fuerza bruta y abuso.
// Se aplica antes de las rutas. Usa la IP real (trust proxy = 1).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 min
  limit: 20,                   // 20 intentos por IP por ventana
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de autenticacion. Esperar 15 minutos.' },
});

const agentChatLimiter = rateLimit({
  windowMs: 60 * 1000,         // 1 min
  limit: 30,                   // 30 mensajes por IP por minuto
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Limite de mensajes al agente excedido. Esperar un momento.' },
});

const publicLegalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta nuevamente mas tarde.' },
});

// Portal cliente â€” endpoint pÃºblico con magic token. Sin auth â†’ vector de
// DoS / brute force enumeration. Limit por IP, ventana corta para tolerar
// recargas del cliente pero frenar scripts.
const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones al portal' },
});

// Endpoints autenticados pero "caros" (queman cuota Gemini, Google
// Calendar API o trÃ¡fico a la Rama Judicial pÃºblica). Limit por usuario
// no por IP, asÃ­ no banneamos toda una firma compartiendo NAT.
const expensiveAuthedLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`),
  message: { error: 'Demasiadas peticiones. Espera un minuto.' },
});

// TelemetrÃ­a frontend (POST /api/events). El frontend envÃ­a batches al
// flush (cada ~5s). El limiter corre a nivel app ANTES de authenticate
// (que estÃ¡ dentro del router), entonces req.user es undefined acÃ¡ y la
// key siempre cae a IP. Se documenta para no engaÃ±ar â€” si en el futuro
// se necesita per-user real, mover este middleware al router despuÃ©s
// del authenticate. Mientras tanto: 120/min por IP es holgado para uso
// normal y mitiga NAT compartido.
const eventsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // keyGenerator default = req.ip (intencional: req.user no existe aquÃ­).
  message: { error: 'Demasiados eventos de telemetrÃ­a' },
});

app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/google',   authLimiter);
app.use('/api/v1/auth/login',    authLimiter);
app.use('/api/v1/auth/register', authLimiter);
app.use('/api/v1/auth/google',   authLimiter);
// OlvidÃ© mi contraseÃ±a â€” frena spam de correos y enumeraciÃ³n de cuentas.
app.use('/api/auth/forgot-password',    authLimiter);
app.use('/api/v1/auth/forgot-password', authLimiter);
app.use('/api/agent/chat',     agentChatLimiter);
app.use('/api/v1/agent/chat',  agentChatLimiter);
app.use('/api/legal-requests', publicLegalLimiter);
app.use('/api/v1/legal-requests', publicLegalLimiter);
// Portal del cliente (pÃºblico, magic-token)
app.use('/api/portal',                   portalLimiter);
app.use('/api/v1/portal',                portalLimiter);
// Endpoints autenticados que queman cuota externa
app.use('/api/inbox/refresh',            expensiveAuthedLimiter);
app.use('/api/v1/inbox/refresh',         expensiveAuthedLimiter);
app.use('/api/judicial/cpnu/lookup',         expensiveAuthedLimiter);
app.use('/api/v1/judicial/cpnu/lookup',      expensiveAuthedLimiter);
app.use('/api/judicial/cpnu/create-case',    expensiveAuthedLimiter);
app.use('/api/v1/judicial/cpnu/create-case', expensiveAuthedLimiter);
// Kaizen despacho dashboard â€” 10 queries paralelas, vale la pena cap
app.use('/api/kaizen/despacho',              expensiveAuthedLimiter);
app.use('/api/v1/kaizen/despacho',           expensiveAuthedLimiter);
// TelemetrÃ­a frontend â€” limit por IP (ver comentario en el limiter).
app.use('/api/events',                       eventsLimiter);
app.use('/api/v1/events',                    eventsLimiter);
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RUTAS LEGACY  /api/*
// Mantienen compatibilidad con el frontend React existente.
// Responden con el formato original (sin envoltura).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.use('/mcp',               mcpProxyRoutes);      // MCP HTTP proxy
app.use('/.well-known',       mcpProxyRoutes);      // OAuth discovery para ChatGPT MCP
app.use('/api/auth',          authRoutes);
app.use('/api/cases',         casesRoutes);
app.use('/api/clients',       clientsRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/tareas',        tareasRoutes);
app.use('/api/vencimientos',  vencimientosRoutes);
app.use('/api/entities',      entitiesRoutes);
app.use('/api/judicial-integrations', judicialIntegrationsRoutes);
app.use('/api/operations',    operationsRoutes);
app.use('/api/webhooks',      webhooksRoutes);       // integraciÃ³n workflow + WhatsApp (sin JWT)
app.use('/api/whatsapp',      whatsappRoutes);       // bandeja WhatsApp (con JWT)
app.use('/api/prospects',     prospectsRoutes);      // pipeline comercial pre-cliente
app.use('/api/organizations', organizationsRoutes);  // contexto local de organizacion
app.use('/api/macrocasos',    macrocasosRoutes);
app.use('/api/status',        publicStatusRoutes);
app.use('/api/legal-requests', legalRequestsRoutes);
app.use('/api/inbox',         inboxRoutes);          // RecepciÃ³n Inteligente (Fase 1)
app.use('/api/mcp',           mcpMyRouter);          // MCP usage â€” vista propia de la org del user
app.use('/api/events',        eventsRoutes);         // TelemetrÃ­a frontend (batches)
app.use('/api/onboarding',    onboardingRoutes);           // Wizard Integra â€” perfil de la org
app.use('/api/judicial/cpnu', cpnuRoutes);           // Radar Colombia â€” consulta pÃºblica CPNU
app.use('/api/kaizen',        kaizenRoutes);          // Kaizen â€” mÃ©tricas de mejora continua
app.use('/api/time',          timeRoutes);            // Time tracking â€” horas billables
app.use('/api/portal',        clientPortalRoutes);    // Portal del cliente final (pÃºblico, token-based)
app.use('/api/calendar',      calendarRoutes);        // Google Calendar sync â€” vencimientos y audiencias
app.use('/api/google',        googleWorkspace.accountRouter);
app.use('/api/drive',         googleWorkspace.driveRouter);
app.use('/api/agent',         agentRoutes);          // Claudia Â· panel agÃ©ntico (SSE)
app.use('/api/templates',     templatesRouter);
app.use('/api/documents',     documentsRouter);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// RUTAS CANÃ“NICAS  /api/v1/*
// Contrato estable para MCP server, agentes y clientes externos.
// Todas las respuestas siguen el envelope { success, data|error }.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const v1 = express.Router();
v1.use(responseWrapper);

v1.use('/auth',         authRoutes);
v1.use('/cases',        casesRoutes);
v1.use('/clients',      clientsRoutes);
v1.use('/dashboard',    dashboardRoutes);
v1.use('/tareas',       tareasRoutes);
v1.use('/vencimientos', vencimientosRoutes);
v1.use('/entities',     entitiesRoutes);
v1.use('/judicial-integrations', judicialIntegrationsRoutes);
v1.use('/operations',   operationsRoutes);
v1.use('/macrocasos',   macrocasosRoutes);
v1.use('/google',       googleWorkspace.accountRouter);
v1.use('/drive',        googleWorkspace.driveRouter);
v1.use('/templates',    templatesRouter);
v1.use('/documents',    documentsRouter);
v1.use('/whatsapp',     whatsappRoutes);
v1.use('/prospects',    prospectsRoutes);
v1.use('/organizations', organizationsRoutes);
v1.use('/status',       publicStatusRoutes);
v1.use('/legal-requests', legalRequestsRoutes);
v1.use('/inbox',         inboxRoutes);
v1.use('/mcp',           mcpMyRouter);
v1.use('/events',        eventsRoutes);
v1.use('/onboarding',    onboardingRoutes);
v1.use('/judicial/cpnu', cpnuRoutes);
v1.use('/kaizen',        kaizenRoutes);
v1.use('/time',          timeRoutes);
v1.use('/portal',        clientPortalRoutes);
v1.use('/calendar',      calendarRoutes);
v1.use('/agent/actions', agentActionsRouter);
v1.use('/agent/plans',   agentPlansRouter);
v1.use('/agent',         agentRoutes);

// Health check con ping real a la DB.
// esto para liveness probes â€” si la DB se cae el contenedor debe marcarse unhealthy
// y reiniciarse o salir del balanceo.
const db = require('./src/config/db');

async function healthPayload() {
  const start = Date.now();
  let dbStatus = 'down';
  let dbLatencyMs = null;
  try {
    await db.query('SELECT 1');
    dbStatus = 'up';
    dbLatencyMs = Date.now() - start;
  } catch (err) {
    console.error('[health] DB down:', err.message);
  }
  return {
    status: dbStatus === 'up' ? 'OK' : 'DEGRADED',
    firm:    'SC LegalTech',
    system:  'Opus',
    version: '3.1.0',
    phase:   'NIGREDO',
    db:      { status: dbStatus, latency_ms: dbLatencyMs },
    timestamp: new Date().toISOString(),
  };
}

v1.get('/health', async (req, res) => {
  const payload = await healthPayload();
  res.status(payload.status === 'OK' ? 200 : 503).json({ ...payload, api: 'v1' });
});

app.use('/api/v1', v1);

// Health check legacy (sin wrapper) â€” chequeo PROFUNDO con ping a la DB.
// Ãšsalo para monitoreo/diagnÃ³stico manual, NO como liveness probe de cada 30s:
// pega a la DB; usalo para diagnostico manual.
app.get('/api/health', async (req, res) => {
  const payload = await healthPayload();
  res.status(payload.status === 'OK' ? 200 : 503).json(payload);
});

// Liveness probe liviano: confirma que el proceso Node responde sin tocar dependencias externas.
const liveness = (req, res) => {
  res.json({ status: 'OK', live: true, timestamp: new Date().toISOString() });
};
app.get('/api/health/live', liveness);
app.get('/api/v1/health/live', liveness);

// Error handler global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`\n  Opus SC LegalTech API`);
  console.log(`  Servidor activo en http://localhost:${PORT}`);
  startDailyPriorityScoreLoop();
  proactiveAgent.startProactiveAgentLoop();
  waQualityMonitor.startLoop();
  // Puente de Mando (F2): escucha NOTIFY 'opus_live' y lo proyecta por SSE.
  liveNotify.startLiveNotify();
  console.log(`  Fase: NIGREDO Â· v2.0.0\n`);

  // MCP client (Fase 1 â€” bus Ãºnico de tools)
  // El connect es asÃ­ncrono y no bloquea el arranque del API. Si el mcp-server
  // tarda en levantar, el cliente reporta el error en el log y la API queda
  // operativa (pero sin tools MCP hasta que reconecte).
  mcpClient.connect()
    .then((result) => {
      if (result.connected) {
        console.log(`  MCP conectado â€” ${result.tools_count} tools disponibles (${result.url})\n`);
      } else {
        console.warn(`  MCP NO conectado: ${result.error || result.reason}\n`);
      }
    })
    .catch((err) => {
      console.warn(`  MCP error en arranque: ${err.message}\n`);
    });

  // Pre-warm Qwen para que la primera consulta del usuario no pague cold-load.
  // Solo si AGENT_PREWARM no estÃ¡ explÃ­citamente "false". No bloquea el boot.
  if ((process.env.AGENT_PREWARM || 'true').toLowerCase() !== 'false') {
    qwenProvider.prewarm()
      .then((r) => {
        if (r.ok) console.log(`  Qwen pre-cargado (${r.model}) en ${r.latency_ms}ms\n`);
        else console.warn(`  Qwen pre-warm fallÃ³: ${r.error}\n`);
      })
      .catch((err) => console.warn(`  Qwen pre-warm error: ${err.message}\n`));
  }
});
