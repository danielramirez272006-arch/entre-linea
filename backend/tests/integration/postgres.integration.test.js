import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createDbPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { runMigrations } from '../../scripts/migrate.js';

const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

async function checkPostgres(url) {
  if (!url) return { ok: false, reason: 'TEST_DATABASE_URL / DATABASE_URL no configurado.' };
  const probePool = createDbPool({
    databaseUrl: url,
    dbQueryTimeoutMs: 3000,
    dbStatementTimeoutMs: 3000,
  });
  try {
    await probePool.query('SELECT 1');
    return { ok: true, pool: probePool };
  } catch (err) {
    await probePool.end().catch(() => {});
    return { ok: false, reason: `PostgreSQL no accesible: ${err.message}` };
  }
}

const pgStatus = await checkPostgres(testDbUrl);

describe('Integración con PostgreSQL real', { skip: !pgStatus.ok ? pgStatus.reason : false }, () => {
  let pool;
  let config;

  before(async () => {
    pool = pgStatus.pool;
    await runMigrations(pool);
    await pool.query(
      'TRUNCATE TABLE diary_entries, sessions, password_reset_tokens, security_audit_logs, rate_limits, users RESTART IDENTITY CASCADE'
    );

    const keyV1 = randomBytes(32);
    config = Object.freeze({
      nodeEnv: 'test',
      isProduction: false,
      isTest: true,
      port: 3001,
      appOrigin: 'http://localhost:5173',
      trustProxy: 0,
      databaseUrl: testDbUrl,
      dbQueryTimeoutMs: 5000,
      dbStatementTimeoutMs: 5000,
      sessionCookieName: 'el_sid',
      sessionTtlMs: 60 * 60 * 1000,
      sessionAbsoluteTtlMs: 24 * 60 * 60 * 1000,
      activeKeyVersion: 'v1',
      encryptionKeys: new Map([['v1', keyV1]]),
      passwordResetTtlMs: 15 * 60 * 1000,
      mailDriver: 'local',
      devMailDir: 'backend/.dev-mail',
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 300,
      loginMaxAttempts: 5,
      loginLockoutBaseSeconds: 60,
      alertFailedLoginsThreshold: 5,
      logLevel: 'silent',
    });
  });

  after(async () => {
    if (pool) await pool.end();
  });

  it('persiste entradas cifradas tras reiniciar la instancia del servidor y no guarda texto plano en PostgreSQL', async () => {
    const app1 = createApp({ config, logger: createLogger('silent'), pool });
    const agent = request.agent(app1);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Sofía Real',
      email: 'sofia@ejemplo.com',
      password: 'Clave!RealPg2026',
    });
    assert.equal(reg.status, 201);

    const created = await agent
      .post('/api/diary')
      .set('X-CSRF-Token', reg.body.csrfToken)
      .send({
        title: 'Persistencia real',
        entryDate: '2026-11-25',
        category: 'personal',
        mood: 'tranquilo',
        content: 'Texto confidencial verificado en PostgreSQL real.',
      });
    assert.equal(created.status, 201);

    // Comprobación directa en PostgreSQL: sin texto claro y hash Argon2id
    const { rows: userRows } = await pool.query('SELECT password_hash FROM users WHERE email = $1', [
      'sofia@ejemplo.com',
    ]);
    assert.match(userRows[0].password_hash, /^\$argon2id\$/);

    const { rows: entryRows } = await pool.query(
      'SELECT title_ciphertext, content_ciphertext FROM diary_entries WHERE id = $1',
      [created.body.entry.id]
    );
    assert.equal(entryRows[0].title_ciphertext.toString('utf8').includes('Persistencia'), false);
    assert.equal(entryRows[0].content_ciphertext.toString('utf8').includes('confidencial'), false);

    // Simula reinicio completo del servidor con nueva instancia de Express
    const app2 = createApp({ config, logger: createLogger('silent'), pool });
    const afterRestart = await request(app2)
      .get('/api/diary')
      .set('Cookie', reg.headers['set-cookie']);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.entries.length, 1);
    assert.equal(afterRestart.body.entries[0].title, 'Persistencia real');
  });
});
