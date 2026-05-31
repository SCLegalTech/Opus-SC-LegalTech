/**
 * salaCase.controller.js — endpoint de la Sala AI-native.
 */

const sala = require('../services/salaCase.service');

async function getSala(req, res) {
  const caseId = Number.parseInt(req.params.id || req.params.caseId, 10);
  if (!Number.isFinite(caseId)) return res.status(400).json({ error: 'caseId inválido' });

  try {
    const data = await sala.getSala(caseId);
    if (!data) return res.status(404).json({ error: 'Caso no encontrado' });
    return res.json(data);
  } catch (err) {
    console.error('[sala] getSala error:', err);
    return res.status(500).json({ error: 'Error generando la Sala' });
  }
}

module.exports = { getSala };
