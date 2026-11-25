import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createDbPool } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { runMigrations } from '../../scripts/migrate.js';
import { validateIntegrationTestConfig } from './dbGuard.js';

const guard = validateIntegrationTestConfig();

if (guard.unsafe) {
  throw new Error(`EJECUCIÓN ABORTADA POR SEGURIDAD: ${guard.reason}`);
}

async function probePostgres(url) {
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
    const detail =
      err.message ||
      (Array.isArray(err.errors) ? err.errors.map((e) => e.message || e.code).join('; ') : err.code || String(err));
    return { ok: false, reason: `PostgreSQL de pruebas no accesible: ${detail}` };
  }
}

const pgStatus = guard.run ? await probePostgres(guard.url) : { ok: false, reason: guard.reason };

if (!pgStatus.ok) {
  console.warn(`[integracion-pg] Suite NO ejecutada: ${pgStatus.reason}`);
}

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Integración con PostgreSQL real (base desechable)', { skip: !pgStatus.ok ? pgStatus.reason : false }, () => {
  let pool;
  let baseConfig;

  before(async () => {
    pool = pgStatus.pool;
    await runMigrations(pool);

    const keyV1 = randomBytes(32);
    baseConfig = Object.freeze({
      nodeEnv: 'test',
      isProduction: false,
      isTest: true,
      port: 3001,
      appOrigin: 'http://localhost:5173',
      trustProxy: 0,
      databaseUrl: guard.url,
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

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE TABLE diary_entries, sessions, password_reset_tokens, security_audit_logs, rate_limits, users RESTART IDENTITY CASCADE'
    );
  });

  after(async () => {
    if (pool) await pool.end();
  });

  it('persiste entradas cifradas tras reiniciar la instancia del servidor y no guarda texto plano en PostgreSQL', async () => {
    const app1 = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
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
    const app2 = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
    const afterRestart = await request(app2)
      .get('/api/diary')
      .set('Cookie', reg.headers['set-cookie']);
    assert.equal(afterRestart.status, 200);
    assert.equal(afterRestart.body.entries.length, 1);
    assert.equal(afterRestart.body.entries[0].title, 'Persistencia real');
  });

  it('Prioridad 2 (determinista): impide que un login concurrente emita sesión si la contraseña se restablece antes de emitirla', async () => {
    const sentEmails = [];
    const loginPaused = createDeferred();
    const releaseLogin = createDeferred();
    let hookArmed = false;

    const app = createApp({
      config: baseConfig,
      logger: createLogger('silent'),
      pool,
      mailerOverride: {
        async sendPasswordResetEmail(msg) {
          sentEmails.push(msg);
          return { delivered: true, driver: 'test' };
        },
      },
      serviceHooks: {
        auth: {
          async beforeLoginSessionTx() {
            if (!hookArmed) return;
            hookArmed = false;
            loginPaused.resolve();
            await releaseLogin.promise;
          },
        },
      },
    });

    const reg = await request(app).post('/api/auth/register').send({
      name: 'Carrera Auth',
      email: 'carrera@ejemplo.com',
      password: 'Clave!Original2026',
    });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;

    // Solicita recuperación para obtener token válido
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'carrera@ejemplo.com' });
    assert.equal(forgot.status, 200);
    const token = new URL(sentEmails[0].resetUrl).searchParams.get('token');

    // Lanza login con contraseña anterior y lo pausa exactamente entre Argon2id y la transacción de sesión
    hookArmed = true;
    const loginPromise = request(app)
      .post('/api/auth/login')
      .send({
        email: 'carrera@ejemplo.com',
        password: 'Clave!Original2026',
      })
      .then((res) => res);

    await loginPaused.promise;

    // Mientras el login está pausado, el usuario restablece su contraseña
    const resetRes = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'Clave!NuevaSegura2026',
    });
    assert.equal(resetRes.status, 200);

    // Libera el login concurrente: debe fallar con 401 y no emitir sesión
    releaseLogin.resolve();
    const loginRes = await loginPromise;
    assert.equal(loginRes.status, 401);
    assert.equal(loginRes.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(loginRes.headers['set-cookie'], undefined);

    // Verifica directamente en PostgreSQL que no quedó ninguna sesión activa
    const { rows: activeSessions } = await pool.query('SELECT COUNT(*)::int AS total FROM sessions WHERE user_id = $1', [
      userId,
    ]);
    assert.equal(activeSessions[0].total, 0);
  });

  it('Prioridad 3: incrementa atómicamente intentos fallidos concurrentes, responde HTTP 429 y persiste alerta', async () => {
    const app = createApp({
      config: { ...baseConfig, loginMaxAttempts: 5, alertFailedLoginsThreshold: 5 },
      logger: createLogger('silent'),
      pool,
    });

    const reg = await request(app).post('/api/auth/register').send({
      name: 'Fuerza Bruta',
      email: 'bruta@ejemplo.com',
      password: 'Clave!Correcta2026',
    });
    assert.equal(reg.status, 201);
    const userId = reg.body.user.id;

    // 5 intentos fallidos simultáneos
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/auth/login').send({
          email: 'bruta@ejemplo.com',
          password: 'Clave!Equivocada2026',
        })
      )
    );

    const statusCodes = responses.map((r) => r.status);
    assert.ok(statusCodes.includes(429), `Se esperaba al menos un HTTP 429; obtenidos: ${statusCodes.join(',')}`);
    const lockedResponse = responses.find((r) => r.status === 429);
    assert.ok(lockedResponse.headers['retry-after']);

    // Verifica en PostgreSQL que NO se perdió ningún incremento
    const { rows: userRows } = await pool.query(
      'SELECT failed_login_attempts, locked_until FROM users WHERE id = $1',
      [userId]
    );
    assert.equal(userRows[0].failed_login_attempts, 5);
    assert.ok(userRows[0].locked_until && new Date(userRows[0].locked_until).getTime() > Date.now());

    const { rows: alerts } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM security_audit_logs
       WHERE target_user_id = $1 AND event_type = 'brute_force_alert' AND severity = 'alert'`,
      [userId]
    );
    assert.ok(alerts[0].total >= 1);
  });

  it('Prioridad 4: serializa degradaciones simultáneas de administradores, conserva >= 1 admin y revoca sesiones', async () => {
    const app = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
    const admin1 = request.agent(app);
    const admin2 = request.agent(app);

    const r1 = await admin1.post('/api/auth/register').send({
      name: 'Admin Uno',
      email: 'admin1@ejemplo.com',
      password: 'Admin1!Password2026',
    });
    const r2 = await admin2.post('/api/auth/register').send({
      name: 'Admin Dos',
      email: 'admin2@ejemplo.com',
      password: 'Admin2!Password2026',
    });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);

    await pool.query(`UPDATE users SET role = 'admin' WHERE id IN ($1, $2)`, [r1.body.user.id, r2.body.user.id]);

    // Ambos administradores intentan degradarse simultáneamente
    const [res1, res2] = await Promise.all([
      admin1
        .patch(`/api/admin/users/${r2.body.user.id}/role`)
        .set('X-CSRF-Token', r1.body.csrfToken)
        .send({ role: 'user', currentPassword: 'Admin1!Password2026', confirmed: true }),
      admin2
        .patch(`/api/admin/users/${r1.body.user.id}/role`)
        .set('X-CSRF-Token', r2.body.csrfToken)
        .send({ role: 'user', currentPassword: 'Admin2!Password2026', confirmed: true }),
    ]);

    const statuses = [res1.status, res2.status].sort((a, b) => a - b);
    assert.equal(statuses[0], 200, `Exactamente una degradación debe aprobarse; statuses=${statuses}`);
    assert.ok(
      statuses[1] === 403 || statuses[1] === 409,
      `La segunda degradación concurrente debe rechazarse con 403 o 409; status=${statuses[1]}`
    );

    const { rows: adminCountRows } = await pool.query(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'`);
    assert.equal(adminCountRows[0].total, 1, 'Debe permanecer exactamente 1 administrador activo');

    // La sesión del administrador degradado debe haber sido revocada
    const demotedAgent = res1.status === 200 ? admin2 : admin1;
    const afterDemote = await demotedAgent.get('/api/admin/users');
    assert.equal(afterDemote.status, 401);
  });

  it('Prioridad 4 (determinista): rechaza cambio de rol si los privilegios del actor son revocados durante la operación', async () => {
    const actorPaused = createDeferred();
    const releaseActor = createDeferred();
    let armedActorId = null;

    const app = createApp({
      config: baseConfig,
      logger: createLogger('silent'),
      pool,
      serviceHooks: {
        admin: {
          async beforeRoleChangeTx({ actorId }) {
            if (actorId !== armedActorId) return;
            armedActorId = null;
            actorPaused.resolve();
            await releaseActor.promise;
          },
        },
      },
    });

    const adminA = request.agent(app);
    const adminB = request.agent(app);
    const regularUser = request.agent(app);

    const rA = await adminA.post('/api/auth/register').send({
      name: 'Admin A',
      email: 'admin-a@ejemplo.com',
      password: 'AdminA!Password2026',
    });
    const rB = await adminB.post('/api/auth/register').send({
      name: 'Admin B',
      email: 'admin-b@ejemplo.com',
      password: 'AdminB!Password2026',
    });
    const rU = await regularUser.post('/api/auth/register').send({
      name: 'Usuario Normal',
      email: 'normal@ejemplo.com',
      password: 'Normal!Password2026',
    });

    await pool.query(`UPDATE users SET role = 'admin' WHERE id IN ($1, $2)`, [rA.body.user.id, rB.body.user.id]);

    // Admin A intenta promover al usuario normal, pero se pausa tras pasar reautenticación
    armedActorId = rA.body.user.id;
    const promotePromise = adminA
      .patch(`/api/admin/users/${rU.body.user.id}/role`)
      .set('X-CSRF-Token', rA.body.csrfToken)
      .send({ role: 'admin', currentPassword: 'AdminA!Password2026', confirmed: true })
      .then((res) => res);

    await actorPaused.promise;

    // Mientras tanto, Admin B degrada a Admin A
    const demoteA = await adminB
      .patch(`/api/admin/users/${rA.body.user.id}/role`)
      .set('X-CSRF-Token', rB.body.csrfToken)
      .send({ role: 'user', currentPassword: 'AdminB!Password2026', confirmed: true });
    assert.equal(demoteA.status, 200);

    // Al reanudar Admin A, debe ser rechazado con 403 dentro de la transacción
    releaseActor.resolve();
    const promoteRes = await promotePromise;
    assert.equal(promoteRes.status, 403);
    assert.equal(promoteRes.body.error.code, 'FORBIDDEN');

    const { rows: targetRows } = await pool.query('SELECT role FROM users WHERE id = $1', [rU.body.user.id]);
    assert.equal(targetRows[0].role, 'user', 'El usuario objetivo no debe haber sido promovido');
  });
});
