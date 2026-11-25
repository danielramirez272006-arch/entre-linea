import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createInMemoryTestStore } from './mockStore.js';

function createTestHarness(overrides = {}) {
  const store = createInMemoryTestStore();
  const sentEmails = [];
  const keyV1 = randomBytes(32);

  const config = Object.freeze({
    nodeEnv: 'test',
    isProduction: false,
    isTest: true,
    port: 3001,
    appOrigin: 'http://localhost:5173',
    trustProxy: 0,
    sessionCookieName: 'el_sid',
    sessionTtlMs: 60 * 60 * 1000,
    sessionAbsoluteTtlMs: 24 * 60 * 60 * 1000,
    activeKeyVersion: 'v1',
    encryptionKeys: new Map([['v1', keyV1]]),
    passwordResetTtlMs: 15 * 60 * 1000,
    mailDriver: 'local',
    devMailDir: 'backend/.dev-mail',
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 200,
    loginMaxAttempts: 4,
    loginLockoutBaseSeconds: 30,
    alertFailedLoginsThreshold: 4,
    logLevel: 'silent',
    ...overrides,
  });

  const app = createApp({
    config,
    logger: createLogger('silent'),
    repositories: store.repositories,
    withTxOverride: store.withTx,
    mailerOverride: {
      async sendPasswordResetEmail(msg) {
        sentEmails.push(msg);
        return { delivered: true, driver: 'test-capture' };
      },
    },
  });

  return { app, store, sentEmails, config };
}

describe('Flujos de API y controles de seguridad (con repositorio simulado de pruebas)', () => {
  it('GET /health responde sin versiones ni X-Powered-By y con CSP estricta', async () => {
    const { app } = createTestHarness();
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.match(res.headers['content-security-policy'], /default-src 'self'/);
  });

  it('rechaza asignación de rol en registro, cifra entradas y bloquea IDOR entre dos usuarios', async () => {
    const { app, store } = createTestHarness();

    // Intento de escalación en registro
    const badReg = await request(app).post('/api/auth/register').send({
      name: 'Mallory',
      email: 'mallory@ejemplo.com',
      password: 'Clave!MuySegura2026',
      role: 'admin',
    });
    assert.equal(badReg.status, 400);

    // Registro legítimo de Usuario A
    const agentA = request.agent(app);
    const regA = await agentA.post('/api/auth/register').send({
      name: 'Alicia',
      email: 'alicia@ejemplo.com',
      password: 'Clave!MuySegura2026',
    });
    assert.equal(regA.status, 201);
    assert.equal(regA.body.user.role, 'user');
    const csrfA = regA.body.csrfToken;

    // Usuario A crea entrada con contenido privado y payload XSS
    const createRes = await agentA
      .post('/api/diary')
      .set('X-CSRF-Token', csrfA)
      .send({
        title: 'Día de prueba <script>alert(1)</script>',
        entryDate: '2026-11-25',
        category: 'personal',
        mood: 'tranquilo',
        content: 'Mi secreto personal nunca debe quedar en texto claro en la BD.',
      });
    assert.equal(createRes.status, 201);
    const entryId = createRes.body.entry.id;

    // Verificar en almacenamiento que título y contenido están cifrados
    const rawEntry = store.raw.entries.get(entryId);
    assert.equal(rawEntry.title_ciphertext.toString('utf8').includes('Día de prueba'), false);
    assert.equal(rawEntry.content_ciphertext.toString('utf8').includes('secreto personal'), false);

    // Registro de Usuario B
    const agentB = request.agent(app);
    const regB = await agentB.post('/api/auth/register').send({
      name: 'Bruno',
      email: 'bruno@ejemplo.com',
      password: 'OtraClave!Segura2026',
    });
    assert.equal(regB.status, 201);
    const csrfB = regB.body.csrfToken;

    // IDOR: Usuario B intenta leer, editar y eliminar la entrada de Usuario A
    assert.equal((await agentB.get(`/api/diary/${entryId}`)).status, 404);
    assert.equal(
      (
        await agentB
          .put(`/api/diary/${entryId}`)
          .set('X-CSRF-Token', csrfB)
          .send({
            title: 'Robado',
            entryDate: '2026-11-25',
            category: 'personal',
            mood: 'bien',
            content: 'Intento de sobrescritura',
            version: 1,
          })
      ).status,
      404
    );
    assert.equal(
      (await agentB.delete(`/api/diary/${entryId}`).set('X-CSRF-Token', csrfB)).status,
      404
    );

    // Usuario normal no puede acceder al panel admin
    const adminAttempt = await agentB.get('/api/admin/users');
    assert.equal(adminAttempt.status, 403);
    assert.ok(store.raw.auditLogs.some((l) => l.event_type === 'access_denied'));
  });

  it('protege contra CSRF, orígenes no permitidos y SQLi en identificadores', async () => {
    const { app } = createTestHarness();
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Clara',
      email: 'clara@ejemplo.com',
      password: 'Clave!Segura2026',
    });
    const csrf = reg.body.csrfToken;

    // Sin token CSRF -> 403
    const noCsrf = await agent.post('/api/diary').send({
      title: 'Sin CSRF',
      entryDate: '2026-11-25',
      category: 'metas',
      mood: 'bien',
      content: 'Debe fallar',
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.body.error.code, 'CSRF_INVALID');

    // Origen malicioso -> 403
    const badOrigin = await agent
      .post('/api/diary')
      .set('Origin', 'https://atacante.ejemplo')
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Origen malo',
        entryDate: '2026-11-25',
        category: 'metas',
        mood: 'bien',
        content: 'Debe fallar',
      });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.body.error.code, 'ORIGIN_NOT_ALLOWED');

    // Payload tipo SQLi en parámetro de ID -> rechazado por validación UUID (400)
    const sqliId = await agent.get("/api/diary/' OR 1=1 --");
    assert.equal(sqliId.status, 400);
  });

  it('detecta conflictos de edición entre pestañas (409) y aplica límite de 100 entradas concurrentes', async () => {
    const { app } = createTestHarness({ rateLimitMaxRequests: 500 });
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Diego',
      email: 'diego@ejemplo.com',
      password: 'Clave!Segura2026',
    });
    const csrf = reg.body.csrfToken;

    const created = await agent
      .post('/api/diary')
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Versión 1',
        entryDate: '2026-11-25',
        category: 'gratitud',
        mood: 'bien',
        content: 'Contenido inicial',
      });
    const entryId = created.body.entry.id;

    // Pestaña 1 actualiza v1 -> v2
    const tab1 = await agent
      .put(`/api/diary/${entryId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Versión 2',
        entryDate: '2026-11-25',
        category: 'gratitud',
        mood: 'bien',
        content: 'Editado desde pestaña 1',
        version: 1,
      });
    assert.equal(tab1.status, 200);
    assert.equal(tab1.body.entry.version, 2);

    // Pestaña 2 intenta guardar con versión obsoleta v1 -> 409 Conflict sin sobrescribir
    const tab2 = await agent
      .put(`/api/diary/${entryId}`)
      .set('X-CSRF-Token', csrf)
      .send({
        title: 'Pestaña atrasada',
        entryDate: '2026-11-25',
        category: 'gratitud',
        mood: 'normal',
        content: 'No debe sobrescribir',
        version: 1,
      });
    assert.equal(tab2.status, 409);
    assert.equal(tab2.body.error.code, 'VERSION_CONFLICT');
    assert.equal(tab2.body.error.details.currentEntry.version, 2);

    // Llenar hasta 99 entradas adicionales y probar concurrencia en el límite de 100
    for (let i = 0; i < 98; i += 1) {
      const r = await agent
        .post('/api/diary')
        .set('X-CSRF-Token', csrf)
        .send({
          title: `Entrada ${i}`,
          entryDate: '2026-11-25',
          category: 'recuerdos',
          mood: 'normal',
          content: `Texto ${i}`,
        });
      assert.equal(r.status, 201);
    }

    // Queda espacio para 1 entrada más; lanzamos 3 solicitudes simultáneas
    const concurrent = await Promise.all(
      [1, 2, 3].map((n) =>
        agent
          .post('/api/diary')
          .set('X-CSRF-Token', csrf)
          .send({
            title: `Concurrente ${n}`,
            entryDate: '2026-11-25',
            category: 'metas',
            mood: 'bien',
            content: 'Prueba de límite',
          })
      )
    );

    const createdCount = concurrent.filter((r) => r.status === 201).length;
    const rejectedCount = concurrent.filter((r) => r.status === 409).length;
    assert.equal(createdCount, 1);
    assert.equal(rejectedCount, 2);
  });

  it('bloquea fuerza bruta con 429, genera alerta en bitácora y gestiona recuperación de contraseña de un solo uso', async () => {
    const { app, store, sentEmails } = createTestHarness();
    const agent = request.agent(app);

    const reg = await agent.post('/api/auth/register').send({
      name: 'Elena',
      email: 'elena@ejemplo.com',
      password: 'Clave!Segura2026',
    });
    assert.equal(reg.status, 201);

    // Intentos fallidos consecutivos de login
    for (let i = 0; i < 3; i += 1) {
      const fail = await request(app).post('/api/auth/login').send({
        email: 'elena@ejemplo.com',
        password: 'Incorrecta!Password1',
      });
      assert.equal(fail.status, 401);
    }
    const locked = await request(app).post('/api/auth/login').send({
      email: 'elena@ejemplo.com',
      password: 'Incorrecta!Password1',
    });
    assert.equal(locked.status, 429);
    assert.ok(locked.headers['retry-after']);
    assert.ok(store.raw.auditLogs.some((l) => l.event_type === 'brute_force_alert' && l.severity === 'alert'));

    // Recuperación de contraseña con cabecera Host falsificada: el enlace debe usar APP_ORIGIN
    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .set('Host', 'malicioso.ejemplo')
      .send({ email: 'elena@ejemplo.com' });
    assert.equal(forgot.status, 200);
    assert.equal(sentEmails.length, 1);
    assert.ok(sentEmails[0].resetUrl.startsWith('http://localhost:5173/restablecer?token='));
    assert.equal(JSON.stringify(forgot.body).includes('token'), false);

    const token = new URL(sentEmails[0].resetUrl).searchParams.get('token');
    assert.equal(token.length, 64);

    // Restablecimiento exitoso invalida la sesión previa
    const resetOk = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'Nueva!Password2026',
    });
    assert.equal(resetOk.status, 200);

    // La sesión previa de agent debe haber sido revocada
    const prevSessionCheck = await agent.get('/api/diary');
    assert.equal(prevSessionCheck.status, 401);

    // Reutilizar el mismo token debe fallar
    const reuse = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'Otra!Password2026',
    });
    assert.equal(reuse.status, 400);
  });

  it('cifra y enmascara perfil, y exige confirmación + reautenticación para cambiar rol en admin', async () => {
    const { app, store } = createTestHarness();
    const adminAgent = request.agent(app);
    const userAgent = request.agent(app);

    const regAdmin = await adminAgent.post('/api/auth/register').send({
      name: 'Admin Uno',
      email: 'admin@ejemplo.com',
      password: 'Admin!Password2026',
    });
    // Promoción simulada equivalente al comando CLI server/scripts/create-admin.js
    store.raw.users.get(regAdmin.body.user.id).role = 'admin';
    const adminCsrf = regAdmin.body.csrfToken;

    const regUser = await userAgent.post('/api/auth/register').send({
      name: 'Usuario Dos',
      email: 'dos@ejemplo.com',
      password: 'User!Password2026',
    });
    const userCsrf = regUser.body.csrfToken;

    // Actualizar perfil con teléfono y dato sensible de prueba
    const profRes = await userAgent
      .put('/api/profile')
      .set('X-CSRF-Token', userCsrf)
      .send({
        name: 'Usuario Dos Editado',
        phone: '+506 8888-5678',
        sensitiveNote: 'SECRETO-DEMO-42',
      });
    assert.equal(profRes.status, 200);
    assert.equal(profRes.body.profile.phoneMasked, '•••• •••• 5678');
    assert.equal(profRes.body.profile.sensitiveNoteMasked.endsWith('42'), true);

    // Eliminar teléfono enviando cadena vacía
    const clearPhone = await userAgent
      .put('/api/profile')
      .set('X-CSRF-Token', userCsrf)
      .send({ name: 'Usuario Dos Editado', phone: '' });
    assert.equal(clearPhone.status, 200);
    assert.equal(clearPhone.body.profile.hasPhone, false);

    // Cambio de rol con contraseña incorrecta -> 401
    const badReauth = await adminAgent
      .patch(`/api/admin/users/${regUser.body.user.id}/role`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ role: 'admin', currentPassword: 'Wrong!Password1', confirmed: true });
    assert.equal(badReauth.status, 401);

    // Cambio de rol con reautenticación y confirmación -> 200
    const goodRole = await adminAgent
      .patch(`/api/admin/users/${regUser.body.user.id}/role`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ role: 'admin', currentPassword: 'Admin!Password2026', confirmed: true });
    assert.equal(goodRole.status, 200);
    assert.equal(goodRole.body.user.role, 'admin');
    assert.ok(store.raw.auditLogs.some((l) => l.event_type === 'role_changed'));
  });
});
