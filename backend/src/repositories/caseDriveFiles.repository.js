const db = require('../config/db');

const DRIVE_CATEGORIES = new Set([
  'sin_clasificar',
  'ingreso',
  'cliente',
  'actuacion',
  'prueba',
  'comunicacion',
  'borrador',
  'firmado',
]);

function normalizeCategory(category) {
  if (!category) return 'sin_clasificar';
  return DRIVE_CATEGORIES.has(category) ? category : 'sin_clasificar';
}

async function listByCase(caseId) {
  const { rows } = await db.query(
    `SELECT cdf.*, u.name AS created_by_name,
            c.drive_folder_id AS case_drive_folder_id,
            c.drive_folder_url AS case_drive_folder_url,
            c.case_number AS case_number
       FROM case_drive_files cdf
       LEFT JOIN cases c ON c.id = cdf.case_id
       LEFT JOIN users u ON cdf.created_by = u.id
      WHERE cdf.case_id = $1
      ORDER BY cdf.created_at DESC, cdf.id DESC`,
    [caseId]
  );

  const byDriveId = new Map(rows.map((row) => [row.drive_file_id, row]));

  return rows.map((row) => {
    const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const parents = Array.isArray(metadata.parents) ? metadata.parents : [];
    const linkedParent = parents.map((parentId) => byDriveId.get(parentId)).find(Boolean);
    const rootParent = parents.includes(row.case_drive_folder_id)
      ? {
          drive_file_id: row.case_drive_folder_id,
          name: `Expediente ${row.case_number || ''}`.trim(),
          web_view_link: row.case_drive_folder_url || null,
          mime_type: 'application/vnd.google-apps.folder',
        }
      : null;
    const parent = linkedParent || rootParent || null;

    return {
      ...row,
      parent_drive_file_id: parent?.drive_file_id || null,
      parent_folder_name: parent?.name || null,
      parent_folder_link: parent?.web_view_link || null,
      parent_folder_mime_type: parent?.mime_type || null,
    };
  });
}

async function findByCaseAndDriveFile(caseId, driveFileId) {
  const { rows } = await db.query(
    `SELECT *
       FROM case_drive_files
      WHERE case_id = $1
        AND drive_file_id = $2
      LIMIT 1`,
    [caseId, driveFileId]
  );
  return rows[0] || null;
}

async function upsertLink({
  caseId,
  userId,
  driveFileId,
  name,
  mimeType,
  webViewLink,
  size,
  modifiedTime,
  category,
  metadata,
}) {
  const normalizedCategory = normalizeCategory(category);
  const existing = await findByCaseAndDriveFile(caseId, driveFileId);

  if (existing) {
    const { rows } = await db.query(
      `UPDATE case_drive_files
          SET name = $3,
              mime_type = $4,
              web_view_link = $5,
              size = $6,
              modified_time = $7,
              category = $8,
              metadata = $9::jsonb
        WHERE case_id = $1
          AND drive_file_id = $2
      RETURNING *`,
      [
        caseId,
        driveFileId,
        name,
        mimeType || null,
        webViewLink || null,
        size || null,
        modifiedTime || null,
        normalizedCategory,
        JSON.stringify(metadata || {}),
      ]
    );
    return { file: rows[0], created: false };
  }

  const { rows } = await db.query(
    `INSERT INTO case_drive_files (
        case_id, drive_file_id, name, mime_type, web_view_link, size,
        modified_time, category, source, metadata, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'drive', $9::jsonb, $10)
      RETURNING *`,
    [
      caseId,
      driveFileId,
      name,
      mimeType || null,
      webViewLink || null,
      size || null,
      modifiedTime || null,
      normalizedCategory,
      JSON.stringify(metadata || {}),
      userId || null,
    ]
  );

  return { file: rows[0], created: true };
}

async function unlinkById(caseId, linkId) {
  const { rows } = await db.query(
    `DELETE FROM case_drive_files
      WHERE id = $1
        AND case_id = $2
      RETURNING *`,
    [linkId, caseId]
  );
  return rows[0] || null;
}

module.exports = {
  normalizeCategory,
  listByCase,
  upsertLink,
  unlinkById,
};
