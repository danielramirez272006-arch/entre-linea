import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../backend/src/app.js';
import { createLogger } from '../../backend/src/config/logger.js';
import { createInMemoryTestStore } from '../../backend/tests/unit/mockStore.js';

/**
 * TEST-ONLY SERVER PARA PRUEBAS DE NAVEGADOR (E2E UI)
 * Sirve frontend/dist + API con repositorio simulado en memoria para verificar
 * flujos de interfaz sin tocar la base de datos real del usuario.
 */
const port = Number(process.env.BROWSER_TEST_PORT) || 3099;
const store = createInMemoryTestStore();
const keyV1 = randomBytes(32);

const config = Object.freeze({
  nodeEnv: 'test',
  isProduction: false,
  isTest: true,
  port,
  appOrigin: `http://127.0.0.1:${port}`,
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
  rateLimitMaxRequests: 500,
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

const server = http.createServer(app);
server.listen(port, '127.0.0.1', () => {
  console.log(`Browser test server listening on http://127.0.0.1:${port}`);
});
