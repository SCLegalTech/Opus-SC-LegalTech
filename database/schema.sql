-- Opus SC LegalTech public self-hosted database baseline.
-- Initial schema for a single self-hosted firm.
-- Internal migration history, SaaS billing, tenant operations and
-- payment-provider tables are intentionally excluded.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ============================================================
-- TIPOS ENUMERADOS
-- ============================================================

-- Public case categories.
DO $$ BEGIN
  CREATE TYPE service_type AS ENUM (
    'PQRS',
    'TUTELA',
    'CONTRATO',
    'LABORAL',
    'PENAL',
    'CIVIL',
    'ADMINISTRATIVO',
    'SOCIETARIO',
    'REGULATORIO',
    'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Estados del caso (ciclo de vida completo)
DO $$ BEGIN
  CREATE TYPE case_status AS ENUM (
    'NUEVO',
    'EN_PROCESO',
    'PENDIENTE_CLIENTE',
    'PENDIENTE_ENTIDAD',
    'CERRADO',
    'ARCHIVADO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Roles de usuario interno
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('admin', 'lawyer', 'assistant');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tipos de comunicaciÃ³n en lÃ­nea de tiempo
DO $$ BEGIN
  CREATE TYPE comm_type AS ENUM ('note', 'email', 'call', 'message', 'system');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tipos de actuaciÃ³n procesal
DO $$ BEGIN
  CREATE TYPE actuacion_type AS ENUM (
    'RADICACION',
    'NOTIFICACION',
    'RESPUESTA_ENTIDAD',
    'AUDIENCIA',
    'FALLO',
    'IMPUGNACION',
    'RECURSO',
    'SEGUIMIENTO',
    'OTRO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Prioridad de tarea
DO $$ BEGIN
  CREATE TYPE task_priority AS ENUM ('CRITICA', 'ALTA', 'MEDIA', 'BAJA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Estado de tarea
DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('PENDIENTE', 'EN_CURSO', 'COMPLETADA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Urgencia de vencimiento
DO $$ BEGIN
  CREATE TYPE deadline_urgency AS ENUM ('CRITICO', 'ALTO', 'MEDIO', 'BAJO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tipos de evento workflow
DO $$ BEGIN
  CREATE TYPE workflow_event_direction AS ENUM ('inbound', 'outbound');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- USUARIOS (abogados y equipo interno)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          user_role DEFAULT 'lawyer',
  active        BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMP,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS number_sequences (
  key        VARCHAR(80) PRIMARY KEY,
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CLIENTES
-- ============================================================

CREATE TABLE IF NOT EXISTS clients (
  id              SERIAL PRIMARY KEY,
  full_name       VARCHAR(255) NOT NULL,
  document_type   VARCHAR(20) DEFAULT 'CC',        -- CC, CE, NIT, PP, TI, Otro
  document_number VARCHAR(100),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  phone_alt       VARCHAR(50),                      -- segundo telÃ©fono / WhatsApp
  address         TEXT,
  city            VARCHAR(100) DEFAULT 'BogotÃ¡ D.C.',
  jurisdiction    VARCHAR(10)  DEFAULT 'CO',        -- CO, PA, VE, EC
  source          VARCHAR(50),                      -- referido, web, whatsapp, presencial, etc.
  notes           TEXT,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_full_name    ON clients(full_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_doc_number_unique ON clients(document_number);
CREATE INDEX IF NOT EXISTS idx_clients_jurisdiction ON clients(jurisdiction);

-- ============================================================
-- CATÃLOGO DE CANALES DE ENTRADA
-- Referencia estÃ¡tica. No requiere CRUD frecuente.
-- ============================================================

CREATE TABLE IF NOT EXISTS intake_channels (
  id    SERIAL PRIMARY KEY,
  code  VARCHAR(50) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  active BOOLEAN DEFAULT TRUE
);

INSERT INTO intake_channels (code, label) VALUES
  ('WHATSAPP',   'WhatsApp'),
  ('EMAIL',      'Correo electrÃ³nico'),
  ('TELEFONO',   'Llamada telefÃ³nica'),
  ('PRESENCIAL', 'Consulta presencial'),
  ('REFERIDO',   'Referido por cliente'),
  ('WEB',        'Formulario web'),
  ('OTRO',       'Otro')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- CASOS
-- ============================================================

CREATE TABLE IF NOT EXISTS cases (
  id                  SERIAL PRIMARY KEY,
  case_number         VARCHAR(20) UNIQUE NOT NULL,           -- SC-YYYY-NNNN
  client_id           INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  assigned_to         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- ClasificaciÃ³n
  service_type        service_type NOT NULL,
  legal_area          VARCHAR(80),
  process_type        VARCHAR(160),
  jurisdiction        VARCHAR(10) DEFAULT 'CO',              -- CO, PA, VE, EC
  title               VARCHAR(500) NOT NULL,
  description         TEXT,
  entity              VARCHAR(255),                          -- Entidad accionada / destinataria

  -- Estado y seguimiento
  status              case_status DEFAULT 'NUEVO',
  intake_channel      VARCHAR(50) REFERENCES intake_channels(code) ON DELETE SET NULL,
  next_action         TEXT,                                  -- Resumen libre de la siguiente actuaciÃ³n
  next_action_date    DATE,                                  -- Fecha de la siguiente actuaciÃ³n

  -- Fechas procesales
  filing_date         DATE,                                  -- Fecha de radicaciÃ³n
  response_deadline   DATE,                                  -- Fecha lÃ­mite legal del caso

  -- IntegraciÃ³n Google Workspace
  drive_folder_id     VARCHAR(255),                          -- ID carpeta Drive del expediente
  drive_folder_url    TEXT,
  drive_folder_synced_at TIMESTAMP,
  calendar_event_id   VARCHAR(255),                          -- ID evento Calendar (si aplica)

  -- Control
  closed_at           TIMESTAMP,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cases_client_id      ON cases(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_to    ON cases(assigned_to);
CREATE INDEX IF NOT EXISTS idx_cases_status         ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_service_type   ON cases(service_type);
CREATE INDEX IF NOT EXISTS idx_cases_case_number    ON cases(case_number);
CREATE INDEX IF NOT EXISTS idx_cases_jurisdiction   ON cases(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_cases_next_action_dt ON cases(next_action_date) WHERE next_action_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_response_dl    ON cases(response_deadline) WHERE response_deadline IS NOT NULL;

-- ============================================================
-- ACTUACIONES PROCESALES
-- Registro cronolÃ³gico de hitos del caso.
-- Cada actuaciÃ³n puede generar vencimientos y tareas.
-- ============================================================

CREATE TABLE IF NOT EXISTS actuaciones (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type          actuacion_type NOT NULL DEFAULT 'SEGUIMIENTO',
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  scheduled_at  DATE,                                        -- Fecha programada
  completed_at  TIMESTAMP,                                   -- NULL = pendiente
  result        TEXT,                                        -- Resultado / resoluciÃ³n
  radicado      VARCHAR(255),                                -- NÃºmero de radicado externo
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_act_case_id      ON actuaciones(case_id);
CREATE INDEX IF NOT EXISTS idx_act_scheduled    ON actuaciones(scheduled_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_act_completed    ON actuaciones(completed_at);

-- ============================================================
-- TAREAS
-- Trabajo accionable con responsable y fecha lÃ­mite.
-- Puede estar ligada a un caso y/o a una actuaciÃ³n.
-- ============================================================

CREATE TABLE IF NOT EXISTS tareas (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  actuacion_id  INTEGER REFERENCES actuaciones(id) ON DELETE SET NULL,
  title         VARCHAR(500) NOT NULL,
  description   TEXT,
  context       TEXT,
  required_inputs JSONB DEFAULT '[]'::JSONB,
  attachment_refs JSONB DEFAULT '[]'::JSONB,
  checklist     JSONB DEFAULT '[]'::JSONB,
  blocked_reason TEXT,
  estimated_minutes INTEGER,
  position      INTEGER DEFAULT 0,
  board_column_id INTEGER,
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  priority      task_priority DEFAULT 'MEDIA',
  status        task_status DEFAULT 'PENDIENTE',
  due_date      DATE,
  completed_at  TIMESTAMP,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tareas_case_id     ON tareas(case_id);
CREATE INDEX IF NOT EXISTS idx_tareas_assigned_to ON tareas(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tareas_status      ON tareas(status);
CREATE INDEX IF NOT EXISTS idx_tareas_status_position ON tareas(status, position);
CREATE INDEX IF NOT EXISTS idx_tareas_board_column_id ON tareas(board_column_id);
CREATE INDEX IF NOT EXISTS idx_tareas_due_date    ON tareas(due_date) WHERE status NOT IN ('COMPLETADA','CANCELADA');

-- ============================================================
-- TABLERO DE TAREAS
-- Columnas configurables para escritorio/kanban.
-- ============================================================
CREATE TABLE IF NOT EXISTS task_board_columns (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  title         VARCHAR(120) NOT NULL,
  base_status   task_status NOT NULL DEFAULT 'PENDIENTE',
  position      INTEGER DEFAULT 0,
  color         VARCHAR(20),
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_board_columns_scope ON task_board_columns(case_id, position);

DO $$ BEGIN
  ALTER TABLE tareas
    ADD CONSTRAINT fk_tareas_board_column
    FOREIGN KEY (board_column_id) REFERENCES task_board_columns(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- VINCULOS DE TARJETA
-- Evidencias/insumos/adjuntos asociados a tarea (Drive/Correo).
-- ============================================================
CREATE TABLE IF NOT EXISTS task_links (
  id              SERIAL PRIMARY KEY,
  task_id         INTEGER NOT NULL,
  case_id         INTEGER,
  kind            VARCHAR(20) NOT NULL,          -- drive | email
  role            VARCHAR(20) NOT NULL DEFAULT 'attachment', -- input | attachment | evidence
  drive_link_id   INTEGER,
  communication_id INTEGER,
  label           VARCHAR(255),
  metadata        JSONB DEFAULT '{}'::JSONB,
  created_by      INTEGER,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_links_task_id ON task_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_case_id ON task_links(case_id);
CREATE INDEX IF NOT EXISTS idx_task_links_kind_role ON task_links(kind, role);

-- ============================================================
-- VENCIMIENTOS
-- Fechas crÃ­ticas con urgencia clasificada.
-- Son independientes de tareas: un vencimiento puede ser
-- informativo (sin tarea asociada) o derivar una tarea.
-- ============================================================

CREATE TABLE IF NOT EXISTS vencimientos (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  tarea_id      INTEGER REFERENCES tareas(id) ON DELETE SET NULL,
  actuacion_id  INTEGER REFERENCES actuaciones(id) ON DELETE SET NULL,
  title         VARCHAR(500) NOT NULL,
  due_date      DATE NOT NULL,
  urgency       deadline_urgency DEFAULT 'MEDIO',
  notified      BOOLEAN DEFAULT FALSE,
  notified_at   TIMESTAMP,
  resolved      BOOLEAN DEFAULT FALSE,
  resolved_at   TIMESTAMP,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_venc_case_id  ON vencimientos(case_id);
CREATE INDEX IF NOT EXISTS idx_venc_due_date ON vencimientos(due_date) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_venc_urgency  ON vencimientos(urgency) WHERE resolved = FALSE;

-- ============================================================
-- COMUNICACIONES Y LÃNEA DE TIEMPO
-- ============================================================

CREATE TABLE IF NOT EXISTS communications (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  type        comm_type DEFAULT 'note',
  content     TEXT NOT NULL,
  metadata    JSONB,                                         -- datos adicionales (email_id, etc.)
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comms_case_id   ON communications(case_id);
CREATE INDEX IF NOT EXISTS idx_comms_type      ON communications(type);

-- ============================================================
-- DOCUMENTOS
-- Metadata. Los archivos viven en Google Drive.
-- ============================================================

CREATE TABLE IF NOT EXISTS documents (
  id                    SERIAL PRIMARY KEY,
  case_id               INTEGER REFERENCES cases(id) ON DELETE CASCADE,
  name                  VARCHAR(255) NOT NULL,
  file_path             VARCHAR(500),                        -- path local o URL
  drive_file_id         VARCHAR(255),                        -- Google Drive file ID
  document_type         VARCHAR(100),                        -- contrato, tutela, poder, etc.
  classification        VARCHAR(100),                        -- taxonomÃ­a interna
  pending_classification BOOLEAN DEFAULT FALSE,              -- requiere clasificaciÃ³n manual
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_docs_case_id              ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_docs_pending_class        ON documents(pending_classification) WHERE pending_classification = TRUE;
CREATE INDEX IF NOT EXISTS idx_docs_drive_file_id        ON documents(drive_file_id) WHERE drive_file_id IS NOT NULL;

-- ============================================================
-- ARCHIVOS DRIVE VINCULADOS AL EXPEDIENTE
-- VÃ­nculos locales: no borran, mueven ni suben archivos reales.
-- ============================================================

CREATE TABLE IF NOT EXISTS case_drive_files (
  id             SERIAL PRIMARY KEY,
  case_id        INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  drive_file_id  VARCHAR(255) NOT NULL,
  name           TEXT NOT NULL,
  mime_type      TEXT,
  web_view_link  TEXT,
  size           TEXT,
  modified_time  TIMESTAMP,
  category       VARCHAR(100) DEFAULT 'sin_clasificar',
  source         VARCHAR(50) DEFAULT 'drive',
  metadata       JSONB DEFAULT '{}'::jsonb,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMP DEFAULT NOW(),
  UNIQUE(case_id, drive_file_id)
);

CREATE INDEX IF NOT EXISTS idx_case_drive_files_case_id       ON case_drive_files(case_id);
CREATE INDEX IF NOT EXISTS idx_case_drive_files_drive_file_id ON case_drive_files(drive_file_id);
CREATE INDEX IF NOT EXISTS idx_case_drive_files_category      ON case_drive_files(category);

DO $$ BEGIN
  ALTER TABLE task_links
    ADD CONSTRAINT fk_task_links_task
    FOREIGN KEY (task_id) REFERENCES tareas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE task_links
    ADD CONSTRAINT fk_task_links_case
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE task_links
    ADD CONSTRAINT fk_task_links_drive
    FOREIGN KEY (drive_link_id) REFERENCES case_drive_files(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE task_links
    ADD CONSTRAINT fk_task_links_comm
    FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE task_links
    ADD CONSTRAINT fk_task_links_user
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- PARTES DEL CASO
-- Personas o entidades involucradas distintas al cliente.
-- ============================================================

CREATE TABLE IF NOT EXISTS partes (
  id            SERIAL PRIMARY KEY,
  case_id       INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  role          VARCHAR(100) NOT NULL,                       -- accionado, contraparte, tercero, juez, etc.
  name          VARCHAR(255) NOT NULL,
  document_type VARCHAR(20),
  document_number VARCHAR(100),
  contact_info  TEXT,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partes_case_id ON partes(case_id);

-- ============================================================
-- WORKFLOW EVENTS
-- Log de eventos entrantes/salientes con workflow.
-- Permite auditorÃ­a y reintento sin perder datos.
-- ============================================================

CREATE TABLE IF NOT EXISTS workflow_events (
  id            SERIAL PRIMARY KEY,
  direction     workflow_event_direction NOT NULL DEFAULT 'inbound',
  event_type    VARCHAR(100) NOT NULL,                       -- ej: case.created, task.due, gmail.received
  source        VARCHAR(100),                                -- workflow workflow, gmail, whatsapp, etc.
  case_id       INTEGER REFERENCES cases(id) ON DELETE SET NULL,
  payload       JSONB,
  processed     BOOLEAN DEFAULT FALSE,
  processed_at  TIMESTAMP,
  error         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_case_id    ON workflow_events(case_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_processed  ON workflow_events(processed) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_workflow_events_event_type ON workflow_events(event_type);

-- ============================================================
-- LOG DE AUDITORÃA
-- Inmutable. Registra cambios crÃ­ticos de estado.
-- No usar UPDATE ni DELETE sobre esta tabla.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id          SERIAL PRIMARY KEY,
  table_name  VARCHAR(100) NOT NULL,
  record_id   INTEGER NOT NULL,
  action      VARCHAR(20) NOT NULL,                          -- INSERT, UPDATE, DELETE
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  old_data    JSONB,
  new_data    JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_changed_by   ON audit_log(changed_by);

-- ============================================================
-- FUNCIÃ“N: update_updated_at (reutilizable)
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGERS: updated_at
-- ============================================================

DO $$ BEGIN
  CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_cases_updated_at
    BEFORE UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_actuaciones_updated_at
    BEFORE UPDATE ON actuaciones FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER trg_tareas_updated_at
    BEFORE UPDATE ON tareas FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- FUNCIÃ“N: audit_case_status_change
-- Registra en audit_log cada cambio de estado de un caso.
-- ============================================================

CREATE OR REPLACE FUNCTION audit_case_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data)
    VALUES (
      'cases',
      NEW.id,
      'UPDATE',
      jsonb_build_object('status', OLD.status),
      jsonb_build_object('status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  CREATE TRIGGER trg_audit_case_status
    AFTER UPDATE ON cases FOR EACH ROW EXECUTE FUNCTION audit_case_status_change();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- VISTAS OPERATIVAS
-- ============================================================

-- Vista: casos activos con contexto para dashboard
CREATE OR REPLACE VIEW v_casos_activos AS
SELECT
  c.id,
  c.case_number,
  c.title,
  c.service_type,
  c.status,
  c.jurisdiction,
  c.next_action,
  c.next_action_date,
  c.response_deadline,
  c.drive_folder_id,
  cl.full_name    AS client_name,
  cl.phone        AS client_phone,
  cl.email        AS client_email,
  u.name          AS assigned_to_name,
  c.created_at,
  c.updated_at,
  -- Contadores en vivo
  (SELECT COUNT(*) FROM tareas t
   WHERE t.case_id = c.id AND t.status NOT IN ('COMPLETADA','CANCELADA')) AS tareas_pendientes,
  (SELECT COUNT(*) FROM vencimientos v
   WHERE v.case_id = c.id AND v.resolved = FALSE AND v.due_date <= NOW() + INTERVAL '7 days') AS vencimientos_proximos
FROM cases c
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN users u    ON c.assigned_to = u.id
WHERE c.status NOT IN ('CERRADO', 'ARCHIVADO');

-- Vista: bandeja del dÃ­a por abogado
CREATE OR REPLACE VIEW v_bandeja_hoy AS
SELECT
  'tarea'           AS item_type,
  t.id              AS item_id,
  t.title,
  t.priority::TEXT  AS urgency,
  t.due_date        AS fecha,
  t.case_id,
  c.case_number,
  c.title           AS case_title,
  t.assigned_to     AS user_id
FROM tareas t
JOIN cases c ON t.case_id = c.id
WHERE t.status NOT IN ('COMPLETADA','CANCELADA')
  AND t.due_date <= CURRENT_DATE + INTERVAL '3 days'

UNION ALL

SELECT
  'vencimiento'       AS item_type,
  v.id                AS item_id,
  v.title,
  v.urgency::TEXT     AS urgency,
  v.due_date          AS fecha,
  v.case_id,
  c.case_number,
  c.title             AS case_title,
  c.assigned_to       AS user_id
FROM vencimientos v
JOIN cases c ON v.case_id = c.id
WHERE v.resolved = FALSE
  AND v.due_date <= CURRENT_DATE + INTERVAL '7 days'

ORDER BY fecha ASC, urgency DESC;

-- Vista: prÃ³ximas actuaciones pendientes
CREATE OR REPLACE VIEW v_actuaciones_pendientes AS
SELECT
  a.id,
  a.case_id,
  c.case_number,
  c.title           AS case_title,
  cl.full_name      AS client_name,
  a.type,
  a.title           AS actuacion_title,
  a.scheduled_at,
  a.radicado,
  u.name            AS assigned_to_name,
  c.assigned_to     AS user_id
FROM actuaciones a
JOIN cases c  ON a.case_id = c.id
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN users u    ON c.assigned_to = u.id
WHERE a.completed_at IS NULL
ORDER BY a.scheduled_at ASC NULLS LAST;

-- ============================================================
-- MACROCASOS / PROYECTOS
-- Contenedor de mÃºltiples casos bajo una causa comÃºn.
-- Actuaciones, tareas y vencimientos pueden pertenecer
-- a un macrocaso (nivel proyecto) o a un caso individual.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE macrocaso_status AS ENUM (
    'ACTIVO',
    'EN_ESPERA',
    'CERRADO',
    'ARCHIVADO'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS macrocasos (
  id               SERIAL PRIMARY KEY,
  code             VARCHAR(20) UNIQUE NOT NULL,    -- MC-YYYY-NNNN
  title            VARCHAR(500) NOT NULL,
  description      TEXT,
  service_type     service_type NOT NULL,
  jurisdiction     VARCHAR(10) DEFAULT 'CO',
  entity           VARCHAR(255),
  status           macrocaso_status DEFAULT 'ACTIVO',
  next_action      TEXT,
  next_action_date DATE,
  lead_lawyer      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  drive_folder_id  VARCHAR(255),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_macrocasos_status ON macrocasos(status);
CREATE INDEX IF NOT EXISTS idx_macrocasos_code   ON macrocasos(code);

DO $$ BEGIN
  CREATE TRIGGER trg_macrocasos_updated_at
    BEFORE UPDATE ON macrocasos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- FK en cases
ALTER TABLE cases ADD COLUMN IF NOT EXISTS macrocaso_id INTEGER REFERENCES macrocasos(id) ON DELETE SET NULL;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_cases_macrocaso ON cases(macrocaso_id) WHERE macrocaso_id IS NOT NULL;

-- actuaciones: case_id nullable + macrocaso_id
ALTER TABLE actuaciones ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE actuaciones ADD COLUMN IF NOT EXISTS macrocaso_id INTEGER REFERENCES macrocasos(id) ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE actuaciones ADD CONSTRAINT chk_actuacion_scope
    CHECK (case_id IS NOT NULL OR macrocaso_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_act_macrocaso_id ON actuaciones(macrocaso_id) WHERE macrocaso_id IS NOT NULL;

-- tareas: macrocaso_id
ALTER TABLE tareas ADD COLUMN IF NOT EXISTS macrocaso_id INTEGER REFERENCES macrocasos(id) ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE tareas ADD CONSTRAINT chk_tarea_scope
    CHECK (case_id IS NOT NULL OR macrocaso_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_tareas_macrocaso_id ON tareas(macrocaso_id) WHERE macrocaso_id IS NOT NULL;

-- vencimientos: case_id nullable + macrocaso_id
ALTER TABLE vencimientos ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE vencimientos ADD COLUMN IF NOT EXISTS macrocaso_id INTEGER REFERENCES macrocasos(id) ON DELETE CASCADE;
DO $$ BEGIN
  ALTER TABLE vencimientos ADD CONSTRAINT chk_vencimiento_scope
    CHECK (case_id IS NOT NULL OR macrocaso_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_venc_macrocaso_id ON vencimientos(macrocaso_id) WHERE macrocaso_id IS NOT NULL;

-- Vista: macrocasos activos con conteos en tiempo real
CREATE OR REPLACE VIEW v_macrocasos_activos AS
SELECT
  m.id, m.code, m.title, m.service_type, m.status, m.entity,
  m.next_action, m.next_action_date, m.jurisdiction,
  u.name AS lead_lawyer_name, u.id AS lead_lawyer_id,
  COUNT(DISTINCT c.id)                                            AS cases_count,
  COUNT(DISTINCT t.id)
    FILTER (WHERE t.macrocaso_id = m.id
            AND   t.status NOT IN ('COMPLETADA','CANCELADA'))     AS tareas_pendientes,
  COUNT(DISTINCT v.id)
    FILTER (WHERE v.macrocaso_id = m.id
            AND   v.resolved = FALSE
            AND   v.due_date <= CURRENT_DATE + 7)                 AS vencimientos_proximos,
  COUNT(DISTINCT v2.id)
    FILTER (WHERE v2.macrocaso_id = m.id
            AND   v2.resolved = FALSE
            AND   v2.due_date < CURRENT_DATE)                     AS vencimientos_vencidos,
  m.created_at, m.updated_at
FROM macrocasos m
LEFT JOIN users u        ON m.lead_lawyer = u.id
LEFT JOIN cases c        ON c.macrocaso_id = m.id
LEFT JOIN tareas t       ON t.macrocaso_id = m.id
LEFT JOIN vencimientos v  ON v.macrocaso_id = m.id
LEFT JOIN vencimientos v2 ON v2.macrocaso_id = m.id
WHERE m.status != 'ARCHIVADO'
GROUP BY m.id, u.name, u.id;

-- ============================================================
-- SALAS / CASE INTELLIGENCE
-- Primer modulo IA: analisis de caso con sugerencias aprobables.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id              SERIAL PRIMARY KEY,
  provider        VARCHAR(80) NOT NULL DEFAULT 'local',
  model           VARCHAR(120),
  purpose         VARCHAR(120) NOT NULL,
  prompt_version  VARCHAR(40) NOT NULL DEFAULT 'case_sala_v0',
  input_hash      VARCHAR(128),
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_cents      NUMERIC(12,4),
  status          VARCHAR(40) NOT NULL DEFAULT 'completed',
  error           TEXT,
  metadata        JSONB,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_ai_analyses (
  id              SERIAL PRIMARY KEY,
  case_id         INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  agent_run_id    INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_type     VARCHAR(60) NOT NULL DEFAULT 'nota',
  source_text     TEXT NOT NULL,
  analysis        JSONB NOT NULL,
  status          VARCHAR(40) NOT NULL DEFAULT 'generated',
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at      TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS case_ai_suggestions (
  id               SERIAL PRIMARY KEY,
  analysis_id      INTEGER NOT NULL REFERENCES case_ai_analyses(id) ON DELETE CASCADE,
  suggestion_type  VARCHAR(60) NOT NULL,
  title            VARCHAR(500) NOT NULL,
  payload          JSONB NOT NULL,
  confidence       NUMERIC(4,3),
  status           VARCHAR(40) NOT NULL DEFAULT 'pending',
  applied_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  applied_at       TIMESTAMP,
  result_table     VARCHAR(100),
  result_id        INTEGER,
  created_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_purpose ON agent_runs(purpose);
CREATE INDEX IF NOT EXISTS idx_case_ai_analyses_case_id ON case_ai_analyses(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_ai_suggestions_analysis_id ON case_ai_suggestions(analysis_id);
CREATE INDEX IF NOT EXISTS idx_case_ai_suggestions_status ON case_ai_suggestions(status);

-- ============================================================
-- CONFIRMACIÃ“N
-- ============================================================

DO $$ BEGIN
  RAISE NOTICE 'Î¦ Opus â€” Schema v4.0 (NIGREDO Â· SALAS) creado exitosamente.';
  RAISE NOTICE 'Tablas: users, clients, intake_channels, cases, macrocasos, actuaciones, tareas, vencimientos, communications, documents, partes, workflow_events, audit_log, agent_runs, case_ai_analyses, case_ai_suggestions';
  RAISE NOTICE 'Vistas: v_casos_activos, v_bandeja_hoy, v_actuaciones_pendientes, v_macrocasos_activos';
END $$;
