const router = require('express').Router({ mergeParams: true });
const {
  listCaseDriveFiles,
  linkCaseDriveFile,
  unlinkCaseDriveFile,
  searchDriveForClient,
  linkExpedienteFolder,
  organizeExpediente,
} = require('../controllers/caseDrive.controller');

// CRUD de vínculos caso ↔ archivo Drive.
router.get   ('/files',           listCaseDriveFiles);
router.post  ('/link',            linkCaseDriveFile);
router.delete('/files/:linkId',   unlinkCaseDriveFile);

// Operaciones agénticas sobre Drive.
router.get   ('/search-for-client',      searchDriveForClient);
router.post  ('/expediente/link-folder', linkExpedienteFolder);
router.post  ('/expediente/organize',    organizeExpediente);

module.exports = router;
