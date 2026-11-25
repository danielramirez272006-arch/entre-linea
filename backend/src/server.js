import http from 'node:http';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDbPool } from './db/pool.js';
import { createApp } from './app.js';
import { createSessionsRepository } from './repositories/sessionsRepository.js';
import { createPasswordResetRepository } from './repositories/passwordResetRepository.js';
import { createRateLimitRepository } from './repositories/rateLimitRepository.js';

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

let server = null;
let pool = null;
let logger = null;
let cleanupTimer = null;
let shuttingDown = false;

async function runPeriodicCleanup(sessionsRepo, passwordResetRepo, rateLimitRepo) {
  try {
    await Promise.all([
      sessionsRepo.deleteExpired(),
      passwordResetRepo.deleteExpired(),
      rateLimitRepo.deleteExpired(),
    ]);
    logger?.debug('Limpieza periódica de sesiones, tokens y rate limits expirados completada');
  } catch (err) {
    logger?.warn({ err: { message: err.message } }, 'No se pudo completar la limpieza periódica');
  }
}

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger?.info({ reason }, 'Iniciando cierre ordenado del servidor');

  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }

  const forceTimer = setTimeout(() => {
    logger?.error('Tiempo de cierre ordenado excedido; finalizando proceso');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (pool) {
      await pool.end();
    }
    logger?.info('Recursos cerrados correctamente');
    process.exit(exitCode);
  } catch (err) {
    logger?.error({ err: { message: err.message } }, 'Error durante el cierre ordenado');
    process.exit(1);
  }
}

async function main() {
  const config = loadConfig();
  logger = createLogger(config.logLevel);
  pool = createDbPool(config, logger);

  // Verifica conectividad inicial con PostgreSQL antes de aceptar tráfico.
  await pool.query('SELECT 1');

  const sessionsRepo = createSessionsRepository(pool);
  const passwordResetRepo = createPasswordResetRepository(pool);
  const rateLimitRepo = createRateLimitRepository(pool);

  await runPeriodicCleanup(sessionsRepo, passwordResetRepo, rateLimitRepo);
  cleanupTimer = setInterval(
    () => runPeriodicCleanup(sessionsRepo, passwordResetRepo, rateLimitRepo),
    CLEANUP_INTERVAL_MS
  );
  cleanupTimer.unref();

  const app = createApp({ config, logger, pool });
  server = http.createServer(app);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Servidor Entre Líneas en ejecución');
  });

  process.on('SIGINT', () => shutdown('SIGINT', 0));
  process.on('SIGTERM', () => shutdown('SIGTERM', 0));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err: { name: err.name, message: err.message } }, 'Excepción no capturada');
    shutdown('uncaughtException', 1);
  });
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.fatal({ reason: message }, 'Promesa rechazada sin manejar');
    shutdown('unhandledRejection', 1);
  });
}

main().catch((err) => {
  const detail =
    err?.message ||
    (Array.isArray(err?.errors) ? err.errors.map((e) => e.message || e.code).join('; ') : err?.code || String(err));
  if (logger) {
    logger.fatal({ err: { message: detail } }, 'Error fatal al iniciar el servidor');
  } else {
    console.error('Error fatal al iniciar el servidor:', detail);
  }
  process.exit(1);
});
