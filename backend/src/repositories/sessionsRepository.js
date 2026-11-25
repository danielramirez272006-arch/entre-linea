export function createSessionsRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async create({ idHash, userId, csrfToken, ipAddress, userAgent, expiresAt, absoluteExpiresAt }, client) {
      const { rows } = await exec(client).query(
        `INSERT INTO sessions (id_hash, user_id, csrf_token, ip_address, user_agent, expires_at, absolute_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id_hash, user_id, csrf_token, expires_at, absolute_expires_at, created_at`,
        [idHash, userId, csrfToken, ipAddress || null, userAgent ? userAgent.slice(0, 300) : null, expiresAt, absoluteExpiresAt]
      );
      return rows[0];
    },

    async findActiveByIdHash(idHash, client) {
      const { rows } = await exec(client).query(
        `SELECT s.id_hash, s.user_id, s.csrf_token, s.expires_at, s.absolute_expires_at, s.last_seen_at,
                u.name, u.email, u.role
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = $1
           AND s.expires_at > NOW()
           AND s.absolute_expires_at > NOW()`,
        [idHash]
      );
      return rows[0] || null;
    },

    async touch(idHash, newExpiresAt, client) {
      await exec(client).query(
        `UPDATE sessions
         SET last_seen_at = NOW(),
             expires_at = LEAST($2::timestamptz, absolute_expires_at)
         WHERE id_hash = $1`,
        [idHash, newExpiresAt]
      );
    },

    async deleteByIdHash(idHash, client) {
      await exec(client).query(`DELETE FROM sessions WHERE id_hash = $1`, [idHash]);
    },

    async deleteAllForUser(userId, client) {
      await exec(client).query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
    },

    async deleteExpired(client) {
      await exec(client).query(
        `DELETE FROM sessions WHERE expires_at <= NOW() OR absolute_expires_at <= NOW()`
      );
    },
  });
}
