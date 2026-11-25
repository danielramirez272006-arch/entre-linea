-- Migración 002: Versión de autenticación para sincronización transaccional
-- Evita que un login concurrente emita sesión tras un cambio o restablecimiento de contraseña,
-- y permite validar vigencia de credenciales/privilegios en cambios de rol.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1 CHECK (auth_version >= 1);
