import { verifyPassword } from '../security/password.js';
import { AppError } from './errors.js';

export function createAdminService({ withTx, usersRepo, sessionsRepo, auditRepo, hooks = {} }) {
  function assertAdmin(actor) {
    if (!actor || actor.role !== 'admin') {
      throw new AppError(403, 'Acceso denegado.', { code: 'FORBIDDEN' });
    }
  }

  return Object.freeze({
    async listUsers(actor) {
      assertAdmin(actor);
      const users = await usersRepo.listAllForAdmin();
      return users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        failedLoginAttempts: u.failed_login_attempts,
        lockedUntil: u.locked_until,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
      }));
    },

    async listAuditLogs(actor, limit = 100) {
      assertAdmin(actor);
      const rows = await auditRepo.listRecent(limit);
      return rows.map((row) => ({
        id: row.id,
        eventType: row.event_type,
        severity: row.severity,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_email || null,
        targetUserId: row.target_user_id,
        targetEmail: row.target_email || null,
        ipAddress: row.ip_address,
        requestPath: row.request_path,
        details: row.details,
        createdAt: row.created_at,
      }));
    },

    async changeUserRole(actor, targetUserId, { role, currentPassword, confirmed }, { ipAddress, requestPath }) {
      assertAdmin(actor);

      if (confirmed !== true) {
        throw new AppError(400, 'Debes confirmar el cambio de rol.', { code: 'CONFIRMATION_REQUIRED' });
      }

      // Captura snapshot de credenciales del actor y verifica reautenticación antes de tomar bloqueos.
      const actorSnapshot = await usersRepo.findById(actor.id);
      if (!actorSnapshot || actorSnapshot.role !== 'admin') {
        throw new AppError(403, 'Acceso denegado.', { code: 'FORBIDDEN' });
      }

      const passwordOk = await verifyPassword(actorSnapshot.password_hash, currentPassword);
      if (!passwordOk) {
        await auditRepo.insert({
          eventType: 'access_denied',
          severity: 'warn',
          actorUserId: actor.id,
          targetUserId,
          ipAddress,
          requestPath,
          details: { reason: 'admin_reauth_failed' },
        });
        throw new AppError(401, 'Contraseña de verificación incorrecta.', { code: 'REAUTH_FAILED' });
      }

      if (typeof hooks.beforeRoleChangeTx === 'function') {
        await hooks.beforeRoleChangeTx({ actorId: actor.id, targetUserId, role });
      }

      let accessDeniedAudit = null;

      try {
        return await withTx(async (client) => {
          // 1. Serializa cualquier mutación de roles con bloqueo transaccional dedicado.
          await usersRepo.acquireRoleMutationLock(client);

          // 2. Bloquea actor y objetivo en orden ascendente determinista para evitar deadlocks.
          const lockedRows = await usersRepo.lockUsersForUpdate([actor.id, targetUserId], client);
          const lockedActor = lockedRows.find((r) => r.id === actor.id);
          const target = lockedRows.find((r) => r.id === targetUserId);

          // 3. Revalida privilegios y vigencia de reautenticación dentro de la transacción.
          if (!lockedActor || lockedActor.role !== 'admin') {
            accessDeniedAudit = {
              eventType: 'access_denied',
              severity: 'warn',
              actorUserId: actor.id,
              targetUserId,
              ipAddress,
              requestPath,
              details: { reason: 'actor_privileges_revoked_concurrently' },
            };
            throw new AppError(403, 'Tus privilegios de administrador fueron revocados.', { code: 'FORBIDDEN' });
          }

          if (
            lockedActor.auth_version !== actorSnapshot.auth_version ||
            lockedActor.password_hash !== actorSnapshot.password_hash
          ) {
            accessDeniedAudit = {
              eventType: 'access_denied',
              severity: 'warn',
              actorUserId: actor.id,
              targetUserId,
              ipAddress,
              requestPath,
              details: { reason: 'admin_credentials_changed_concurrently' },
            };
            throw new AppError(401, 'Tus credenciales cambiaron durante la operación. Vuelve a autenticarte.', {
              code: 'REAUTH_FAILED',
            });
          }

          if (!target) {
            throw new AppError(404, 'Usuario no encontrado.', { code: 'USER_NOT_FOUND' });
          }

          if (target.role === role) {
            return {
              id: target.id,
              name: target.name,
              email: target.email,
              role: target.role,
            };
          }

          // 4. Garantiza que permanezca al menos un administrador bajo el bloqueo serializado.
          if (target.role === 'admin' && role !== 'admin') {
            const totalAdmins = await usersRepo.countAdmins(client);
            if (totalAdmins <= 1) {
              throw new AppError(409, 'Debe permanecer al menos un administrador activo en el sistema.', {
                code: 'LAST_ADMIN_PROTECTED',
              });
            }
          }

          // 5. Actualiza el rol (incrementa auth_version), invalida sesiones del usuario afectado y audita.
          const updated = await usersRepo.updateRole(target.id, role, client);
          await sessionsRepo.deleteAllForUser(target.id, client);

          await auditRepo.insert(
            {
              eventType: 'role_changed',
              severity: 'warn',
              actorUserId: lockedActor.id,
              targetUserId: target.id,
              ipAddress,
              requestPath,
              details: { previousRole: target.role, newRole: role, sessionsRevoked: true },
            },
            client
          );

          return updated;
        });
      } catch (err) {
        if (accessDeniedAudit) {
          await auditRepo.insert(accessDeniedAudit).catch(() => {});
        }
        throw err;
      }
    },
  });
}
