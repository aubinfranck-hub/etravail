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
CREATE INDEX IF NOT EXISTS idx_cases_reference ON cases(reference);
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
