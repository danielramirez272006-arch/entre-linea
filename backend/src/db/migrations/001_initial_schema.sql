-- Migración 001: Esquema inicial de Entre Líneas — Diario Seguro
-- Todas las consultas de la aplicación usan parámetros enlazados ($1, $2, ...).

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(64) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),

  phone_ciphertext BYTEA,
  phone_iv BYTEA,
  phone_tag BYTEA,
  phone_key_version VARCHAR(32),

  sensitive_note_ciphertext BYTEA,
  sensitive_note_iv BYTEA,
  sensitive_note_tag BYTEA,
  sensitive_note_key_version VARCHAR(32),

  failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT users_phone_crypto_complete CHECK (
    (phone_ciphertext IS NULL AND phone_iv IS NULL AND phone_tag IS NULL AND phone_key_version IS NULL)
    OR
    (phone_ciphertext IS NOT NULL AND octet_length(phone_iv) = 12 AND octet_length(phone_tag) = 16 AND phone_key_version IS NOT NULL)
  ),
  CONSTRAINT users_sensitive_note_crypto_complete CHECK (
    (sensitive_note_ciphertext IS NULL AND sensitive_note_iv IS NULL AND sensitive_note_tag IS NULL AND sensitive_note_key_version IS NULL)
    OR
    (sensitive_note_ciphertext IS NOT NULL AND octet_length(sensitive_note_iv) = 12 AND octet_length(sensitive_note_tag) = 16 AND sensitive_note_key_version IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token CHAR(64) NOT NULL,
  ip_address VARCHAR(64),
  user_agent VARCHAR(300),
  expires_at TIMESTAMPTZ NOT NULL,
  absolute_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS diary_entries (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  category VARCHAR(24) NOT NULL CHECK (category IN ('personal', 'gratitud', 'metas', 'recuerdos')),
  mood VARCHAR(24) NOT NULL CHECK (mood IN ('bien', 'tranquilo', 'normal', 'triste', 'agotado')),

  title_ciphertext BYTEA NOT NULL,
  title_iv BYTEA NOT NULL CHECK (octet_length(title_iv) = 12),
  title_tag BYTEA NOT NULL CHECK (octet_length(title_tag) = 16),

  content_ciphertext BYTEA NOT NULL,
  content_iv BYTEA NOT NULL CHECK (octet_length(content_iv) = 12),
  content_tag BYTEA NOT NULL CHECK (octet_length(content_tag) = 16),

  key_version VARCHAR(32) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diary_entries_owner_date
  ON diary_entries (owner_id, entry_date DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_diary_entries_key_version
  ON diary_entries (key_version);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
  ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at
  ON password_reset_tokens (expires_at);

CREATE TABLE IF NOT EXISTS security_audit_logs (
  id UUID PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('info', 'warn', 'alert')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address VARCHAR(64),
  request_path VARCHAR(200),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at
  ON security_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_event_type
  ON security_audit_logs (event_type);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_severity
  ON security_audit_logs (severity);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key VARCHAR(160) PRIMARY KEY,
  hit_count INTEGER NOT NULL DEFAULT 1 CHECK (hit_count >= 1),
  window_reset_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_reset_at
  ON rate_limits (window_reset_at);
