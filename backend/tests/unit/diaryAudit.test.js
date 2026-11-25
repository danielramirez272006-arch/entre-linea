import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { createLogger } from '../../src/config/logger.js';
import { createInMemoryTestStore } from './mockStore.js';

function createHarness(auditOverride = null) {
  const store = createInMemoryTestStore();
  if (auditOverride) {
    store.repositories.auditRepo = auditOverride(store.repositories.auditRepo);
  }
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
    mailDriver: 'local',
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
    logger: createLogger('silent'),
    repositories: store.repositories,
    withTxOverride: store.withTx,
  });

  return { app, store };
}

describe('Bitácora de accesos denegados a entradas ajenas del diario', () => {
  it('registra intentos de lectura, edición y eliminación sobre entrada ajena con 404 y sin datos privados', async () => {
    const { app, store } = createHarness();
    const agentA = request.agent(app);
    const agentB = request.agent(app);

    const regA = await agentA.post('/api/auth/register').send({
      name: 'Usuario A',
      email: 'a@ejemplo.com',
      password: 'Clave!UsuarioA2026',
    });
    const regB = await agentB.post('/api/auth/register').send({
      name: 'Usuario B',
      email: 'b@ejemplo.com',
      password: 'Clave!UsuarioB2026',
    });

    const createdB = await agentB
      .post('/api/diary')
      .set('X-CSRF-Token', regB.body.csrfToken)
      .send({
        title: 'TITULO_CONFIDENCIAL_B',
        entryDate: '2026-11-25',
        category: 'personal',
        mood: 'tranquilo',
        content: 'CONTENIDO_SECRETO_B',
      });
    const entryIdB = createdB.body.entry.id;

    // A intenta leer, editar y borrar entrada de B
    const readRes = await agentA.get(`/api/diary/${entryIdB}?search=BUSQUEDA_PRIVADA`);
    const updateRes = await agentA
      .put(`/api/diary/${entryIdB}`)
      .set('X-CSRF-Token', regA.body.csrfToken)
      .send({
        title: 'Intento de edición',
        entryDate: '2026-11-25',
        category: 'personal',
        mood: 'bien',
        content: 'No debe editar',
        version: 1,
      });
    const deleteRes = await agentA
      .delete(`/api/diary/${entryIdB}`)
      .set('X-CSRF-Token', regA.body.csrfToken);

    assert.equal(readRes.status, 404);
    assert.equal(updateRes.status, 404);
    assert.equal(deleteRes.status, 404);

    // Usuario normal A no puede consultar la bitácora
    const auditAttempt = await agentA.get('/api/admin/audit-logs');
    assert.equal(auditAttempt.status, 403);

    const deniedEvents = store.raw.auditLogs.filter((l) => l.event_type === 'diary_access_denied');
    assert.equal(deniedEvents.length, 3);
    const actions = deniedEvents.map((e) => e.details.action).sort();
    assert.deepEqual(actions, ['delete', 'read', 'update']);

    const serialized = JSON.stringify(deniedEvents);
    assert.equal(serialized.includes('TITULO_CONFIDENCIAL_B'), false);
    assert.equal(serialized.includes('CONTENIDO_SECRETO_B'), false);
    assert.equal(serialized.includes('BUSQUEDA_PRIVADA'), false);
  });

  it('si falla la inserción en bitácora, el acceso sigue denegado con 404', async () => {
    const { app } = createHarness((baseAudit) => ({
      ...baseAudit,
      async insert(payload) {
        if (payload.eventType === 'diary_access_denied') {
          throw new Error('DB audit unavailable');
        }
        return baseAudit.insert(payload);
      },
    }));

    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Sin Audit',
      email: 'noaudit@ejemplo.com',
      password: 'Clave!Usuario2026',
    });

    const missingId = '11111111-1111-4111-8111-111111111111';
    const res = await agent.get(`/api/diary/${missingId}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ENTRY_NOT_FOUND');
  });
});
