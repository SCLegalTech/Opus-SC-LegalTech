const {
  JudicialConnectorNotConfiguredError,
  JUDICIAL_CONNECTOR_CONTRACT_VERSION,
} = require('./judicialConnector.interface');

const notIncluded = () => {
  throw new JudicialConnectorNotConfiguredError(
    'Los adapters mantenidos de case tracking no estan incluidos en este stub self-hosted. Implementa tu propio adaptador de solo lectura o usa SC LegalTech hosted.'
  );
};

function listPlatforms() {
  return {
    contract_version: JUDICIAL_CONNECTOR_CONTRACT_VERSION,
    mode: 'self_hosted_stub',
    platforms: [],
    message: 'Case tracking judicial disponible como contrato/stub para adapters de solo lectura.',
  };
}

function getPlatform(key) {
  return {
    key,
    mode: 'self_hosted_stub',
    available: false,
    message: 'Adapter de case tracking no implementado en este release.',
  };
}

module.exports = {
  listPlatforms,
  getPlatform,
  lookupByRadicado: notIncluded,
  listCaseLinks: notIncluded,
  linkCase: notIncluded,
  syncLink: notIncluded,
};
