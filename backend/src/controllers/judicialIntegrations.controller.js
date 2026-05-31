const code = 'JUDICIAL_CASE_TRACKING_STUB';

const platforms = [
  {
    key: 'cpnu',
    name: 'Consulta de Procesos Nacional Unificada',
    category: 'public_case_tracking',
    access: 'public_read_only',
    capabilities: ['lookup_status', 'normalize_timeline', 'link_to_case'],
    status: 'stub',
  },
  {
    key: 'tyba',
    name: 'Justicia XXI / TYBA',
    category: 'public_case_tracking',
    access: 'operator_defined',
    capabilities: ['lookup_status', 'normalize_timeline'],
    status: 'stub',
  },
  {
    key: 'samai_public',
    name: 'SAMAI public tracking',
    category: 'public_case_tracking',
    access: 'operator_defined',
    capabilities: ['lookup_status', 'normalize_timeline'],
    status: 'stub',
  },
];

function stubPayload(extra = {}) {
  return {
    code,
    mode: 'self_hosted_stub',
    message: 'This release exposes public case-tracking contracts and stubs only.',
    boundary: 'Court filing, delegated credential use, browser automation, and legal-act submission are not included.',
    ...extra,
  };
}

function listPlatforms(req, res) {
  return res.json(stubPayload({ platforms }));
}

function getPlatform(req, res) {
  const platform = platforms.find((item) => item.key === req.params.key);
  if (!platform) {
    return res.status(404).json(stubPayload({ platform: null, key: req.params.key }));
  }
  return res.json(stubPayload({ platform }));
}

function listCaseLinks(req, res) {
  return res.json(stubPayload({ links: [] }));
}

function lookup(req, res) {
  return res.status(501).json(stubPayload({
    error: 'Case-tracking adapter not implemented in this self-hosted stub.',
  }));
}

module.exports = {
  listPlatforms,
  getPlatform,
  listCaseLinks,
  lookup,
};
