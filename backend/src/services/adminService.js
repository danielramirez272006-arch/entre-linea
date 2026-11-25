import { verifyPassword } from '../security/password.js';
import { AppError } from './errors.js';

export function createAdminService({ withTx, usersRepo, auditRepo }) {
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

      // Reautenticación obligatoria del administrador antes de modificar privilegios.
      const adminRow = await usersRepo.findById(actor.id);
      if (!adminRow) {
        throw new AppError(401, 'Sesión inválida.', { code: 'UNAUTHORIZED' });
      }
      const passwordOk = await verifyPassword(adminRow.password_hash, currentPassword);
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

      return withTx(async (client) => {
        const target = await usersRepo.findById(targetUserId, client);
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

        if (target.role === 'admin' && role !== 'admin') {
          const totalAdmins = await usersRepo.countAdmins(client);
          if (totalAdmins <= 1) {
            throw new AppError(409, 'Debe permanecer al menos un administrador activo en el sistema.', {
              code: 'LAST_ADMIN_PROTECTED',
            });
          }
        }

        const updated = await usersRepo.updateRole(target.id, role, client);
        await auditRepo.insert(
          {
            eventType: 'role_changed',
            severity: 'warn',
            actorUserId: actor.id,
            targetUserId: target.id,
            ipAddress,
            requestPath,
            details: { previousRole: target.role, newRole: role },
          },
          client
        );

        return updated;
      });
    },
  });
}
