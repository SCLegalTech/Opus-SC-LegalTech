const status = 501;
const code = 'JUDICIAL_CASE_TRACKING_STUB';

function payload(extra = {}) {
  return {
    error: 'CPNU case-tracking adapter is not implemented in this self-hosted stub.',
    code,
    mode: 'self_hosted_stub',
    boundary: 'Read-only case tracking only. Filing, submission, and delegated credential flows are not included.',
    ...extra,
  };
}

function unavailable(req, res) {
  return res.status(status).json(payload());
}

function emptyLinks(req, res) {
  return res.json({
    links: [],
    ...payload({ error: undefined }),
  });
}

function emptyCaseLink(req, res) {
  return res.json({
    link: null,
    actuaciones: [],
    ...payload({ error: undefined }),
  });
}

module.exports = {
  lookup: unavailable,
  listLinks: emptyLinks,
  linkCase: unavailable,
  createCaseFromCpnu: unavailable,
  syncLink: unavailable,
  listActuaciones: emptyCaseLink,
  acknowledge: unavailable,
  getCaseLink: emptyCaseLink,
};
