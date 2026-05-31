-- ============================================================
-- Opus SC LegalTech - public self-hosted demo data.
-- ============================================================
-- Todos los nombres, correos, documentos, telefonos y radicados son
-- sinteticos. No usar datos reales en el seed publico.

-- USUARIOS
-- admin.demo@example.com / demo-admin-password
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Administrador Demo', 'admin.demo@example.com',
   '$2a$10$.wqHEpDVSsXK3zSY6cxL0OScd8jeP4b59WheNH81kT94Hp4gDo0a2', 'admin')
ON CONFLICT (email) DO NOTHING;

-- abogado.demo@example.com / demo-lawyer-password
INSERT INTO users (name, email, password_hash, role) VALUES
  ('Abogado Demo', 'abogado.demo@example.com',
   '$2a$10$TyEwWAeo6Uc3WfuNV4aVKugIRdAQEgcaAptyX3gFPqN3CKqQa821C', 'lawyer')
ON CONFLICT (email) DO NOTHING;

-- CLIENTES
INSERT INTO clients (full_name, document_type, document_number, email, phone, city, source) VALUES
  ('Cliente Demo Uno',    'CC',  '100000001',   'cliente.uno@example.com', '3000000001', 'Bogota D.C.', 'REFERIDO'),
  ('Cliente Demo Dos',    'CC',  '100000002',   'cliente.dos@example.com', '3000000002', 'Medellin',    'WHATSAPP'),
  ('Empresa Demo S.A.S.', 'NIT', '900000000-1', 'legal@example.com',       '6010000000', 'Bogota D.C.', 'EMAIL'),
  ('Cliente Demo Tres',   'CC',  '100000003',   NULL,                      '3000000003', 'Bogota D.C.', 'PRESENCIAL'),
  ('Cliente Demo Cuatro', 'CC',  '100000004',   NULL,                      '3000000004', 'Bogota D.C.', 'PRESENCIAL')
ON CONFLICT DO NOTHING;

-- CASOS
INSERT INTO cases (
  case_number, client_id, service_type, title, entity, status,
  assigned_to, created_by,
  intake_channel, jurisdiction,
  filing_date, response_deadline,
  next_action, next_action_date
)
SELECT
  'SC-2026-0001',
  cl.id, 'TUTELA',
  'Tutela demo por autorizacion de servicio de salud',
  'EPS Demo', 'EN_PROCESO',
  u.id, u.id,
  'REFERIDO', 'CO',
  '2026-04-01', '2026-04-21',
  'Verificar respuesta del despacho / notificacion de admision', '2026-04-18'
FROM clients cl, users u
WHERE cl.document_number = '100000001' AND u.email = 'admin.demo@example.com'
ON CONFLICT (case_number) DO NOTHING;

INSERT INTO cases (
  case_number, client_id, service_type, title, entity, status,
  assigned_to, created_by,
  intake_channel, jurisdiction,
  next_action
)
SELECT
  'SC-2026-0002',
  cl.id, 'PQRS',
  'PQRS demo por facturacion incorrecta de servicio publico',
  'Entidad de Servicios Demo', 'NUEVO',
  u.id, u.id,
  'WHATSAPP', 'CO',
  'Redactar y radicar derecho de peticion'
FROM clients cl, users u
WHERE cl.document_number = '100000002' AND u.email = 'abogado.demo@example.com'
ON CONFLICT (case_number) DO NOTHING;

INSERT INTO cases (
  case_number, client_id, service_type, title, entity, status,
  assigned_to, created_by,
  intake_channel, jurisdiction,
  filing_date, response_deadline,
  next_action, next_action_date
)
SELECT
  'SC-2026-0003',
  cl.id, 'TUTELA',
  'Tutela demo por debido proceso en tramite administrativo',
  'Entidad Administrativa Demo', 'EN_PROCESO',
  u.id, u.id,
  'PRESENCIAL', 'CO',
  '2026-04-14', '2026-04-24',
  'Esperar respuesta de la entidad - seguimiento en 3 dias', '2026-04-17'
FROM clients cl, users u
WHERE cl.document_number = '100000003' AND u.email = 'admin.demo@example.com'
ON CONFLICT (case_number) DO NOTHING;

-- PARTES
INSERT INTO partes (case_id, role, name, notes)
SELECT c.id, 'accionado', 'Entidad Administrativa Demo',
  'Direccion legal sintetica para datos de prueba'
FROM cases c WHERE c.case_number = 'SC-2026-0003'
ON CONFLICT DO NOTHING;

INSERT INTO partes (case_id, role, name, notes)
SELECT c.id, 'coaccionante', 'Cliente Demo Cuatro',
  'CC 100000004 - accionante solidario demo'
FROM cases c WHERE c.case_number = 'SC-2026-0003'
ON CONFLICT DO NOTHING;

-- COMUNICACIONES
INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'system', 'Caso demo creado. Tipo: TUTELA', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'call',
  'Llamada con cliente. Confirma negativa de autorizacion medica. Se procede con tutela demo urgente.',
  u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'note',
  'Tutela radicada ante despacho demo. Radicado sintetico: 11000000000020260000000.',
  u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'system', 'Caso demo creado. Tipo: PQRS', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0002' AND u.email = 'abogado.demo@example.com';

INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'system', 'Caso demo creado. Tipo: TUTELA', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

INSERT INTO communications (case_id, type, content, created_by)
SELECT c.id, 'note',
  'Tutela radicada por canal demo. PDF adjunto. Pendiente confirmacion de recibido.',
  u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

-- ACTUACIONES
INSERT INTO actuaciones (case_id, type, title, description, scheduled_at, completed_at, radicado, created_by)
SELECT
  c.id, 'RADICACION',
  'Radicacion tutela ante despacho demo',
  'Tutela demo radicada. Derecho fundamental a la salud. Accionada: EPS Demo.',
  '2026-04-01', '2026-04-01 14:30:00',
  '11000000000020260000000',
  u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO actuaciones (case_id, type, title, scheduled_at, created_by)
SELECT c.id, 'NOTIFICACION', 'Esperar notificacion de admision / auto inadmisorio',
  '2026-04-18', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO actuaciones (case_id, type, title, description, scheduled_at, completed_at, created_by)
SELECT
  c.id, 'RADICACION',
  'Radicacion tutela por canal demo',
  'Envio demo con PDF adjunto.',
  '2026-04-14', '2026-04-14 16:00:00',
  u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

INSERT INTO actuaciones (case_id, type, title, scheduled_at, created_by)
SELECT c.id, 'RESPUESTA_ENTIDAD',
  'Respuesta entidad demo (plazo 48h habiles desde admision)',
  '2026-04-17', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

-- TAREAS
INSERT INTO tareas (case_id, title, priority, status, due_date, assigned_to, created_by)
SELECT c.id,
  'Confirmar recibido de radicacion demo',
  'ALTA', 'PENDIENTE', '2026-04-17',
  u.id, u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

INSERT INTO tareas (case_id, title, priority, status, due_date, assigned_to, created_by)
SELECT c.id,
  'Redactar derecho de peticion demo',
  'MEDIA', 'PENDIENTE', '2026-04-19',
  u.id, u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0002' AND u.email = 'abogado.demo@example.com';

INSERT INTO tareas (case_id, title, priority, status, due_date, assigned_to, created_by)
SELECT c.id,
  'Verificar notificacion de admision - Tutela EPS Demo',
  'ALTA', 'PENDIENTE', '2026-04-18',
  u.id, u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

-- VENCIMIENTOS
INSERT INTO vencimientos (case_id, title, due_date, urgency, created_by)
SELECT c.id,
  'Fecha limite legal - Tutela EPS Demo (10 dias habiles)',
  '2026-04-21', 'ALTO', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0001' AND u.email = 'admin.demo@example.com';

INSERT INTO vencimientos (case_id, title, due_date, urgency, created_by)
SELECT c.id,
  'Respuesta entidad demo - plazo constitucional (48h habiles)',
  '2026-04-17', 'CRITICO', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

INSERT INTO vencimientos (case_id, title, due_date, urgency, created_by)
SELECT c.id,
  'Fecha limite legal - Tutela demo administrativa (10 dias habiles)',
  '2026-04-24', 'ALTO', u.id
FROM cases c, users u
WHERE c.case_number = 'SC-2026-0003' AND u.email = 'admin.demo@example.com';

SELECT 'Opus - Datos iniciales demo cargados.' AS mensaje;
