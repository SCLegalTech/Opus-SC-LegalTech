/**
 * documents.routes.js
 * ─────────────────────────────────────────────────────────────
 * Tres puntos de montaje:
 *   templatesRouter → /api/v1/templates
 *   caseDocumentsRouter → /api/v1/cases/:caseId/documents (mergeParams)
 *   documentsRouter → /api/v1/documents/:id
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  listTemplates,
  getTemplate,
  draftDocument,
  listCaseDocuments,
  getDocument,
  updateDocument,
  exportDocumentToDrive,
  markDocumentSigned,
} = require('../controllers/documents.controller');

// ── Plantillas ────────────────────────────────────────────────
const templatesRouter = express.Router();
templatesRouter.use(authenticate);
templatesRouter.get('/',       listTemplates);
templatesRouter.get('/:code',  getTemplate);

// ── Documentos por caso ───────────────────────────────────────
// Montado bajo /cases/:caseId/documents; la autorización de caso
// viene del router padre cases.routes.js vía authorizeCase.
const caseDocumentsRouter = express.Router({ mergeParams: true });
caseDocumentsRouter.get ('/',        listCaseDocuments);
caseDocumentsRouter.post('/draft',   draftDocument);

// ── Documento individual ──────────────────────────────────────
const documentsRouter = express.Router();
documentsRouter.use(authenticate);
documentsRouter.get  ('/:id', getDocument);
documentsRouter.patch('/:id', updateDocument);
documentsRouter.post ('/:id/export-to-drive', exportDocumentToDrive);
documentsRouter.post ('/:id/mark-signed',     markDocumentSigned);

module.exports = { templatesRouter, caseDocumentsRouter, documentsRouter };
