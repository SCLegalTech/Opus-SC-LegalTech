// Organization context endpoints for the self-hosted edition.
// The public build keeps organization_id as a local scoping primitive.

const db = require('../config/db');

const TABLE_NOT_FOUND = '42P01';

const listMine = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT o.id, o.slug, o.legal_name, o.brand_name, o.jurisdiction,
              uo.role AS my_role, uo.joined_at
       FROM user_organizations uo
       JOIN organizations o ON o.id = uo.organization_id
       WHERE uo.user_id = $1 AND o.active = TRUE
       ORDER BY uo.joined_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    if (err.code === TABLE_NOT_FOUND) return res.json([]);
    console.error('[orgs] list_mine error:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

const getCurrent = async (req, res) => {
  if (!req.user?.org_id) {
    return res.status(404).json({ error: 'No hay organizacion activa en la sesion' });
  }
  try {
    const { rows } = await db.query(
      `SELECT id, slug, legal_name, brand_name, jurisdiction,
              tax_id, tax_regime, created_at
       FROM organizations
       WHERE id = $1 AND active = TRUE`,
      [req.user.org_id]
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Organizacion no encontrada' });
    }
    res.json({ ...rows[0], my_role: req.user.org_role });
  } catch (err) {
    if (err.code === TABLE_NOT_FOUND) {
      return res.status(409).json({ error: 'Contexto de organizacion no inicializado' });
    }
    console.error('[orgs] get_current error:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
};

module.exports = { listMine, getCurrent };
