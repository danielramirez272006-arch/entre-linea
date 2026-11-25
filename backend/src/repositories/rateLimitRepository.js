export function createRateLimitRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async consumeHit(bucketKey, windowMs, client) {
      const nextReset = new Date(Date.now() + windowMs);
      const { rows } = await exec(client).query(
        `INSERT INTO rate_limits (bucket_key, hit_count, window_reset_at, updated_at)
         VALUES ($1, 1, $2, NOW())
         ON CONFLICT (bucket_key) DO UPDATE
         SET hit_count = CASE
               WHEN rate_limits.window_reset_at <= NOW() THEN 1
               ELSE rate_limits.hit_count + 1
             END,
             window_reset_at = CASE
               WHEN rate_limits.window_reset_at <= NOW() THEN $2
               ELSE rate_limits.window_reset_at
             END,
             updated_at = NOW()
         RETURNING hit_count, window_reset_at`,
        [bucketKey, nextReset]
      );
      return {
        hitCount: rows[0].hit_count,
        windowResetAt: new Date(rows[0].window_reset_at),
      };
    },
  });
}
