/**
 * responseWrapper.js
 * Φ SC LegalTech · Opus
 *
 * Envuelve todas las respuestas JSON en el contrato canónico:
 *   Éxito  → { success: true,  data:  <payload> }
 *   Error  → { success: false, error: <mensaje>  }
 *
 * Se aplica SÓLO a las rutas /api/v1/* para no romper
 * la compatibilidad con el frontend existente (/api/*).
 *
 * Uso en server.js:
 *   const v1 = express.Router();
 *   v1.use(responseWrapper);
 *   v1.use('/cases', casesRoutes);
 *   app.use('/api/v1', v1);
 */

const responseWrapper = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    // Si ya lleva la clave `success` respetamos la forma (evita doble envoltura)
    if (body !== null && typeof body === 'object' && 'success' in body) {
      return originalJson(body);
    }

    if (res.statusCode >= 400) {
      // Respuesta de error: extraemos el mensaje del campo más probable
      const message =
        (body && (body.error || body.message)) ||
        'Error interno del servidor';
      return originalJson({ success: false, error: message });
    }

    // Respuesta exitosa
    return originalJson({ success: true, data: body });
  };

  next();
};

module.exports = responseWrapper;
