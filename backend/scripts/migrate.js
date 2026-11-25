import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../src/config/env.js';
import { createDbPool, withTransaction } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../src/db/migrations');

export async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const files = (await fs.readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const { rows: appliedRows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.version));

  const executed = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    await withTransaction(pool, async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
    });
    executed.push(file);
  }

  return executed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const pool = createDbPool(config);
  runMigrations(pool)
    .then((executed) => {
      if (executed.length === 0) {
        console.log('Migraciones al día. No había archivos pendientes.');
      } else {
        console.log('Migraciones aplicadas:', executed.join(', '));
      }
      return pool.end();
    })
    .catch(async (err) => {
      const detail =
        err.message ||
        (Array.isArray(err.errors) ? err.errors.map((e) => e.message || e.code).join('; ') : err.code || String(err));
      console.error('Error al ejecutar migraciones:', detail);
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
