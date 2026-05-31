const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUUID = (str) => UUID_RE.test(String(str ?? ''));

// Resuelve un param id-o-uuid al ID entero interno.
// Devuelve el ID entero o null si no existe.
const resolveEntityId = async (db, table, idOrUuid) => {
  if (!idOrUuid) return null;
  const field = isUUID(idOrUuid) ? 'uuid' : 'id';
  const { rows } = await db.query(
    `SELECT id FROM ${table} WHERE ${field} = $1 LIMIT 1`,
    [idOrUuid]
  );
  return rows.length ? rows[0].id : null;
};

module.exports = { isUUID, resolveEntityId };
