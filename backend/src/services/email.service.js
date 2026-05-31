// Email transaccional Â· Gmail SMTP (ADR-004 D3).
//
// Provider elegido para arrancar por costo cero (cuenta institucional).
// LÃ­mite: ~500 emails/dÃ­a/cuenta. Trigger de migraciÃ³n a Resend cuando se
// alcancen 100 emails/dÃ­a sostenidos durante 7 dÃ­as.
//
// ConfiguraciÃ³n esperada en .env:
//   SMTP_HOST                â€” default smtp.gmail.com
//   SMTP_PORT                â€” default 587 (STARTTLS)
//   SMTP_USER                â€” cuenta@sclegaltech.com (App Password de Gmail)
//   SMTP_PASS                â€” App Password de 16 chars (no la password normal)
//   SMTP_FROM                â€” "SC LegalTech <no-reply@example.com>"
//
// Para generar App Password: https://myaccount.google.com/apppasswords
// (requiere 2FA activado en la cuenta de Gmail).

const nodemailer = require('nodemailer');

const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const USER = process.env.SMTP_USER || '';
const PASS = process.env.SMTP_PASS || '';
const FROM = process.env.SMTP_FROM || (USER ? `SC LegalTech <${USER}>` : '');

let transporter = null;

function isConfigured() {
  return Boolean(USER && PASS);
}

function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: HOST,
      port: PORT,
      secure: PORT === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return transporter;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!isConfigured()) {
    console.warn('[email] SMTP no configurado â€” skipping send to', to);
    return { ok: false, skipped: true };
  }
  const tx = getTransporter();
  try {
    const info = await tx.sendMail({
      from: FROM,
      to,
      subject,
      html,
      text,
      replyTo: replyTo || FROM,
    });
    console.log(`[email] sent ${info.messageId} to ${to}`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[email] error sending to ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// â”€â”€ Plantillas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function welcomeEmail({ firmName, magicLinkUrl, licenseName }) {
  const subject = `Bienvenido a SC LegalTech Â· activa tu cuenta`;
  const text = [
    `Hola,`,
    ``,
    `Acabas de registrar ${firmName} en SC LegalTech con la licencia ${licenseName}.`,
    `Para activar tu cuenta y crear tu contraseÃ±a, abre este enlace:`,
    ``,
    magicLinkUrl,
    ``,
    `El enlace es vÃ¡lido por 24 horas. Si no fuiste tÃº, ignora este correo.`,
    ``,
    `â€” SC LegalTech`,
  ].join('\n');
  const html = `
    <div style="font-family: Optima, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h1 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 24px; margin-bottom: 16px;">
        Bienvenido a SC LegalTech
      </h1>
      <p style="line-height: 1.6;">
        Acabas de registrar <strong>${escapeHtml(firmName)}</strong> en SC LegalTech con la licencia <strong>${escapeHtml(licenseName)}</strong>.
      </p>
      <p style="line-height: 1.6;">
        Para activar tu cuenta y crear tu contraseÃ±a, da clic en el botÃ³n:
      </p>
      <p style="margin: 32px 0;">
        <a href="${magicLinkUrl}" style="display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 4px;">
          Activar cuenta
        </a>
      </p>
      <p style="font-size: 12px; color: #666; line-height: 1.6;">
        El enlace expira en 24 horas. Si no fuiste tÃº, puedes ignorar este correo.
      </p>
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #999;">
        SC LegalTech â€” Smart Crypto Legal SAS<br>
        BogotÃ¡ D.C., Colombia
      </p>
    </div>
  `;
  return { subject, text, html };
}

function otpEmail({ code, ttlMinutes = 10 }) {
  const subject = `Tu cÃ³digo de verificaciÃ³n Â· Opus`;
  const text = [
    `Tu cÃ³digo de verificaciÃ³n es: ${code}`,
    ``,
    `Vence en ${ttlMinutes} minutos. Es de un solo uso.`,
    `Si no lo solicitaste, ignora este correo.`,
    ``,
    `â€” SC LegalTech`,
  ].join('\n');
  const html = `
    <div style="font-family: Optima, system-ui, sans-serif; max-width: 460px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h1 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 22px; margin-bottom: 16px;">
        Tu cÃ³digo de verificaciÃ³n
      </h1>
      <p style="line-height: 1.6;">Ãšsalo para confirmar la operaciÃ³n en Opus:</p>
      <p style="margin: 28px 0; text-align: center;">
        <span style="display: inline-block; font-size: 30px; letter-spacing: 10px; font-weight: 700; padding: 14px 22px; background: #111; color: #fff; border-radius: 8px;">${escapeHtml(code)}</span>
      </p>
      <p style="font-size: 12px; color: #666; line-height: 1.6;">
        Vence en ${ttlMinutes} minutos y es de un solo uso. Si no lo solicitaste, ignora este correo.
      </p>
      <hr style="margin: 28px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #999;">SC LegalTech â€” Smart Crypto Legal SAS Â· BogotÃ¡ D.C.</p>
    </div>
  `;
  return { subject, text, html };
}

function passwordResetEmail({ resetUrl }) {
  const subject = `Restablece tu contraseÃ±a Â· Opus`;
  const text = [
    `Hola,`,
    ``,
    `Recibimos una solicitud para restablecer la contraseÃ±a de tu cuenta en Opus.`,
    `Abre este enlace para crear una nueva contraseÃ±a:`,
    ``,
    resetUrl,
    ``,
    `El enlace es vÃ¡lido por 1 hora y es de un solo uso.`,
    `Si no fuiste tÃº, ignora este correo: tu contraseÃ±a no cambiarÃ¡.`,
    ``,
    `â€” SC LegalTech`,
  ].join('\n');
  const html = `
    <div style="font-family: Optima, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; color: #1a1a1a;">
      <h1 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 24px; margin-bottom: 16px;">
        Restablece tu contraseÃ±a
      </h1>
      <p style="line-height: 1.6;">
        Recibimos una solicitud para restablecer la contraseÃ±a de tu cuenta en Opus.
      </p>
      <p style="line-height: 1.6;">Da clic en el botÃ³n para crear una nueva contraseÃ±a:</p>
      <p style="margin: 32px 0;">
        <a href="${resetUrl}" style="display: inline-block; padding: 12px 24px; background: #000; color: #fff; text-decoration: none; border-radius: 4px;">
          Crear nueva contraseÃ±a
        </a>
      </p>
      <p style="font-size: 12px; color: #666; line-height: 1.6;">
        El enlace expira en 1 hora y es de un solo uso. Si no solicitaste el cambio, ignora este correo: tu contraseÃ±a no se modificarÃ¡.
      </p>
      <hr style="margin: 32px 0; border: none; border-top: 1px solid #eee;">
      <p style="font-size: 11px; color: #999;">
        SC LegalTech â€” Smart Crypto Legal SAS<br>
        BogotÃ¡ D.C., Colombia
      </p>
    </div>
  `;
  return { subject, text, html };
}

// InvitaciÃ³n a la beta cerrada de Opus. Es el PRODUCTO (software), por eso el
// lockup correcto es "Opus Â· SC LegalTech" â€” nunca la firma jurÃ­dica. Plantilla
// table-based (bulletproof para Gmail/Outlook), paleta de marca negro/dorado,
// Times en titulares y Optima en cuerpo. Sin emojis (contexto institucional).
function invitationEmail({ firmName, planLabel, redeemUrl, expiresAt, inviterName }) {
  const GOLD = '#947F57';
  const subject = `InvitaciÃ³n a Opus Â· SC LegalTech`;
  const validez = expiresAt
    ? (() => {
        try {
          return new Intl.DateTimeFormat('es-CO', { dateStyle: 'long' }).format(new Date(expiresAt));
        } catch { return null; }
      })()
    : null;

  const text = [
    `Has sido invitado a Opus, la plataforma de gestiÃ³n jurÃ­dica de SC LegalTech.`,
    ``,
    firmName ? `Firma: ${firmName}` : null,
    planLabel ? `Plan asignado: ${planLabel}` : null,
    inviterName ? `InvitaciÃ³n enviada por: ${inviterName}` : null,
    ``,
    `Activa tu acceso desde este enlace:`,
    redeemUrl,
    ``,
    validez ? `La invitaciÃ³n es vÃ¡lida hasta el ${validez}.` : `La invitaciÃ³n tiene vigencia limitada.`,
    `Si no esperabas esta invitaciÃ³n, puedes ignorar este correo.`,
    ``,
    `Opus Â· SC LegalTech â€” Smart Crypto Legal SAS Â· BogotÃ¡ D.C., Colombia`,
  ].filter((l) => l !== null).join('\n');

  const html = `
  <!DOCTYPE html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0; padding:0; background:#000000;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#000000;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background:#ffffff; border-radius:8px; overflow:hidden;">

            <!-- Cabecera negra con lockup de producto -->
            <tr>
              <td style="background:#000000; padding:36px 40px 30px 40px;" align="left">
                <div style="font-family:'Times New Roman', Georgia, serif; font-size:30px; line-height:1; color:#ffffff; letter-spacing:0.5px;">
                  Opus
                </div>
                <div style="font-family:Optima, 'Segoe UI', system-ui, sans-serif; font-size:12px; letter-spacing:3px; text-transform:uppercase; color:${GOLD}; margin-top:8px;">
                  SC LegalTech
                </div>
              </td>
            </tr>

            <!-- Filete dorado -->
            <tr><td style="height:3px; background:${GOLD}; line-height:3px; font-size:0;">&nbsp;</td></tr>

            <!-- Cuerpo -->
            <tr>
              <td style="padding:40px 40px 8px 40px; font-family:Optima, 'Segoe UI', system-ui, sans-serif; color:#1a1a1a;">
                <h1 style="font-family:'Times New Roman', Georgia, serif; font-weight:400; font-size:24px; line-height:1.3; margin:0 0 20px 0; color:#000000;">
                  Tu acceso a Opus estÃ¡ listo
                </h1>
                <p style="font-size:15px; line-height:1.65; margin:0 0 16px 0;">
                  ${inviterName ? `${escapeHtml(inviterName)} te ha invitado` : 'Has sido invitado'} a <strong>Opus</strong>, la plataforma de gestiÃ³n jurÃ­dica con inteligencia artificial de SC LegalTech.
                </p>

                <!-- Detalle de la invitaciÃ³n -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0; border-collapse:collapse;">
                  ${firmName ? `<tr>
                    <td style="padding:10px 0; border-bottom:1px solid #eeeeee; font-size:13px; color:#777777; width:130px;">Firma</td>
                    <td style="padding:10px 0; border-bottom:1px solid #eeeeee; font-size:14px; color:#1a1a1a; font-weight:600;">${escapeHtml(firmName)}</td>
                  </tr>` : ''}
                  ${planLabel ? `<tr>
                    <td style="padding:10px 0; border-bottom:1px solid #eeeeee; font-size:13px; color:#777777;">Plan</td>
                    <td style="padding:10px 0; border-bottom:1px solid #eeeeee; font-size:14px; color:#1a1a1a; font-weight:600;">${escapeHtml(planLabel)}</td>
                  </tr>` : ''}
                  ${validez ? `<tr>
                    <td style="padding:10px 0; font-size:13px; color:#777777;">VÃ¡lida hasta</td>
                    <td style="padding:10px 0; font-size:14px; color:#1a1a1a; font-weight:600;">${escapeHtml(validez)}</td>
                  </tr>` : ''}
                </table>

                <!-- CTA -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px 0;">
                  <tr>
                    <td align="center" bgcolor="#000000" style="border-radius:4px;">
                      <a href="${redeemUrl}" target="_blank"
                         style="display:inline-block; padding:14px 34px; font-family:Optima, 'Segoe UI', system-ui, sans-serif; font-size:15px; font-weight:600; color:#ffffff; text-decoration:none; border-radius:4px; border:1px solid #000000;">
                        Activar mi acceso
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="font-size:12px; line-height:1.6; color:#888888; margin:0 0 6px 0;">
                  Si el botÃ³n no funciona, copia y pega este enlace en tu navegador:
                </p>
                <p style="font-size:12px; line-height:1.6; color:${GOLD}; word-break:break-all; margin:0 0 24px 0;">
                  ${escapeHtml(redeemUrl)}
                </p>

                <p style="font-size:12px; line-height:1.6; color:#999999; margin:0;">
                  Si no esperabas esta invitaciÃ³n, puedes ignorar este correo de forma segura.
                </p>
              </td>
            </tr>

            <!-- Pie -->
            <tr>
              <td style="padding:28px 40px 36px 40px; border-top:1px solid #eeeeee;">
                <p style="font-family:Optima, 'Segoe UI', system-ui, sans-serif; font-size:11px; line-height:1.7; color:#aaaaaa; margin:0;">
                  <strong style="color:#777777;">Opus Â· SC LegalTech</strong><br>
                  Smart Crypto Legal S.A.S Â· BogotÃ¡ D.C., Colombia<br>
                  Tratamiento de datos conforme a la Ley 1581 de 2012 (Habeas Data).
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `;
  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = {
  isConfigured,
  send,
  welcomeEmail,
  otpEmail,
  passwordResetEmail,
  invitationEmail,
};
