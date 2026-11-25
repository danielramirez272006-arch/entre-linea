import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { PROJECT_ROOT } from './config/env.js';
import { withTransaction } from './db/pool.js';
import { createCryptoService } from './security/crypto.js';
import { createMailer } from './mail/mailer.js';

import { createUsersRepository } from './repositories/usersRepository.js';
import { createSessionsRepository } from './repositories/sessionsRepository.js';
import { createDiaryRepository } from './repositories/diaryRepository.js';
import { createPasswordResetRepository } from './repositories/passwordResetRepository.js';
import { createAuditRepository } from './repositories/auditRepository.js';
import { createRateLimitRepository } from './repositories/rateLimitRepository.js';

import { createAuthService } from './services/authService.js';
import { createDiaryService } from './services/diaryService.js';
import { createProfileService } from './services/profileService.js';
import { createAdminService } from './services/adminService.js';

import { createAuthController } from './controllers/authController.js';
import { createDiaryController } from './controllers/diaryController.js';
import { createProfileController } from './controllers/profileController.js';
import { createAdminController } from './controllers/adminController.js';

import { createSessionMiddleware } from './middleware/sessionMiddleware.js';
import { createCsrfMiddleware } from './middleware/csrfMiddleware.js';
import { createRateLimiter } from './middleware/rateLimitMiddleware.js';
import { createErrorHandler } from './middleware/errorMiddleware.js';

import { createAuthRoutes } from './routes/authRoutes.js';
import { createDiaryRoutes } from './routes/diaryRoutes.js';
import { createProfileRoutes } from './routes/profileRoutes.js';
import { createAdminRoutes } from './routes/adminRoutes.js';

export function createApp({
  config,
  logger,
  pool,
  repositories = null,
  withTxOverride = null,
  mailerOverride = null,
  serviceHooks = {},
}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy > 0) {
    app.set('trust proxy', config.trustProxy);
  }

  const repos = repositories || {
    usersRepo: createUsersRepository(pool),
    sessionsRepo: createSessionsRepository(pool),
    diaryRepo: createDiaryRepository(pool),
    passwordResetRepo: createPasswordResetRepository(pool),
    auditRepo: createAuditRepository(pool),
    rateLimitRepo: createRateLimitRepository(pool),
  };

  const withTx = withTxOverride || ((fn) => withTransaction(pool, fn));
  const cryptoService = createCryptoService({
    activeKeyVersion: config.activeKeyVersion,
    encryptionKeys: config.encryptionKeys,
  });
  const mailer = mailerOverride || createMailer(config, logger);

  const authService = createAuthService({
    config,
    withTx,
    usersRepo: repos.usersRepo,
    sessionsRepo: repos.sessionsRepo,
    passwordResetRepo: repos.passwordResetRepo,
    auditRepo: repos.auditRepo,
    mailer,
    logger,
    hooks: serviceHooks.auth || {},
  });
  const diaryService = createDiaryService({
    withTx,
    usersRepo: repos.usersRepo,
    diaryRepo: repos.diaryRepo,
    cryptoService,
    auditRepo: repos.auditRepo,
    logger,
  });
  const profileService = createProfileService({
    usersRepo: repos.usersRepo,
    cryptoService,
  });
  const adminService = createAdminService({
    withTx,
    usersRepo: repos.usersRepo,
    sessionsRepo: repos.sessionsRepo,
    auditRepo: repos.auditRepo,
    hooks: serviceHooks.admin || {},
  });

  const sessionMw = createSessionMiddleware({
    config,
    sessionsRepo: repos.sessionsRepo,
    auditRepo: repos.auditRepo,
  });
  const csrfMw = createCsrfMiddleware({ config, auditRepo: repos.auditRepo });

  const generalRateLimiter = createRateLimiter({
    rateLimitRepo: repos.rateLimitRepo,
    auditRepo: repos.auditRepo,
    prefix: 'api',
    windowMs: config.rateLimitWindowMs,
    maxRequests: config.rateLimitMaxRequests,
  });

  const authRateLimiter = createRateLimiter({
    rateLimitRepo: repos.rateLimitRepo,
    auditRepo: repos.auditRepo,
    prefix: 'auth',
    windowMs: config.rateLimitWindowMs,
    maxRequests: Math.min(config.rateLimitMaxRequests, 25),
    message: 'Demasiados intentos en autenticación. Espera unos minutos antes de reintentar.',
  });

  // Cabeceras de seguridad y CSP estricta sin scripts inline ni CDNs.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
    })
  );

  // CORS restringido únicamente a orígenes autorizados.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (csrfMw.allowedOrigins.has(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    })
  );

  app.use(cookieParser());
  app.use(express.json({ limit: '64kb' }));

  // Endpoint de salud sin versiones ni metadatos internos.
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
  });

  // Protección común para todas las rutas de API.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', generalRateLimiter);
  app.use('/api', sessionMw.attachSession);
  app.use('/api', csrfMw.verifyOrigin);
  app.use('/api', csrfMw.verifyCsrf);

  const authController = createAuthController({ config, authService });
  const diaryController = createDiaryController({ diaryService });
  const profileController = createProfileController({ profileService });
  const adminController = createAdminController({ adminService });

  app.use('/api/auth', createAuthRoutes({ authController, sessionMw, authRateLimiter }));
  app.use('/api/diary', createDiaryRoutes({ diaryController, sessionMw }));
  app.use('/api/profile', createProfileRoutes({ profileController, sessionMw }));
  app.use('/api/admin', createAdminRoutes({ adminController, sessionMw }));

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Recurso no encontrado.',
      },
    });
  });

  // Sirve el build de React en el mismo origen cuando existe frontend/dist.
  const frontendDistDir = path.join(PROJECT_ROOT, 'frontend', 'dist');
  const frontendIndexHtml = path.join(frontendDistDir, 'index.html');
  if (fs.existsSync(frontendIndexHtml)) {
    app.use(express.static(frontendDistDir, { index: false }));
    app.get(/^\/(?!api\/|health$).*/, (_req, res) => {
      res.sendFile(frontendIndexHtml);
    });
  }

  app.use(createErrorHandler(logger));

  return app;
}
