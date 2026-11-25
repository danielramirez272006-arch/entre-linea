import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { createMailer } from '../../src/mail/mailer.js';
import { createAuthService } from '../../src/services/authService.js';
import { createInMemoryTestStore } from './mockStore.js';

function createCapturingLogger() {
  const records = [];
  const push = (level) => (obj, msg) => records.push({ level, obj, msg });
  return {
    records,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    fatal: push('fatal'),
    debug: push('debug'),
  };
}

function createHarness({ mailerOverride, logger }) {
  const store = createInMemoryTestStore();
  const keyV1 = randomBytes(32);
  const config = Object.freeze({
    nodeEnv: 'test',
    isProduction: false,
    isTest: true,
    port: 3001,
    appOrigin: 'http://localhost:5173',
    trustProxy: 0,
    sessionCookieName: 'el_sid',
    sessionTtlMs: 3600_000,
    sessionAbsoluteTtlMs: 86400_000,
    activeKeyVersion: 'v1',
    encryptionKeys: new Map([['v1', keyV1]]),
    passwordResetTtlMs: 15 * 60 * 1000,
    mailDriver: 'https-api',
    mailApiUrl: 'https://mail.proveedor.ejemplo/v1/send',
    mailApiKey: 'SUPER_SECRET_PROVIDER_API_KEY_12345',
    mailFrom: 'no-responder@entre-lineas.local',
    mailTimeoutMs: 40,
    devMailDir: 'backend/.dev-mail',
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 200,
    loginMaxAttempts: 5,
    loginLockoutBaseSeconds: 30,
    alertFailedLoginsThreshold: 5,
    logLevel: 'silent',
  });

  const app = createApp({
    config,
    logger,
    repositories: store.repositories,
    withTxOverride: store.withTx,
    mailerOverride,
  });

  return { app, store, config };
}

describe('Recuperación de contraseña y resiliencia del proveedor de correo', () => {
  it('devuelve la misma respuesta genérica 200 para correo inexistente y existente', async () => {
    const logger = createCapturingLogger();
    const sent = [];
    const { app } = createHarness({
      logger,
      mailerOverride: {
        async sendPasswordResetEmail(msg) {
          sent.push(msg);
          return { delivered: true };
        },
      },
    });

    await request(app).post('/api/auth/register').send({
      name: 'Usuario Real',
      email: 'real@ejemplo.com',
      password: 'Clave!Segura2026',
    });

    const resUnknown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'noexiste@ejemplo.com' });
    const resKnown = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'real@ejemplo.com' });

    assert.equal(resUnknown.status, 200);
    assert.equal(resKnown.status, 200);
    assert.deepEqual(resUnknown.body, resKnown.body);
    assert.equal(sent.length, 1);
  });

  it('ante fallo HTTP 500 del proveedor devuelve 200 genérico, invalida el token y no filtra secretos en logs', async () => {
    const logger = createCapturingLogger();
    let capturedBody = null;
    const mailer = createMailer(
      {
        mailDriver: 'https-api',
        mailApiUrl: 'https://mail.proveedor.ejemplo/v1/send',
        mailApiKey: 'SUPER_SECRET_PROVIDER_API_KEY_12345',
        mailFrom: 'no-responder@entre-lineas.local',
        mailTimeoutMs: 100,
      },
      logger,
      {
        fetchImpl: async (_url, init) => {
          capturedBody = JSON.parse(init.body);
          return { ok: false, status: 503 };
        },
      }
    );

    const { app } = createHarness({ logger, mailerOverride: mailer });
    await request(app).post('/api/auth/register').send({
      name: 'Fallo Proveedor',
      email: 'fallo@ejemplo.com',
      password: 'Clave!Segura2026',
    });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'fallo@ejemplo.com' });

    assert.equal(res.status, 200);
    assert.match(res.body.message, /Si el correo está registrado/);

    // El token que no pudo entregarse debe haber sido invalidado
    const tokenMatch = capturedBody.text.match(/token=([0-9a-f]{64})/);
    assert.ok(tokenMatch);
    const resetAttempt = await request(app).post('/api/auth/reset-password').send({
      token: tokenMatch[1],
      newPassword: 'Otra!ClaveSegura2026',
    });
    assert.equal(resetAttempt.status, 400);

    // Ningún secreto, correo ni token en logs ni en respuesta
    const serializedLogs = JSON.stringify(logger.records);
    assert.equal(serializedLogs.includes('fallo@ejemplo.com'), false);
    assert.equal(serializedLogs.includes(tokenMatch[1]), false);
    assert.equal(serializedLogs.includes('SUPER_SECRET_PROVIDER_API_KEY_12345'), false);
    assert.equal(serializedLogs.includes('/restablecer?token='), false);
    assert.equal(JSON.stringify(res.body).includes(tokenMatch[1]), false);
  });

  it('aborta la petición HTTPS al vencer timeout, devuelve 200 genérico e invalida el token', async () => {
    const logger = createCapturingLogger();
    let aborted = false;
    let capturedToken = null;

    const mailer = createMailer(
      {
        mailDriver: 'https-api',
        mailApiUrl: 'https://mail.proveedor.ejemplo/v1/send',
        mailApiKey: 'SUPER_SECRET_PROVIDER_API_KEY_12345',
        mailFrom: 'no-responder@entre-lineas.local',
        mailTimeoutMs: 30,
      },
      logger,
      {
        fetchImpl: (_url, init) =>
          new Promise((_resolve, reject) => {
            const parsed = JSON.parse(init.body);
            capturedToken = parsed.text.match(/token=([0-9a-f]{64})/)?.[1] || null;
            init.signal.addEventListener('abort', () => {
              aborted = true;
              const err = new Error('Aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }),
      }
    );

    const { app } = createHarness({ logger, mailerOverride: mailer });
    await request(app).post('/api/auth/register').send({
      name: 'Timeout User',
      email: 'timeout@ejemplo.com',
      password: 'Clave!Segura2026',
    });

    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'timeout@ejemplo.com' });

    assert.equal(res.status, 200);
    assert.equal(aborted, true, 'El timeout debe abortar explícitamente la petición HTTPS');
    assert.ok(capturedToken);

    const resetAttempt = await request(app).post('/api/auth/reset-password').send({
      token: capturedToken,
      newPassword: 'Otra!ClaveSegura2026',
    });
    assert.equal(resetAttempt.status, 400);
  });

  it('solicitudes concurrentes: el fallo de entrega de la solicitud A no invalida el token nuevo de la solicitud B', async () => {
    const logger = createCapturingLogger();
    let callCount = 0;
    let releaseFirstFailure;
    const firstPaused = new Promise((r) => {
      releaseFirstFailure = r;
    });
    let firstStartedResolve;
    const firstStarted = new Promise((r) => {
      firstStartedResolve = r;
    });
    let secondToken = null;

    const { app } = createHarness({
      logger,
      mailerOverride: {
        async sendPasswordResetEmail(msg) {
          callCount += 1;
          if (callCount === 1) {
            firstStartedResolve();
            await firstPaused;
            const err = new Error('Provider down');
            err.code = 'MAIL_PROVIDER_ERROR';
            throw err;
          }
          secondToken = new URL(msg.resetUrl).searchParams.get('token');
          return { delivered: true };
        },
      },
    });

    await request(app).post('/api/auth/register').send({
      name: 'Concurrente Mail',
      email: 'conc@ejemplo.com',
      password: 'Clave!Segura2026',
    });

    // Solicitud A inicia y se pausa en el proveedor de correo
    const reqA = request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'conc@ejemplo.com' })
      .then((r) => r);

    await firstStarted;

    // Solicitud B llega concurrentemente y entrega exitosamente el token nuevo
    const resB = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'conc@ejemplo.com' });
    assert.equal(resB.status, 200);
    assert.ok(secondToken);

    // Ahora falla la entrega de la solicitud A
    releaseFirstFailure();
    const resA = await reqA;
    assert.equal(resA.status, 200);

    // El token B debe seguir completamente válido y usable
    const resetOk = await request(app).post('/api/auth/reset-password').send({
      token: secondToken,
      newPassword: 'Nueva!ClaveValida2026',
    });
    assert.equal(resetOk.status, 200);
  });
});


it('en producción sin correo real rechaza recuperación antes de consultar cuentas o generar tokens', async () => {
  let consulted = false;
  const service = createAuthService({
    config: { isProduction: true, mailDriver: 'local' },
    usersRepo: { async findByEmail() { consulted = true; throw new Error('No debe consultarse la cuenta'); } },
  });
  await assert.rejects(
    service.requestPasswordReset({ email: 'persona@ejemplo.test' }, {}),
    (err) => err.statusCode === 503 && err.code === 'RECOVERY_UNAVAILABLE'
  );
  assert.equal(consulted, false);
});


it('envía a Brevo con api-key y su contrato de correo transaccional, sin llamadas reales', async () => {
  let sent;
  const mailer = createMailer({
    mailDriver: 'https-api', mailApiUrl: 'https://api.brevo.com/v3/smtp/email',
    mailApiKey: 'dummy-key-for-test-only', mailFrom: 'sender@example.test',
  }, null, { fetchImpl: async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 201 };
  }});
  await mailer.sendPasswordResetEmail({ to: 'recipient@example.test', name: 'Prueba', resetUrl: 'https://example.test/restablecer?token=dummy', expiresMinutes: 15 });
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(sent.options.headers['api-key'], 'dummy-key-for-test-only');
  assert.equal(sent.options.headers.Authorization, undefined);
  assert.equal(sent.options.redirect, 'error');
  assert.deepEqual(sent.body.sender, { name: 'Entre Líneas', email: 'sender@example.test' });
  assert.deepEqual(sent.body.to, [{ email: 'recipient@example.test' }]);
  assert.match(sent.body.textContent, /token=dummy/);
  assert.equal(sent.body.from, undefined);
});
