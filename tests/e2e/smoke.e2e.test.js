import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../backend/src/app.js';
import { createLogger } from '../../backend/src/config/logger.js';
import { createInMemoryTestStore } from '../../backend/tests/unit/mockStore.js';

describe('Prueba E2E de extremo a extremo (servidor Express + build React mismo origen)', () => {
  let server;
  let baseUrl;

  before(async () => {
    const store = createInMemoryTestStore();
    const keyV1 = randomBytes(32);
    const config = Object.freeze({
      nodeEnv: 'test',
      isProduction: false,
      isTest: true,
      port: 0,
      appOrigin: 'http://127.0.0.1',
      trustProxy: 0,
      sessionCookieName: 'el_sid',
      sessionTtlMs: 3600_000,
      sessionAbsoluteTtlMs: 86400_000,
      activeKeyVersion: 'v1',
      encryptionKeys: new Map([['v1', keyV1]]),
      passwordResetTtlMs: 900_000,
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

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('sirve el build de React con CSP sin scripts CDN y completa flujo de diario autenticado', async () => {
    const htmlRes = await fetch(`${baseUrl}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.match(html, /Entre Líneas — Diario Seguro/);
    assert.equal(html.includes('cdn.jsdelivr.net'), false);
    assert.equal(html.includes('unpkg.com'), false);

    // Registro
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Laura E2E',
        email: 'laura@ejemplo.com',
        password: 'Clave!E2EPrueba2026',
      }),
    });
    assert.equal(regRes.status, 201);
    const cookie = regRes.headers.get('set-cookie').split(';')[0];
    const regData = await regRes.json();

    // Crear entrada
    const createRes = await fetch(`${baseUrl}/api/diary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-CSRF-Token': regData.csrfToken,
      },
      body: JSON.stringify({
        title: 'Primera hoja',
        entryDate: '2026-11-25',
        category: 'gratitud',
        mood: 'bien',
        content: 'Agradecida por terminar las pruebas con éxito.',
      }),
    });
    assert.equal(createRes.status, 201);

    // Listar entradas
    const listRes = await fetch(`${baseUrl}/api/diary`, {
      headers: { Cookie: cookie },
    });
    assert.equal(listRes.status, 200);
    const listData = await listRes.json();
    assert.equal(listData.entries.length, 1);
    assert.equal(listData.entries[0].title, 'Primera hoja');
  });
});
