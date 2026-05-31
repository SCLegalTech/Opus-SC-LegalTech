const entityCatalog = require('../services/entityCatalog.service');
const entityRuntime = require('../services/entityRuntime.service');

function list(req, res) {
  res.json({ entities: entityCatalog.listEntities() });
}

function get(req, res) {
  const entity = entityCatalog.getEntity(req.params.key);
  if (!entity) return res.status(404).json({ error: 'Entidad no encontrada' });
  return res.json(entity);
}

function resolve(req, res) {
  const { instruction = '', limit } = req.body || {};
  return res.json(entityCatalog.resolveEntities({ instruction, limit }));
}

async function invoke(req, res) {
  try {
    const result = await entityRuntime.invokeEntity(
      { key: req.params.key, ...(req.body || {}) },
      { user: req.user }
    );
    return res.json(result);
  } catch (err) {
    console.error('[entities] invoke error:', err);
    return res.status(500).json({ error: err.message });
  }
}

async function signals(req, res) {
  try {
    const result = await entityRuntime.listSignals(req.query || {});
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function runMonitors(req, res) {
  try {
    const result = await entityRuntime.runEntityMonitors(req.body || {}, { user: req.user });
    return res.json(result);
  } catch (err) {
    console.error('[entities] monitor error:', err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = {
  list,
  get,
  resolve,
  invoke,
  signals,
  runMonitors,
};
