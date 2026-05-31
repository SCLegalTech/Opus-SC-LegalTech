/**
 * Contrato publico para adaptadores judiciales de case tracking.
 *
 * El repo fair-code/self-hosted publica esta interfaz para que un operador
 * implemente sus propios conectores. Las implementaciones reales mantenidas
 * por SC LegalTech no forman parte del release publico.
 */

const JUDICIAL_CONNECTOR_CONTRACT_VERSION = '2026-05-29';

const REQUIRED_METHODS = Object.freeze([
  'listPlatforms',
  'getPlatform',
  'lookupByRadicado',
  'listCaseLinks',
  'linkCase',
  'syncLink',
]);

class JudicialConnectorNotConfiguredError extends Error {
  constructor(message = 'Conector judicial de case tracking no configurado en self-hosted.') {
    super(message);
    this.name = 'JudicialConnectorNotConfiguredError';
    this.code = 'JUDICIAL_CONNECTOR_NOT_CONFIGURED';
    this.status = 501;
  }
}

function assertJudicialConnector(connector) {
  const missing = REQUIRED_METHODS.filter((name) => typeof connector?.[name] !== 'function');
  if (missing.length) {
    throw new Error(`Adaptador judicial incompleto. Metodos faltantes: ${missing.join(', ')}`);
  }
  return connector;
}

module.exports = {
  JUDICIAL_CONNECTOR_CONTRACT_VERSION,
  REQUIRED_METHODS,
  JudicialConnectorNotConfiguredError,
  assertJudicialConnector,
};
