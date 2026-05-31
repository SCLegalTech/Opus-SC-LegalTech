const express = require('express');
const nodemailer = require('nodemailer');

const router = express.Router();

const RECIPIENT = process.env.LEGAL_NOTIFICATIONS_EMAIL || 'legal@example.com';
const GENERAL_EMAIL = process.env.LEGAL_CONTACT_EMAIL || 'contact@example.com';

function required(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clean(value, max = 4000) {
  return String(value || '').trim().slice(0, max);
}

function getTransporter() {
  const host = process.env.LEGAL_SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.LEGAL_SMTP_PORT || process.env.SMTP_PORT || 587);
  const user = process.env.LEGAL_SMTP_USER || process.env.SMTP_USER;
  const pass = process.env.LEGAL_SMTP_PASS || process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: String(process.env.LEGAL_SMTP_SECURE || process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: { user, pass },
  });
}

function buildEmail({ requestId, type, payload }) {
  const label = type === 'habeas-data' ? 'Solicitud de Habeas Data' : 'Solicitud PQRS';
  const lines = [
    label,
    `Radicado: ${requestId}`,
    `Fecha: ${new Date().toISOString()}`,
    '',
    `Nombre: ${payload.full_name}`,
    `Identificacion: ${payload.id_number || 'No informada'}`,
    `Correo: ${payload.email}`,
    `Telefono: ${payload.phone || 'No informado'}`,
    `Tipo de solicitud: ${payload.request_type}`,
    `Asunto: ${payload.subject}`,
    '',
    'Descripcion:',
    payload.description,
    '',
    `Autorizacion de tratamiento: ${payload.data_authorization ? 'Si' : 'No'}`,
  ];

  return {
    subject: `[SC LegalTech] ${label} - ${requestId}`,
    text: lines.join('\n'),
  };
}

router.post('/', async (req, res) => {
  const type = clean(req.body?.type, 40);
  const payload = {
    full_name: clean(req.body?.full_name, 180),
    id_number: clean(req.body?.id_number, 80),
    email: clean(req.body?.email, 180),
    phone: clean(req.body?.phone, 80),
    request_type: clean(req.body?.request_type, 120),
    subject: clean(req.body?.subject, 180),
    description: clean(req.body?.description, 6000),
    data_authorization: Boolean(req.body?.data_authorization),
  };

  if (!['pqrs', 'habeas-data'].includes(type)) {
    return res.status(400).json({ error: 'Tipo de solicitud invalido.' });
  }

  const missing = ['full_name', 'email', 'request_type', 'subject', 'description']
    .filter((field) => !required(payload[field]));
  if (missing.length || !payload.data_authorization) {
    return res.status(400).json({
      error: 'Faltan campos obligatorios o autorizacion de tratamiento de datos.',
      missing,
    });
  }

  const transporter = getTransporter();
  if (!transporter) {
    return res.status(503).json({
      error: 'El canal SMTP de notificaciones judiciales no esta configurado.',
      recipient: RECIPIENT,
    });
  }

  const requestId = `${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const email = buildEmail({ requestId, type, payload });

  try {
    await transporter.sendMail({
      from: process.env.LEGAL_SMTP_FROM || process.env.SMTP_FROM || GENERAL_EMAIL,
      to: RECIPIENT,
      replyTo: payload.email,
      subject: email.subject,
      text: email.text,
    });

    res.status(202).json({
      ok: true,
      request_id: requestId,
      recipient: RECIPIENT,
    });
  } catch (err) {
    res.status(502).json({
      error: 'No fue posible enviar la solicitud al correo de notificaciones judiciales.',
      detail: err.message,
      recipient: RECIPIENT,
    });
  }
});

module.exports = router;
