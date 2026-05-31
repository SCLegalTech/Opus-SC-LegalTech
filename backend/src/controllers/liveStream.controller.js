/**
 * liveStream.controller.js â€” Canal SSE del Puente de Mando (F2)
 *
 * GET /api/agent/stream
 * Relaya eventos en vivo (mutaciones, presencia, aprobaciones, auto-archivo)
 * al navegador del abogado, filtrados por tenant. Es lo que hace que la
 * pantalla de Opus muestre actividad mientras el agente trabaja desde un
 * cliente MCP externo.
 *
 * Auth: protegido por `authenticate` + `requireInternal` (router.use en
 * agent.routes.js). El frontend se conecta con fetch + Authorization Bearer
 * (no EventSource, que no admite headers), reusando el patrÃ³n del chat.
 *
 * Nota de operaciÃ³n: la conexiÃ³n SSE es de larga duraciÃ³n. Si el JWT trae
 * org_id, el middleware de auth retiene un cliente PG (RLS) hasta que la
 * conexiÃ³n cierra â€” aceptable con la baja concurrencia de un despacho, pero
 * a vigilar si se masifica (TODO: liberar el cliente PG temprano ya que este
 * handler no consulta la base).
 */

const liveBus = require('../services/liveBus.service');

const HEARTBEAT_MS = 25000;

exports.streamLive = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // desactiva buffering en proxies
  res.flushHeaders();

  const sub = {
    orgId: req.organization_id != null ? req.organization_id : null,
    userId: req.user.id,
  };

  const send = (payload) => {
    // Si el socket ya se cerrÃ³, no escribir.
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Saludo inicial: el cliente confirma que el canal estÃ¡ vivo.
  send({ type: 'connected', ts: new Date().toISOString() });

  const unsubscribe = liveBus.subscribe(sub, send);

  // Heartbeat (comentario SSE) para sobrevivir a proxies que cierran idle.
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(': ping\n\n');
  }, HEARTBEAT_MS);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
};
