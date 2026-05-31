const googleWorkspace = require('../modules/google-workspace/googleWorkspace.service');
const caseDriveFiles = require('../repositories/caseDriveFiles.repository');

function getGoogleErrorCode(err) {
  return err.response?.data?.error || err.errors?.[0]?.reason || err.code;
}

function handleDriveError(res, err, context) {
  const code = err.code;
  if (code === 'GOOGLE_NOT_CONNECTED' || code === 'GOOGLE_NOT_CONFIGURED') {
    return res.status(409).json({ error: err.message, code });
  }

  const googleCode = getGoogleErrorCode(err);
  if (googleCode === 'invalid_request' || googleCode === 'invalid_grant') {
    return res.status(409).json({
      error: 'Google rechazo la autorizacion actual. Reconecta la cuenta en Ajustes / Integraciones.',
      code: 'GOOGLE_RECONNECT_REQUIRED',
    });
  }

  if (err.response?.status === 403) {
    return res.status(409).json({
      error: 'La cuenta conectada no tiene permisos suficientes para leer Drive. Reconecta Google autorizando Drive.',
      code: 'DRIVE_SCOPE_REQUIRED',
    });
  }

  if (err.response?.status === 404) {
    return res.status(404).json({
      error: 'No se encontro el archivo en Google Drive con la cuenta conectada.',
      code: 'DRIVE_FILE_NOT_FOUND',
    });
  }

  console.error(`[case-drive] ${context} error:`, err);
  return res.status(500).json({ error: err.message || 'Error gestionando archivos Drive del caso' });
}

function parseCaseId(req) {
  const caseId = Number(req.params.caseId);
  return Number.isInteger(caseId) && caseId > 0 ? caseId : null;
}

async function listCaseDriveFiles(req, res) {
  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });

  try {
    const files = await caseDriveFiles.listByCase(caseId);
    return res.json({ files });
  } catch (err) {
    console.error('[case-drive] listCaseDriveFiles error:', err);
    return res.status(500).json({ error: 'Error obteniendo archivos Drive del caso' });
  }
}

async function linkCaseDriveFile(req, res) {
  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });

  const { drive_file_id: driveFileId, category, metadata } = req.body || {};
  if (!driveFileId) {
    return res.status(400).json({ error: 'drive_file_id es requerido' });
  }

  try {
    const driveFile = await googleWorkspace.getDriveFile({
      userId: req.user.id,
      fileId: driveFileId,
    });

    const link = await caseDriveFiles.upsertLink({
      caseId,
      userId: req.user.id,
      driveFileId: driveFile.id,
      name: driveFile.name,
      mimeType: driveFile.mimeType,
      webViewLink: driveFile.webViewLink,
      size: driveFile.size || null,
      modifiedTime: driveFile.modifiedTime || null,
      category,
      metadata: {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        source: 'drive',
        drive_file_id: driveFile.id,
        parents: driveFile.parents || [],
        created_time: driveFile.createdTime || null,
        description: driveFile.description || null,
      },
    });

    return res.status(link.created ? 201 : 200).json(link);
  } catch (err) {
    if (err.code === '23503') {
      return res.status(404).json({ error: 'Caso no encontrado' });
    }
    return handleDriveError(res, err, 'linkCaseDriveFile');
  }
}

async function unlinkCaseDriveFile(req, res) {
  const caseId = parseCaseId(req);
  const linkId = Number(req.params.linkId);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
  if (!Number.isInteger(linkId) || linkId <= 0) {
    return res.status(400).json({ error: 'linkId invalido' });
  }

  try {
    const file = await caseDriveFiles.unlinkById(caseId, linkId);
    if (!file) return res.status(404).json({ error: 'Archivo Drive no vinculado al caso' });

    return res.json({
      message: 'Archivo desvinculado del expediente. El archivo real en Google Drive no fue modificado.',
      file,
    });
  } catch (err) {
    console.error('[case-drive] unlinkCaseDriveFile error:', err);
    return res.status(500).json({ error: 'Error desvinculando archivo Drive del caso' });
  }
}

async function searchDriveForClient(req, res) {
  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
  const { q, max_per_term } = req.query;

  try {
    const result = await googleWorkspace.searchDriveForCase({
      userId: req.user.id,
      caseId,
      extraQuery: q,
      maxPerTerm: Math.min(Number(max_per_term) || 10, 25),
    });
    return res.json(result);
  } catch (err) {
    if (err.code === 'CASE_NOT_FOUND') return res.status(404).json({ error: err.message });
    return handleDriveError(res, err, 'searchDriveForClient');
  }
}

async function linkExpedienteFolder(req, res) {
  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
  const { folder_id: folderId } = req.body || {};
  if (!folderId) return res.status(400).json({ error: 'folder_id es requerido' });

  try {
    const result = await googleWorkspace.linkDriveFolderToCase({
      userId: req.user.id,
      caseId,
      folderId,
    });
    return res.json(result);
  } catch (err) {
    if (err.code === 'CASE_NOT_FOUND')   return res.status(404).json({ error: err.message });
    if (err.code === 'DRIVE_NOT_A_FOLDER') return res.status(400).json({ error: err.message, code: err.code });
    return handleDriveError(res, err, 'linkExpedienteFolder');
  }
}

async function organizeExpediente(req, res) {
  const caseId = parseCaseId(req);
  if (!caseId) return res.status(400).json({ error: 'caseId invalido' });
  const { parent_folder_id, files, dry_run } = req.body || {};

  try {
    const plan = await googleWorkspace.organizeExpediente({
      userId: req.user.id,
      caseId,
      parentFolderId: parent_folder_id,
      files: Array.isArray(files) ? files : [],
      dryRun: Boolean(dry_run),
    });
    return res.json(plan);
  } catch (err) {
    if (err.code === 'CASE_NOT_FOUND') return res.status(404).json({ error: err.message });
    return handleDriveError(res, err, 'organizeExpediente');
  }
}

module.exports = {
  listCaseDriveFiles,
  linkCaseDriveFile,
  unlinkCaseDriveFile,
  searchDriveForClient,
  linkExpedienteFolder,
  organizeExpediente,
};
