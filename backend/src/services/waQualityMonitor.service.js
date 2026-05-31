/**
 * waQualityMonitor.service.js
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Sincroniza periÃ³dicamente el quality_rating del nÃºmero WABA
 * desde Meta y lo guarda en wa_phone_numbers.
 *
 * Quality rating de Meta:
 *   GREEN   â†’ HEALTHY    â€” todo bien, no hay restricciones
 *   YELLOW  â†’ MEDIUM     â€” alerta, evitar mensajes irrelevantes
 *   RED     â†’ LOW        â€” riesgo de suspensiÃ³n, parar marketing
 *   UNKNOWN â†’ indefinido â€” nÃºmero nuevo o sin datos suficientes
 *
 * El loop corre cada QUALITY_SYNC_INTERVAL_MINUTES (default 240 = 4h).
 * Se desactiva si WhatsApp no estÃ¡ configurado.
 */

const db = require('../config/db');
const wa = require('./whatsapp.service');

const INTERVAL_MIN = parseInt(process.env.WHATSAPP_QUALITY_SYNC_INTERVAL_MINUTES || '240', 10);

let timer = null;

async function runOnce() {
  if (!wa.isConfigured()) return null;

  try {
    const status = await wa.getPhoneNumberStatus();
    const cfg = wa.getConfig();
    const quality = status?.quality_rating || null;
    const nameStatus = status?.name_status || null;
    const codeVerif  = status?.code_verification_status || null;

    // Cross-tenant: descubrimos a quÃ© org pertenece el nÃºmero WABA configurado
    // por env. En la edicion self-hosted normalmente devuelve org #1.
    // este cron deberÃ¡ iterar por todas las wa_phone_numbers activas y
    // ejecutar el body de abajo con el scope de organizacion correspondiente.
    const orgLookup = await db.query(
      `SELECT organization_id FROM wa_phone_numbers WHERE phone_number_id = $1 LIMIT 1`,
      [cfg.phoneNumberId]
    );
    const orgId = orgLookup.rows[0]?.organization_id || 1;

    await db.withTenantClient(orgId, async (scoped) => {
      await scoped.query(
        `UPDATE wa_phone_numbers
            SET quality_rating = COALESCE($1, quality_rating),
                display_name   = COALESCE(NULLIF($2, ''), display_name),
                updated_at     = NOW()
          WHERE phone_number_id = $3`,
        [quality, status?.verified_name || '', cfg.phoneNumberId]
      );

      // Audit â€” INSERT hereda organization_id del DEFAULT (RLS-aware).
      try {
        await scoped.query(
          `INSERT INTO agent_actions (action_type, params, result, status, reversible)
           VALUES ('whatsapp.quality_sync', $1::jsonb, $2::jsonb, 'executed', true)`,
          [JSON.stringify({ phone_number_id: cfg.phoneNumberId }),
           JSON.stringify({ quality_rating: quality, name_status: nameStatus, code_verification_status: codeVerif })]
        );
      } catch (_) {}
    });

    if (quality && quality !== 'GREEN') {
      console.warn(`[wa-quality] ${cfg.phoneNumberId} quality=${quality}. Revisar volumen y contenido de salientes.`);
    } else {
      console.log(`[wa-quality] sync OK (${quality || 'UNKNOWN'})`);
    }
    return { quality_rating: quality, name_status: nameStatus };
  } catch (err) {
    console.warn('[wa-quality] sync failed:', err.message);
    return null;
  }
}

function startLoop() {
  if (timer) return;
  // Primera ejecuciÃ³n a los 60s del boot (no al instante, para dar tiempo
  // a que el resto del backend levante)
  setTimeout(runOnce, 60_000);
  timer = setInterval(runOnce, INTERVAL_MIN * 60_000);
  console.log(`[wa-quality] loop iniciado (cada ${INTERVAL_MIN} min)`);
}

function stopLoop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { runOnce, startLoop, stopLoop };
