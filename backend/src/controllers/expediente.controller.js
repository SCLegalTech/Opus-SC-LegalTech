/**
 * expediente.controller.js — endpoint del Expediente Vivo.
 */

const expediente = require('../services/expediente.service');

async function getExpediente(req, res) {
  const caseId = Number.parseInt(req.params.id || req.params.caseId, 10);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });

  try {
    const data = await expediente.getExpediente(caseId);
    if (!data) return res.status(404).json({ error: 'Caso no encontrado' });
    return res.json(data);
  } catch (err) {
    console.error('[expediente] error:', err);
    return res.status(500).json({ error: 'Error generando expediente vivo' });
  }
}

module.exports = { getExpediente };
