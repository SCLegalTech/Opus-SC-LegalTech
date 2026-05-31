// Onboarding controller — wizard "Integra".
//
// Persiste el perfil de la organización y las integraciones elegidas durante
// el onboarding inicial. Solo el owner/admin de la org puede guardarlo.

const db = require('../config/db');

const VALID_PRACTICE_AREAS = [
  'penal', 'civil', 'laboral', 'familia', 'comercial', 'administrativo',
  'tributario', 'constitucional', 'corporativo', 'propiedad_intelectual',
  'migratorio', 'ambiental', 'otro',
];
const VALID_SIZES = ['solo', '2-5', '6-15', '16-50', '50+'];
const VALID_INTEGRATIONS = [
  'gmail', 'outlook', 'calendar', 'drive', 'onedrive', 'whatsapp', 'pdfword', 'folder',
];

function extractOrgId(req) {
  return req.user?.org_id || req.user?.organization_id || req.organization_id || null;
}

// GET /api/onboarding/state — perfil actual + si está completo.
const getState = async (req, res) => {
  const orgId = extractOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Sin organización asignada' });
  try {
    const { rows } = await db.query(
      `SELECT org_profile, onboarding_completed_at, brand_name, legal_name, logo_url
         FROM organizations WHERE id = $1`,
      [orgId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({
      organization_id: orgId,
      brand_name: rows[0].brand_name,
      legal_name: rows[0].legal_name,
      logo_url: rows[0].logo_url,
      profile: rows[0].org_profile || {},
      completed: !!rows[0].onboarding_completed_at,
      completed_at: rows[0].onboarding_completed_at,
    });
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      return res.json({ organization_id: orgId, profile: {}, completed: false, _note: 'migración v32→v33 pendiente' });
    }
    console.error('[onboarding:getState]', err.message);
    res.status(500).json({ error: 'Error consultando onboarding' });
  }
};

// POST /api/onboarding/save — guarda el perfil. Acepta guardado parcial
// (cada paso del wizard) y un flag `complete` para cerrar.
const save = async (req, res) => {
  const orgId = extractOrgId(req);
  if (!orgId) return res.status(401).json({ error: 'Sin organización asignada' });

  // Solo owner/admin de la org pueden configurarla.
  const orgRole = String(req.user?.org_role || '').toLowerCase();
  if (orgRole && !['owner', 'admin'].includes(orgRole)) {
    return res.status(403).json({ error: 'Solo el responsable de la firma puede configurar la organización' });
  }

  // Sanitizar el perfil entrante — whitelist de campos conocidos.
  const body = req.body || {};
  const profile = {};
  if (body.practice_areas) {
    profile.practice_areas = (Array.isArray(body.practice_areas) ? body.practice_areas : [])
      .filter((a) => VALID_PRACTICE_AREAS.includes(a)).slice(0, 13);
  }
  if (body.size && VALID_SIZES.includes(body.size)) profile.size = body.size;
  if (body.jurisdictions) {
    profile.jurisdictions = (Array.isArray(body.jurisdictions) ? body.jurisdictions : [])
      .map((j) => String(j).slice(0, 40)).slice(0, 20);
  }
  if (body.integrations) {
    profile.integrations = (Array.isArray(body.integrations) ? body.integrations : [])
      .filter((i) => VALID_INTEGRATIONS.includes(i));
  }
  if (typeof body.team_goal === 'string') profile.team_goal = body.team_goal.slice(0, 200);
  if (typeof body.monthly_cases === 'string') profile.monthly_cases = body.monthly_cases.slice(0, 20);

  if (typeof body.context_note === 'string') profile.context_note = body.context_note.slice(0, 1000);

  const complete = body.complete === true;

  // Logo opcional — data URL pequeño (la columna logo_url). Límite ~300KB
  // para no inflar la fila; en prod se migra a objeto externo.
  let logoUrl;
  if (typeof body.logo_data_url === 'string' && body.logo_data_url.startsWith('data:image/')) {
    if (body.logo_data_url.length > 400_000) {
      return res.status(413).json({ error: 'El logo es muy grande (máximo ~300KB)' });
    }
    logoUrl = body.logo_data_url;
  } else if (body.logo_data_url === null) {
    logoUrl = null; // permitir borrar
  }

  // Nombre comercial editable desde el setup. Solo se actualiza si llega no
  // vacío (la columna es NOT NULL).
  const brandName = typeof body.brand_name === 'string' ? body.brand_name.trim().slice(0, 255) : '';
  const updateBrand = brandName.length > 0;

  try {
    // Merge con el perfil existente para soportar guardado por pasos.
    const { rows } = await db.query(
      `UPDATE organizations
          SET org_profile = COALESCE(org_profile, '{}'::jsonb) || $1::jsonb,
              logo_url = CASE WHEN $4::boolean THEN $5 ELSE logo_url END,
              brand_name = CASE WHEN $6::boolean THEN $7 ELSE brand_name END,
              onboarding_completed_at = CASE WHEN $2::boolean THEN NOW() ELSE onboarding_completed_at END,
              updated_at = NOW()
        WHERE id = $3
        RETURNING org_profile, logo_url, brand_name, onboarding_completed_at`,
      [JSON.stringify(profile), complete, orgId, logoUrl !== undefined, logoUrl ?? null, updateBrand, brandName]
    );
    if (!rows.length) return res.status(404).json({ error: 'Organización no encontrada' });
    res.json({
      success: true,
      profile: rows[0].org_profile,
      logo_url: rows[0].logo_url,
      completed: !!rows[0].onboarding_completed_at,
    });
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      return res.status(503).json({ error: 'Migración v32→v33 pendiente' });
    }
    console.error('[onboarding:save]', err.message);
    res.status(500).json({ error: 'Error guardando onboarding' });
  }
};

module.exports = { getState, save };
