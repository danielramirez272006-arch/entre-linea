export function createPasswordResetRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async create({ id, userId, tokenHash, expiresAt }, client) {
      await exec(client).query(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [id, userId, tokenHash, expiresAt]
      );
    },

    async invalidateAllForUser(userId, client) {
      await exec(client).query(
        `UPDATE password_reset_tokens
         SET consumed_at = NOW()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [userId]
      );
    },

    async invalidateById(id, client) {
      await exec(client).query(
        `UPDATE password_reset_tokens
         SET consumed_at = NOW()
         WHERE id = $1 AND consumed_at IS NULL`,
        [id]
      );
    },

    async findActiveUserIdByHash(tokenHash, client) {
      const { rows } = await exec(client).query(
        `SELECT user_id
         FROM password_reset_tokens
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()`,
        [tokenHash]
      );
      return rows[0]?.user_id || null;
    },

    async consumeAtomic(tokenHash, client) {
      const { rows } = await exec(client).query(
        `UPDATE password_reset_tokens
         SET consumed_at = NOW()
         WHERE token_hash = $1
           AND consumed_at IS NULL
           AND expires_at > NOW()
         RETURNING id, user_id`,
        [tokenHash]
      );
      return rows[0] || null;
    },

    async deleteExpired(client) {
      await exec(client).query(
        `DELETE FROM password_reset_tokens WHERE expires_at <= NOW() OR consumed_at IS NOT NULL`
      );
    },
  });
}
