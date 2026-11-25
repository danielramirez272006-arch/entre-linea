import { randomUUID } from 'node:crypto';

export function createAuditRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async insert(
      { eventType, severity = 'info', actorUserId = null, targetUserId = null, ipAddress = null, requestPath = null, details = {} },
      client
    ) {
      const id = randomUUID();
      const { rows } = await exec(client).query(
        `INSERT INTO security_audit_logs (
           id, event_type, severity, actor_user_id, target_user_id, ip_address, request_path, details
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         RETURNING id, event_type, severity, actor_user_id, target_user_id, ip_address, request_path, details, created_at`,
        [
          id,
          eventType,
          severity,
          actorUserId,
          targetUserId,
          ipAddress,
          requestPath ? String(requestPath).split('?')[0].slice(0, 200) : null,
          JSON.stringify(details),
        ]
      );
      return rows[0];
    },

    async listRecent(limit = 100, client) {
      const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
      const { rows } = await exec(client).query(
        `SELECT l.id, l.event_type, l.severity, l.actor_user_id, l.target_user_id,
                l.ip_address, l.request_path, l.details, l.created_at,
                actor.email AS actor_email,
                target.email AS target_email
         FROM security_audit_logs l
         LEFT JOIN users actor ON actor.id = l.actor_user_id
         LEFT JOIN users target ON target.id = l.target_user_id
         ORDER BY l.created_at DESC
         LIMIT $1`,
        [safeLimit]
      );
      return rows;
    },

    async countRecentFailedLogins({ ipAddress, targetUserId, windowMinutes = 15 }, client) {
      if (targetUserId) {
        const { rows } = await exec(client).query(
          `SELECT COUNT(*)::int AS total
           FROM security_audit_logs
           WHERE event_type = 'login_failed'
             AND target_user_id = $1
             AND created_at >= NOW() - ($2 || ' minutes')::interval`,
          [targetUserId, String(windowMinutes)]
        );
        return rows[0].total;
      }
      const { rows } = await exec(client).query(
        `SELECT COUNT(*)::int AS total
         FROM security_audit_logs
         WHERE event_type = 'login_failed'
           AND ip_address = $1
           AND created_at >= NOW() - ($2 || ' minutes')::interval`,
        [ipAddress || 'unknown', String(windowMinutes)]
      );
      return rows[0].total;
    },
  });
}
