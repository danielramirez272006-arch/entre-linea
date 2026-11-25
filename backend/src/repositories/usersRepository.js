const ROLE_MUTATION_ADVISORY_LOCK_KEY = 8842101;

export function createUsersRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async findByEmail(email, client) {
      const { rows } = await exec(client).query(
        `SELECT id, name, email, password_hash, role, auth_version,
                phone_ciphertext, phone_iv, phone_tag, phone_key_version,
                sensitive_note_ciphertext, sensitive_note_iv, sensitive_note_tag, sensitive_note_key_version,
                failed_login_attempts, locked_until, created_at, updated_at
         FROM users
         WHERE email = $1`,
        [email]
      );
      return rows[0] || null;
    },

    async findById(id, client) {
      const { rows } = await exec(client).query(
        `SELECT id, name, email, password_hash, role, auth_version,
                phone_ciphertext, phone_iv, phone_tag, phone_key_version,
                sensitive_note_ciphertext, sensitive_note_iv, sensitive_note_tag, sensitive_note_key_version,
                failed_login_attempts, locked_until, created_at, updated_at
         FROM users
         WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    },

    async findByIdForUpdate(id, client) {
      const { rows } = await exec(client).query(
        `SELECT id, name, email, password_hash, role, auth_version,
                failed_login_attempts, locked_until, created_at, updated_at
         FROM users
         WHERE id = $1
         FOR UPDATE`,
        [id]
      );
      return rows[0] || null;
    },

    async lockUsersForUpdate(ids, client) {
      const uniqueSorted = [...new Set(ids)].sort();
      const { rows } = await exec(client).query(
        `SELECT id, name, email, password_hash, role, auth_version,
                failed_login_attempts, locked_until, created_at, updated_at
         FROM users
         WHERE id = ANY($1::uuid[])
         ORDER BY id ASC
         FOR UPDATE`,
        [uniqueSorted]
      );
      return rows;
    },

    async acquireRoleMutationLock(client) {
      await exec(client).query(`SELECT pg_advisory_xact_lock($1)`, [ROLE_MUTATION_ADVISORY_LOCK_KEY]);
    },

    async lockRowForUpdate(id, client) {
      const { rows } = await exec(client).query(
        `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
        [id]
      );
      return rows[0] || null;
    },

    async create({ id, name, email, passwordHash, role = 'user' }, client) {
      const { rows } = await exec(client).query(
        `INSERT INTO users (id, name, email, password_hash, role, auth_version)
         VALUES ($1, $2, $3, $4, $5, 1)
         RETURNING id, name, email, role, auth_version, created_at, updated_at`,
        [id, name, email, passwordHash, role]
      );
      return rows[0];
    },

    async updateProfile({ id, name, phoneCrypto, sensitiveNoteCrypto }, client) {
      const { rows } = await exec(client).query(
        `UPDATE users
         SET name = $2,
             phone_ciphertext = $3,
             phone_iv = $4,
             phone_tag = $5,
             phone_key_version = $6,
             sensitive_note_ciphertext = $7,
             sensitive_note_iv = $8,
             sensitive_note_tag = $9,
             sensitive_note_key_version = $10,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, email, role,
                   phone_ciphertext, phone_iv, phone_tag, phone_key_version,
                   sensitive_note_ciphertext, sensitive_note_iv, sensitive_note_tag, sensitive_note_key_version,
                   created_at, updated_at`,
        [
          id,
          name,
          phoneCrypto ? phoneCrypto.ciphertext : null,
          phoneCrypto ? phoneCrypto.iv : null,
          phoneCrypto ? phoneCrypto.tag : null,
          phoneCrypto ? phoneCrypto.keyVersion : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.ciphertext : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.iv : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.tag : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.keyVersion : null,
        ]
      );
      return rows[0] || null;
    },

    async updatePassword(id, passwordHash, client) {
      const { rows } = await exec(client).query(
        `UPDATE users
         SET password_hash = $2,
             auth_version = auth_version + 1,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, auth_version`,
        [id, passwordHash]
      );
      return rows[0] || null;
    },

    /**
     * Incrementa atómicamente los intentos fallidos y calcula el bloqueo progresivo
     * sobre el valor recién incrementado en PostgreSQL.
     */
    async incrementFailedLogin(id, { maxAttempts, lockoutBaseSeconds }, client) {
      const { rows } = await exec(client).query(
        `UPDATE users
         SET failed_login_attempts = failed_login_attempts + 1,
             locked_until = CASE
               WHEN failed_login_attempts + 1 >= $2 THEN
                 GREATEST(
                   COALESCE(locked_until, NOW()),
                   NOW() + make_interval(
                     secs => LEAST($3 * POWER(2, LEAST((failed_login_attempts + 1) - $2, 6)), 3600)
                   )
                 )
               ELSE locked_until
             END,
             updated_at = NOW()
         WHERE id = $1
         RETURNING failed_login_attempts, locked_until`,
        [id, maxAttempts, lockoutBaseSeconds]
      );
      return rows[0] || null;
    },

    async resetLoginFailures(id, client) {
      await exec(client).query(
        `UPDATE users
         SET failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [id]
      );
    },

    async listAllForAdmin(client) {
      const { rows } = await exec(client).query(
        `SELECT id, name, email, role, failed_login_attempts, locked_until, created_at, updated_at
         FROM users
         ORDER BY created_at ASC`
      );
      return rows;
    },

    async countAdmins(client) {
      const { rows } = await exec(client).query(
        `SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'`
      );
      return rows[0].total;
    },

    async updateRole(id, role, client) {
      const { rows } = await exec(client).query(
        `UPDATE users
         SET role = $2,
             auth_version = auth_version + 1,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, email, role, auth_version, created_at, updated_at`,
        [id, role]
      );
      return rows[0] || null;
    },

    async listWithOutdatedKeyVersion(activeKeyVersion, client) {
      const { rows } = await exec(client).query(
        `SELECT id,
                phone_ciphertext, phone_iv, phone_tag, phone_key_version,
                sensitive_note_ciphertext, sensitive_note_iv, sensitive_note_tag, sensitive_note_key_version
         FROM users
         WHERE (phone_key_version IS NOT NULL AND phone_key_version <> $1)
            OR (sensitive_note_key_version IS NOT NULL AND sensitive_note_key_version <> $1)`,
        [activeKeyVersion]
      );
      return rows;
    },

    async updateReencryptedFields({ id, phoneCrypto, sensitiveNoteCrypto }, client) {
      await exec(client).query(
        `UPDATE users
         SET phone_ciphertext = $2,
             phone_iv = $3,
             phone_tag = $4,
             phone_key_version = $5,
             sensitive_note_ciphertext = $6,
             sensitive_note_iv = $7,
             sensitive_note_tag = $8,
             sensitive_note_key_version = $9,
             updated_at = NOW()
         WHERE id = $1`,
        [
          id,
          phoneCrypto ? phoneCrypto.ciphertext : null,
          phoneCrypto ? phoneCrypto.iv : null,
          phoneCrypto ? phoneCrypto.tag : null,
          phoneCrypto ? phoneCrypto.keyVersion : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.ciphertext : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.iv : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.tag : null,
          sensitiveNoteCrypto ? sensitiveNoteCrypto.keyVersion : null,
        ]
      );
    },
  });
}
