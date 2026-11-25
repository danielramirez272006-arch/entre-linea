import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createDbPool, withTransaction } from '../../src/db/pool.js';
import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createCryptoService } from '../../src/security/crypto.js';
import { createUsersRepository } from '../../src/repositories/usersRepository.js';
import { createDiaryRepository } from '../../src/repositories/diaryRepository.js';
import { runMigrations } from '../../scripts/migrate.js';
import { validateIntegrationTestConfig } from './dbGuard.js';

const guard = validateIntegrationTestConfig();
const requireIntegrationDb = process.env.CI === 'true' || process.env.REQUIRE_INTEGRATION_DB === 'true';

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
  if (requireIntegrationDb) {
    throw new Error(`INTEGRACIÓN OBLIGATORIA EN CI FALLIDA: ${pgStatus.reason}`);
  }
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

  it('Correo local real: guarda archivo .txt en DEV_MAIL_DIR y completa restablecimiento de contraseña', async () => {
    const tmpMailDir = await fs.mkdtemp(path.join(os.tmpdir(), 'entre-lineas-mail-'));
    try {
      const app = createApp({
        config: { ...baseConfig, mailDriver: 'local', devMailDir: tmpMailDir },
        logger: createLogger('silent'),
        pool,
      });

      const reg = await request(app).post('/api/auth/register').send({
        name: 'Correo Local',
        email: 'correo@ejemplo.com',
        password: 'Clave!Inicial2026',
      });
      assert.equal(reg.status, 201);

      const forgot = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'correo@ejemplo.com' });
      assert.equal(forgot.status, 200);

      const files = await fs.readdir(tmpMailDir);
      assert.equal(files.length, 1);
      const emailContent = await fs.readFile(path.join(tmpMailDir, files[0]), 'utf8');
      const urlMatch = emailContent.match(/http:\/\/localhost:5173\/restablecer\?token=([0-9a-f]{64})/);
      assert.ok(urlMatch, 'El correo guardado debe contener el enlace con token de 64 hex');

      const reset = await request(app).post('/api/auth/reset-password').send({
        token: urlMatch[1],
        newPassword: 'Clave!Restablecida2026',
      });
      assert.equal(reset.status, 200);

      const loginNew = await request(app).post('/api/auth/login').send({
        email: 'correo@ejemplo.com',
        password: 'Clave!Restablecida2026',
      });
      assert.equal(loginNew.status, 200);
    } finally {
      await fs.rm(tmpMailDir, { recursive: true, force: true });
    }
  });

  it('Rotación de llaves real (v1 -> v2) en PostgreSQL preserva lectura de entradas y perfil', async () => {
    const keyV1 = baseConfig.encryptionKeys.get('v1');
    const keyV2 = randomBytes(32);

    const appV1 = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
    const agent = request.agent(appV1);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Rotación PG',
      email: 'rotacion@ejemplo.com',
      password: 'Clave!Rotacion2026',
    });
    assert.equal(reg.status, 201);

    await agent
      .put('/api/profile')
      .set('X-CSRF-Token', reg.body.csrfToken)
      .send({ name: 'Rotación PG', phone: '+506 8888-7777', sensitiveNote: 'DATO-V1-99' });

    const created = await agent
      .post('/api/diary')
      .set('X-CSRF-Token', reg.body.csrfToken)
      .send({
        title: 'Antes de rotar',
        entryDate: '2026-11-25',
        category: 'recuerdos',
        mood: 'tranquilo',
        content: 'Contenido cifrado inicialmente con v1.',
      });
    assert.equal(created.status, 201);

    // Re-cifra registros de v1 hacia v2 en PostgreSQL
    const cryptoV2 = createCryptoService({
      activeKeyVersion: 'v2',
      encryptionKeys: new Map([
        ['v1', keyV1],
        ['v2', keyV2],
      ]),
    });
    const diaryRepo = createDiaryRepository(pool);
    const usersRepo = createUsersRepository(pool);

    await withTransaction(pool, async (client) => {
      const outdatedEntries = await diaryRepo.listWithOutdatedKeyVersion('v2', client);
      assert.equal(outdatedEntries.length, 1);
      for (const row of outdatedEntries) {
        const plainTitle = cryptoV2.decryptField(
          { ciphertext: row.title_ciphertext, iv: row.title_iv, tag: row.title_tag, keyVersion: row.key_version },
          { ownerId: row.owner_id, recordId: row.id, field: 'title' }
        );
        const plainContent = cryptoV2.decryptField(
          { ciphertext: row.content_ciphertext, iv: row.content_iv, tag: row.content_tag, keyVersion: row.key_version },
          { ownerId: row.owner_id, recordId: row.id, field: 'content' }
        );
        await diaryRepo.updateReencryptedEntry(
          {
            id: row.id,
            ownerId: row.owner_id,
            titleCrypto: cryptoV2.encryptField(plainTitle, { ownerId: row.owner_id, recordId: row.id, field: 'title', keyVersion: 'v2' }),
            contentCrypto: cryptoV2.encryptField(plainContent, { ownerId: row.owner_id, recordId: row.id, field: 'content', keyVersion: 'v2' }),
            keyVersion: 'v2',
          },
          client
        );
      }

      const outdatedUsers = await usersRepo.listWithOutdatedKeyVersion('v2', client);
      assert.equal(outdatedUsers.length, 1);
      for (const u of outdatedUsers) {
        const plainPhone = cryptoV2.decryptField(
          { ciphertext: u.phone_ciphertext, iv: u.phone_iv, tag: u.phone_tag, keyVersion: u.phone_key_version },
          { ownerId: u.id, recordId: u.id, field: 'phone' }
        );
        const plainNote = cryptoV2.decryptField(
          { ciphertext: u.sensitive_note_ciphertext, iv: u.sensitive_note_iv, tag: u.sensitive_note_tag, keyVersion: u.sensitive_note_key_version },
          { ownerId: u.id, recordId: u.id, field: 'sensitive_note' }
        );
        await usersRepo.updateReencryptedFields(
          {
            id: u.id,
            phoneCrypto: cryptoV2.encryptField(plainPhone, { ownerId: u.id, recordId: u.id, field: 'phone', keyVersion: 'v2' }),
            sensitiveNoteCrypto: cryptoV2.encryptField(plainNote, { ownerId: u.id, recordId: u.id, field: 'sensitive_note', keyVersion: 'v2' }),
          },
          client
        );
      }
    });

    // Instancia nueva solo con v2 (sin v1) debe descifrar todo correctamente
    const appOnlyV2 = createApp({
      config: { ...baseConfig, activeKeyVersion: 'v2', encryptionKeys: new Map([['v2', keyV2]]) },
      logger: createLogger('silent'),
      pool,
    });
    const cookie = reg.headers['set-cookie'];
    const entriesRes = await request(appOnlyV2).get('/api/diary').set('Cookie', cookie);
    assert.equal(entriesRes.status, 200);
    assert.equal(entriesRes.body.entries[0].title, 'Antes de rotar');
    assert.equal(entriesRes.body.entries[0].keyVersion, 'v2');

    const profRes = await request(appOnlyV2).get('/api/profile').set('Cookie', cookie);
    assert.equal(profRes.status, 200);
    assert.equal(profRes.body.profile.phoneMasked, '•••• •••• 7777');
    assert.equal(profRes.body.profile.phoneKeyVersion, 'v2');
  });

  it('Límite concurrente de 100 entradas en PostgreSQL real con FOR UPDATE', async () => {
    const app = createApp({
      config: { ...baseConfig, rateLimitMaxRequests: 500 },
      logger: createLogger('silent'),
      pool,
    });
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Límite 100',
      email: 'limite100@ejemplo.com',
      password: 'Clave!Limite2026',
    });
    assert.equal(reg.status, 201);
    const csrf = reg.body.csrfToken;

    for (let i = 0; i < 99; i += 1) {
      const r = await agent
        .post('/api/diary')
        .set('X-CSRF-Token', csrf)
        .send({
          title: `Nota ${i}`,
          entryDate: '2026-11-25',
          category: 'personal',
          mood: 'normal',
          content: `Contenido ${i}`,
        });
      assert.equal(r.status, 201);
    }

    // 3 solicitudes simultáneas cuando solo queda 1 cupo disponible
    const race = await Promise.all(
      [1, 2, 3].map((n) =>
        agent
          .post('/api/diary')
          .set('X-CSRF-Token', csrf)
          .send({
            title: `Carrera ${n}`,
            entryDate: '2026-11-25',
            category: 'metas',
            mood: 'bien',
            content: 'Prueba concurrente en PostgreSQL real.',
          })
      )
    );

    assert.equal(race.filter((r) => r.status === 201).length, 1);
    assert.equal(race.filter((r) => r.status === 409).length, 2);

    const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM diary_entries WHERE owner_id = $1', [
      reg.body.user.id,
    ]);
    assert.equal(rows[0].total, 100);
  });

  it('Aislamiento por propietario y bitácora de accesos denegados en PostgreSQL real (persiste tras rollback)', async () => {
    const app = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    const rA = await agentA.post('/api/auth/register').send({
      name: 'Propietario A',
      email: 'propa@ejemplo.com',
      password: 'Clave!PropA2026',
    });
    const rB = await agentB.post('/api/auth/register').send({
      name: 'Propietario B',
      email: 'propb@ejemplo.com',
      password: 'Clave!PropB2026',
    });

    const entryB = await agentB
      .post('/api/diary')
      .set('X-CSRF-Token', rB.body.csrfToken)
      .send({
        title: 'Privado de B',
        entryDate: '2026-11-25',
        category: 'personal',
        mood: 'bien',
        content: 'Secreto exclusivo de B.',
      });
    const entryIdB = entryB.body.entry.id;

    assert.equal((await agentA.get(`/api/diary/${entryIdB}`)).status, 404);
    assert.equal(
      (
        await agentA
          .put(`/api/diary/${entryIdB}`)
          .set('X-CSRF-Token', rA.body.csrfToken)
          .send({
            title: 'Editado por A',
            entryDate: '2026-11-25',
            category: 'personal',
            mood: 'bien',
            content: 'No autorizado',
            version: 1,
          })
      ).status,
      404
    );
    assert.equal((await agentA.delete(`/api/diary/${entryIdB}`).set('X-CSRF-Token', rA.body.csrfToken)).status, 404);
    assert.equal((await agentA.get('/api/admin/audit-logs')).status, 403);

    const { rows: logs } = await pool.query(
      `SELECT details FROM security_audit_logs
       WHERE actor_user_id = $1 AND event_type = 'diary_access_denied'`,
      [rA.body.user.id]
    );
    assert.equal(logs.length, 3);
    assert.deepEqual(logs.map((r) => r.details.action).sort(), ['delete', 'read', 'update']);
  });

  it('Consumo simultáneo del mismo token de recuperación en PostgreSQL real: exactamente 1 éxito', async () => {
    const sentEmails = [];
    const app = createApp({
      config: baseConfig,
      logger: createLogger('silent'),
      pool,
      mailerOverride: {
        async sendPasswordResetEmail(msg) {
          sentEmails.push(msg);
          return { delivered: true };
        },
      },
    });

    await request(app).post('/api/auth/register').send({
      name: 'Token Concurrente',
      email: 'tokconc@ejemplo.com',
      password: 'Clave!Inicial2026',
    });

    await request(app).post('/api/auth/forgot-password').send({ email: 'tokconc@ejemplo.com' });
    const token = new URL(sentEmails[0].resetUrl).searchParams.get('token');

    const attempts = await Promise.all(
      [1, 2, 3].map((i) =>
        request(app).post('/api/auth/reset-password').send({
          token,
          newPassword: `Clave!Nueva${i}Segura2026`,
        })
      )
    );

    assert.equal(attempts.filter((r) => r.status === 200).length, 1);
    assert.equal(attempts.filter((r) => r.status === 400).length, 2);
  });

  it('Conflictos de edición concurrente mediante versión en PostgreSQL real (409 VERSION_CONFLICT)', async () => {
    const app = createApp({ config: baseConfig, logger: createLogger('silent'), pool });
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Conflicto Version',
      email: 'conflicto@ejemplo.com',
      password: 'Clave!Conflicto2026',
    });
    const csrf = reg.body.csrfToken;

    const created = await agent
      .post('/api/diary')
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Original v1',
        entryDate: '2026-11-25',
        category: 'gratitud',
        mood: 'tranquilo',
        content: 'Texto inicial.',
      });
    const entryId = created.body.entry.id;

    const [edit1, edit2] = await Promise.all([
      agent
        .put(`/api/diary/${entryId}`)
        .set('X-CSRF-Token', csrf)
        .send({
          title: 'Pestaña A',
          entryDate: '2026-11-25',
          category: 'gratitud',
          mood: 'bien',
          content: 'Edición A',
          version: 1,
        }),
      agent
        .put(`/api/diary/${entryId}`)
        .set('X-CSRF-Token', csrf)
        .send({
          title: 'Pestaña B',
          entryDate: '2026-11-25',
          category: 'gratitud',
          mood: 'normal',
          content: 'Edición B',
          version: 1,
        }),
    ]);

    const statuses = [edit1.status, edit2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [200, 409]);
    const conflictRes = edit1.status === 409 ? edit1 : edit2;
    assert.equal(conflictRes.body.error.code, 'VERSION_CONFLICT');
    assert.equal(conflictRes.body.error.details.currentEntry.version, 2);
  });
});
