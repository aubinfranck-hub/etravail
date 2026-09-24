-- e-Travail — schéma MVP
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT,
  role VARCHAR(30) NOT NULL CHECK (role IN ('CITOYEN','GREFFE','MAGISTRAT','ADMIN')),
  full_name VARCHAR(255), phone VARCHAR(40), active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), reference VARCHAR(60) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL, claimant_id UUID NOT NULL REFERENCES users(id),
  status VARCHAR(40) NOT NULL DEFAULT 'BROUILLON',
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_role VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL, full_name VARCHAR(255) NOT NULL, contact VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id), filename VARCHAR(255) NOT NULL, storage_key TEXT NOT NULL,
  mime_type VARCHAR(120), file_size BIGINT, file_data BYTEA, ocr_text TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS hearings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL, room VARCHAR(120), status VARCHAR(40) NOT NULL DEFAULT 'PLANIFIEE'
);
CREATE TABLE IF NOT EXISTS conciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ NOT NULL, room VARCHAR(120),
  status VARCHAR(40) NOT NULL DEFAULT 'PLANIFIEE',
  notes TEXT, created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  decision_reference VARCHAR(100), content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id),
  case_id UUID REFERENCES cases(id) ON DELETE CASCADE, channel VARCHAR(30) NOT NULL,
  subject VARCHAR(255) NOT NULL, body TEXT NOT NULL, sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), actor_id UUID REFERENCES users(id),
  case_id UUID REFERENCES cases(id), action VARCHAR(100) NOT NULL, metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL UNIQUE REFERENCES cases(id) ON DELETE CASCADE,
  fee_amount NUMERIC(14,2),
  currency VARCHAR(10) NOT NULL DEFAULT 'XOF',
  payment_status VARCHAR(30) NOT NULL DEFAULT 'A_PAYER'
    CHECK (payment_status IN ('A_PAYER','PAYE','EXONERE','ANNULE')),
  payment_reference VARCHAR(120),
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_enrollments_payment_status ON enrollments(payment_status);

CREATE TABLE IF NOT EXISTS payment_validation_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  code_hash VARCHAR(128) NOT NULL,
  source VARCHAR(30) NOT NULL CHECK (source IN ('COMPTABILITE','CAISSE','EXTERNE')),
  external_reference VARCHAR(120),
  amount NUMERIC(14,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'XOF',
  issued_by UUID REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMPTZ,
  used_by UUID REFERENCES users(id),
  UNIQUE(case_id,code_hash)
);
CREATE INDEX IF NOT EXISTS idx_payment_codes_case ON payment_validation_codes(case_id,issued_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_codes_hash ON payment_validation_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_cases_reference ON cases(reference);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(30);
CREATE INDEX IF NOT EXISTS idx_cases_assigned_to ON cases(assigned_to);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_data BYTEA;
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_ocr ON documents USING gin (to_tsvector('french', coalesce(ocr_text,'')));
CREATE INDEX IF NOT EXISTS idx_audit_case ON audit_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_hearings_schedule ON hearings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_conciliations_schedule ON conciliations(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

ALTER TABLE hearings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_conciliations_case ON conciliations(case_id);


CREATE TABLE IF NOT EXISTS legal_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  jurisdiction VARCHAR(120) NOT NULL DEFAULT 'COTE_D_IVOIRE',
  source_type VARCHAR(80) NOT NULL,
  official_url TEXT,
  version_label VARCHAR(120),
  published_at DATE,
  effective_from DATE,
  effective_to DATE,
  content TEXT NOT NULL,
  content_hash VARCHAR(128),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_legal_sources_active ON legal_sources(active);
CREATE INDEX IF NOT EXISTS idx_legal_sources_jurisdiction ON legal_sources(jurisdiction);
CREATE INDEX IF NOT EXISTS idx_legal_sources_content ON legal_sources USING gin (to_tsvector('french', coalesce(content,'')));

CREATE TABLE IF NOT EXISTS ai_assistance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  case_id UUID REFERENCES cases(id) ON DELETE SET NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sources JSONB,
  model VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_ai_assistance_user ON ai_assistance_logs(user_id, created_at DESC);


-- e-Travail workflow control v1
CREATE TABLE IF NOT EXISTS workflow_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status VARCHAR(40) NOT NULL,
  nature_code VARCHAR(60),
  code VARCHAR(100) NOT NULL,
  label VARCHAR(255) NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  deadline_hours INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(status,nature_code,code)
);
CREATE INDEX IF NOT EXISTS idx_workflow_requirements_lookup ON workflow_requirements(status,nature_code,active);

CREATE TABLE IF NOT EXISTS case_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES workflow_requirements(id),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RECEIVED','VALIDATED','REJECTED')),
  document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
  validated_by UUID REFERENCES users(id),
  validated_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_id,requirement_id)
);
CREATE INDEX IF NOT EXISTS idx_case_requirements_case ON case_requirements(case_id);
CREATE INDEX IF NOT EXISTS idx_case_requirements_status ON case_requirements(status);

ALTER TABLE cases ADD COLUMN IF NOT EXISTS nature_code VARCHAR(60) DEFAULT 'AUTRE';
ALTER TABLE cases ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_cases_due_at ON cases(due_at);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id,read_at,created_at DESC);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role VARCHAR(30);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(128);
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS event_hash VARCHAR(128);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS case_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  assigned_role VARCHAR(30),
  assigned_by UUID REFERENCES users(id),
  assignment_type VARCHAR(20) NOT NULL DEFAULT 'MANUAL' CHECK(assignment_type IN ('MANUAL','AUTO','REASSIGNMENT')),
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_case_assignments_case ON case_assignments(case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_assignments_user ON case_assignments(assigned_to,created_at DESC);


CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(30) NOT NULL CHECK (role IN ('CITOYEN','GREFFE','MAGISTRAT','ADMIN')),
  permission VARCHAR(100) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role,permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role,enabled);
