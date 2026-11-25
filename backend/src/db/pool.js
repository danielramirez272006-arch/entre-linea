import pg from 'pg';

const { Pool } = pg;

export function createDbPool(config, logger) {
  if (!config.databaseUrl) {
    throw new Error('DATABASE_URL es obligatorio para conectar con PostgreSQL.');
  }

  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    query_timeout: config.dbQueryTimeoutMs,
    statement_timeout: config.dbStatementTimeoutMs,
  });

  pool.on('error', (err) => {
    logger?.error({ err: { message: err.message, code: err.code } }, 'Error inesperado en pool de PostgreSQL');
  });

  return pool;
}

export async function withTransaction(pool, workFn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await workFn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Si el rollback falla por conexión rota, preservamos el error original.
    }
    throw err;
  } finally {
    client.release();
  }
}
