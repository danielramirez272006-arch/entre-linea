import http from 'node:http';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDbPool } from './db/pool.js';
import { createApp } from './app.js';

let server = null;
let pool = null;
let logger = null;
let shuttingDown = false;

async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger?.info({ reason }, 'Iniciando cierre ordenado del servidor');

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
  if (logger) {
    logger.fatal({ err: { message: err.message } }, 'Error fatal al iniciar el servidor');
  } else {
    console.error('Error fatal al iniciar el servidor:', err.message);
  }
  process.exit(1);
});
