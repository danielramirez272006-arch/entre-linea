# Modelo de Datos — Entre Líneas

Definido de forma reproducible en `backend/src/db/migrations/001_initial_schema.sql` y `backend/src/db/migrations/002_auth_version_and_concurrency.sql`.

## Tablas y relaciones

### 1. `users`
Almacena cuentas, hashes Argon2id, control de bloqueo progresivo y campos personales cifrados.

- **Clave primaria:** `id UUID PRIMARY KEY`
- **Restricciones:**
  - `email VARCHAR(254) NOT NULL UNIQUE` (normalizado en minúsculas)
  - `role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))`
  - `auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1)` (se incrementa atómicamente en cambios de contraseña y rol para invalidar carreras de autenticación o privilegios)
  - `failed_login_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0)` (incrementado atómicamente en SQL junto con el cálculo progresivo de `locked_until`)
  - Campos cifrados de teléfono (`phone_ciphertext`, `phone_iv`, `phone_tag`, `phone_key_version`) y dato sensible de prueba (`sensitive_note_*`) con restricciones `CHECK` que exigen completitud (o todos nulos o completos con `octet_length(iv) = 12` y `octet_length(tag) = 16`).

### 2. `sessions`
Sesiones activas del servidor persistidas en PostgreSQL.

- **Clave primaria:** `id_hash CHAR(64) PRIMARY KEY` (SHA-256 del token opaco de la cookie)
- **Relación:** `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- **Campos clave:** `csrf_token CHAR(64)`, `expires_at`, `absolute_expires_at`, `last_seen_at`, `ip_address`, `user_agent`.
- **Índices:** `idx_sessions_user_id`, `idx_sessions_expires_at`.

### 3. `diary_entries`
Entradas privadas del diario con cifrado autenticado por campo y control optimista de concurrencia.

- **Clave primaria:** `id UUID PRIMARY KEY`
- **Relación:** `owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- **Metadatos consultables:** `entry_date DATE`, `category CHECK (category IN ('personal', 'gratitud', 'metas', 'recuerdos'))`, `mood CHECK (mood IN ('bien', 'tranquilo', 'normal', 'triste', 'agotado'))`.
- **Campos cifrados (AES-256-GCM):**
  - `title_ciphertext BYTEA`, `title_iv BYTEA (12B)`, `title_tag BYTEA (16B)`
  - `content_ciphertext BYTEA`, `content_iv BYTEA (12B)`, `content_tag BYTEA (16B)`
  - `key_version VARCHAR(32) NOT NULL`
- **Concurrencia:** `version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)`. Al actualizar se valida `WHERE id = $1 AND owner_id = $2 AND version = $3` incrementando `version = version + 1`.
- **Límite de 100 entradas por usuario:** Al crear una entrada, la transacción bloquea la fila del propietario (`SELECT id FROM users WHERE id = $1 FOR UPDATE`) antes de contar `diary_entries`, evitando condiciones de carrera.

### 4. `password_reset_tokens`
Tokens de recuperación de contraseña de un solo uso y corta duración (15 minutos).

- **Clave primaria:** `id UUID PRIMARY KEY`
- **Relación:** `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- **Campos clave:** `token_hash CHAR(64) UNIQUE` (SHA-256), `expires_at`, `consumed_at`.
- **Consumo atómico:** `UPDATE password_reset_tokens SET consumed_at = NOW() WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > NOW() RETURNING id, user_id`.

### 5. `security_audit_logs`
Bitácora de seguridad y alertas persistidas visibles en el panel administrativo.

- **Relaciones:** `actor_user_id` y `target_user_id` con `REFERENCES users(id) ON DELETE SET NULL`.
- **Campos clave:** `event_type`, `severity CHECK (severity IN ('info', 'warn', 'alert'))`, `ip_address`, `request_path`, `details JSONB`, `created_at`.
- **Privacidad:** Nunca almacena contraseñas, cookies, tokens, ciphertext ni contenido privado del diario.

### 6. `rate_limits`
Contadores compartidos por ventana de tiempo para rate limiting persistido en PostgreSQL.

- **Clave primaria:** `bucket_key VARCHAR(160) PRIMARY KEY`
- **Campos clave:** `hit_count INTEGER`, `window_reset_at TIMESTAMPTZ`.

### 7. `schema_migrations`
Control de versiones de migraciones SQL ya aplicadas (`version`, `applied_at`).
