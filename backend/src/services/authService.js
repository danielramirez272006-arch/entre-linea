import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword, verifyAgainstDummy } from '../security/password.js';
import { generateOpaqueToken, sha256Hex } from '../security/tokens.js';
import { AppError } from './errors.js';

export function createAuthService({
  config,
  withTx,
  usersRepo,
  sessionsRepo,
  passwordResetRepo,
  auditRepo,
  mailer,
}) {
  async function issueSession({ userId, ipAddress, userAgent }, client) {
    const rawSessionToken = generateOpaqueToken(32);
    const idHash = sha256Hex(rawSessionToken);
    const csrfToken = generateOpaqueToken(32);
    const now = Date.now();
    const expiresAt = new Date(now + config.sessionTtlMs);
    const absoluteExpiresAt = new Date(now + config.sessionAbsoluteTtlMs);

    await sessionsRepo.create(
      {
        idHash,
        userId,
        csrfToken,
        ipAddress,
        userAgent,
        expiresAt,
        absoluteExpiresAt,
      },
      client
    );

    return { rawSessionToken, csrfToken, expiresAt };
  }

  return Object.freeze({
    async register({ name, email, password }, { ipAddress, userAgent, requestPath }) {
      const existing = await usersRepo.findByEmail(email);
      if (existing) {
        await auditRepo.insert({
          eventType: 'register_duplicate',
          severity: 'info',
          targetUserId: existing.id,
          ipAddress,
          requestPath,
          details: { reason: 'email_already_registered' },
        });
        throw new AppError(409, 'No fue posible completar el registro con estos datos. Verifica tu correo o inicia sesión.', {
          code: 'REGISTER_CONFLICT',
        });
      }

      const passwordHash = await hashPassword(password);
      const userId = randomUUID();

      return withTx(async (client) => {
        // El rol en registro siempre es 'user'; nunca se acepta desde el cliente.
        const user = await usersRepo.create(
          { id: userId, name, email, passwordHash, role: 'user' },
          client
        );
        const session = await issueSession({ userId: user.id, ipAddress, userAgent }, client);

        await auditRepo.insert(
          {
            eventType: 'register',
            severity: 'info',
            actorUserId: user.id,
            targetUserId: user.id,
            ipAddress,
            requestPath,
            details: { role: 'user' },
          },
          client
        );

        return {
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
          sessionToken: session.rawSessionToken,
          csrfToken: session.csrfToken,
        };
      });
    },

    async login({ email, password }, { ipAddress, userAgent, requestPath, existingSessionIdHash }) {
      const user = await usersRepo.findByEmail(email);

      if (!user) {
        await verifyAgainstDummy(password);
        await auditRepo.insert({
          eventType: 'login_failed',
          severity: 'warn',
          ipAddress,
          requestPath,
          details: { reason: 'invalid_credentials' },
        });

        const ipFailures = await auditRepo.countRecentFailedLogins({ ipAddress, windowMinutes: 15 });
        if (ipFailures >= config.alertFailedLoginsThreshold && ipFailures % config.alertFailedLoginsThreshold === 0) {
          await auditRepo.insert({
            eventType: 'brute_force_alert',
            severity: 'alert',
            ipAddress,
            requestPath,
            details: { consecutiveFailures: ipFailures, scope: 'ip' },
          });
        }

        throw new AppError(401, 'Credenciales inválidas.', { code: 'INVALID_CREDENTIALS' });
      }

      const now = Date.now();
      if (user.locked_until && new Date(user.locked_until).getTime() > now) {
        const retryAfterSeconds = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - now) / 1000));
        await auditRepo.insert({
          eventType: 'login_failed',
          severity: 'warn',
          targetUserId: user.id,
          ipAddress,
          requestPath,
          details: { reason: 'account_locked', retryAfterSeconds },
        });
        throw new AppError(429, 'Demasiados intentos fallidos. Espera antes de volver a intentarlo.', {
          code: 'ACCOUNT_LOCKED',
          retryAfterSeconds,
        });
      }

      const validPassword = await verifyPassword(user.password_hash, password);
      if (!validPassword) {
        const attempts = (user.failed_login_attempts || 0) + 1;
        let lockedUntil = null;
        let retryAfterSeconds;

        if (attempts >= config.loginMaxAttempts) {
          const exponent = Math.min(attempts - config.loginMaxAttempts, 6);
          retryAfterSeconds = Math.min(config.loginLockoutBaseSeconds * 2 ** exponent, 3600);
          lockedUntil = new Date(now + retryAfterSeconds * 1000);
        }

        await usersRepo.recordFailedLogin(user.id, { attempts, lockedUntil });
        await auditRepo.insert({
          eventType: 'login_failed',
          severity: 'warn',
          targetUserId: user.id,
          ipAddress,
          requestPath,
          details: { reason: 'invalid_credentials', attempts, locked: Boolean(lockedUntil) },
        });

        if (attempts >= config.alertFailedLoginsThreshold) {
          await auditRepo.insert({
            eventType: 'brute_force_alert',
            severity: 'alert',
            targetUserId: user.id,
            ipAddress,
            requestPath,
            details: { consecutiveFailures: attempts, scope: 'account' },
          });
        }

        if (lockedUntil) {
          throw new AppError(429, 'Demasiados intentos fallidos. Espera antes de volver a intentarlo.', {
            code: 'ACCOUNT_LOCKED',
            retryAfterSeconds,
          });
        }

        throw new AppError(401, 'Credenciales inválidas.', { code: 'INVALID_CREDENTIALS' });
      }

      return withTx(async (client) => {
        // Regenera sesión eliminando cualquier sesión previa en esa cookie.
        if (existingSessionIdHash) {
          await sessionsRepo.deleteByIdHash(existingSessionIdHash, client);
        }
        await usersRepo.resetLoginFailures(user.id, client);

        const session = await issueSession({ userId: user.id, ipAddress, userAgent }, client);
        await auditRepo.insert(
          {
            eventType: 'login_success',
            severity: 'info',
            actorUserId: user.id,
            targetUserId: user.id,
            ipAddress,
            requestPath,
            details: { role: user.role },
          },
          client
        );

        return {
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
          sessionToken: session.rawSessionToken,
          csrfToken: session.csrfToken,
        };
      });
    },

    async logout({ sessionIdHash, actorUserId, ipAddress, requestPath }) {
      if (sessionIdHash) {
        await sessionsRepo.deleteByIdHash(sessionIdHash);
      }
      if (actorUserId) {
        await auditRepo.insert({
          eventType: 'logout',
          severity: 'info',
          actorUserId,
          targetUserId: actorUserId,
          ipAddress,
          requestPath,
        });
      }
    },

    async requestPasswordReset({ email }, { ipAddress, requestPath }) {
      const user = await usersRepo.findByEmail(email);
      if (!user) {
        // Respuesta idéntica para evitar enumeración de cuentas.
        return {
          message: 'Si el correo está registrado, enviaremos instrucciones para restablecer tu contraseña.',
        };
      }

      const rawToken = generateOpaqueToken(32);
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + config.passwordResetTtlMs);

      await withTx(async (client) => {
        await passwordResetRepo.invalidateAllForUser(user.id, client);
        await passwordResetRepo.create(
          { id: randomUUID(), userId: user.id, tokenHash, expiresAt },
          client
        );
        await auditRepo.insert(
          {
            eventType: 'password_reset_requested',
            severity: 'info',
            targetUserId: user.id,
            ipAddress,
            requestPath,
          },
          client
        );
      });

      // Enlace construido exclusivamente a partir del origen configurado en el servidor.
      const resetUrl = `${config.appOrigin}/restablecer?token=${encodeURIComponent(rawToken)}`;
      const expiresMinutes = Math.round(config.passwordResetTtlMs / 60000);

      await mailer.sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
        expiresMinutes,
      });

      return {
        message: 'Si el correo está registrado, enviaremos instrucciones para restablecer tu contraseña.',
      };
    },

    async resetPassword({ token, newPassword }, { ipAddress, requestPath }) {
      const tokenHash = sha256Hex(token);
      const newHash = await hashPassword(newPassword);

      await withTx(async (client) => {
        const consumed = await passwordResetRepo.consumeAtomic(tokenHash, client);
        if (!consumed) {
          throw new AppError(400, 'El enlace de recuperación es inválido, ya fue utilizado o ha caducado.', {
            code: 'INVALID_RESET_TOKEN',
          });
        }

        await usersRepo.updatePassword(consumed.user_id, newHash, client);
        await sessionsRepo.deleteAllForUser(consumed.user_id, client);
        await passwordResetRepo.invalidateAllForUser(consumed.user_id, client);

        await auditRepo.insert(
          {
            eventType: 'password_reset_completed',
            severity: 'info',
            actorUserId: consumed.user_id,
            targetUserId: consumed.user_id,
            ipAddress,
            requestPath,
          },
          client
        );
      });

      return { message: 'Tu contraseña se actualizó correctamente. Inicia sesión con tu nueva contraseña.' };
    },

    async changePassword({ userId, currentPassword, newPassword }, { ipAddress, userAgent, requestPath }) {
      const user = await usersRepo.findById(userId);
      if (!user) {
        throw new AppError(404, 'Usuario no encontrado.', { code: 'USER_NOT_FOUND' });
      }

      const validCurrent = await verifyPassword(user.password_hash, currentPassword);
      if (!validCurrent) {
        throw new AppError(401, 'La contraseña actual no es correcta.', { code: 'INVALID_CURRENT_PASSWORD' });
      }

      const newHash = await hashPassword(newPassword);

      return withTx(async (client) => {
        await usersRepo.updatePassword(user.id, newHash, client);
        // Invalida todas las sesiones y tokens anteriores y emite una sesión nueva para el usuario actual.
        await sessionsRepo.deleteAllForUser(user.id, client);
        await passwordResetRepo.invalidateAllForUser(user.id, client);
        const session = await issueSession({ userId: user.id, ipAddress, userAgent }, client);

        await auditRepo.insert(
          {
            eventType: 'password_changed',
            severity: 'info',
            actorUserId: user.id,
            targetUserId: user.id,
            ipAddress,
            requestPath,
          },
          client
        );

        return {
          message: 'Contraseña actualizada. Se cerraron las demás sesiones activas.',
          sessionToken: session.rawSessionToken,
          csrfToken: session.csrfToken,
        };
      });
    },
  });
}
