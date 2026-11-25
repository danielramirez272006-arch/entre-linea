import { randomUUID } from 'node:crypto';
import { MAX_DIARY_ENTRIES_PER_USER } from '../validators/schemas.js';
import { AppError } from './errors.js';

export function createDiaryService({ withTx, usersRepo, diaryRepo, cryptoService, auditRepo, logger }) {
  /**
   * Registra intentos denegados de acceso sobre entradas inexistentes o ajenas
   * fuera de cualquier transacción con rollback, sin revelar existencia del recurso.
   * Si falla la auditoría, registra el incidente de forma segura y el acceso sigue denegado.
   */
  async function recordDeniedEntryAccess({ actorUserId, entryId, action, ipAddress = null, requestPath = null }) {
    if (!auditRepo) return;
    try {
      await auditRepo.insert({
        eventType: 'diary_access_denied',
        severity: 'warn',
        actorUserId,
        ipAddress,
        requestPath,
        details: { action, targetEntryId: entryId },
      });
    } catch (err) {
      logger?.error(
        { event: 'diary_audit_insert_failed', action, code: err?.code },
        'No se pudo registrar intento denegado en bitácora de diario'
      );
    }
  }

  function decryptRow(row) {
    const title = cryptoService.decryptField(
      {
        ciphertext: row.title_ciphertext,
        iv: row.title_iv,
        tag: row.title_tag,
        keyVersion: row.key_version,
      },
      { ownerId: row.owner_id, recordId: row.id, field: 'title' }
    );

    const content = cryptoService.decryptField(
      {
        ciphertext: row.content_ciphertext,
        iv: row.content_iv,
        tag: row.content_tag,
        keyVersion: row.key_version,
      },
      { ownerId: row.owner_id, recordId: row.id, field: 'content' }
    );

    return {
      id: row.id,
      entryDate: row.entry_date,
      category: row.category,
      mood: row.mood,
      title,
      content,
      version: row.version,
      keyVersion: row.key_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  return Object.freeze({
    async listEntries(ownerId, { search = '', category = '', mood = '' } = {}) {
      const rows = await diaryRepo.listByOwner(ownerId, {
        category: category || undefined,
        mood: mood || undefined,
      });

      const decrypted = rows.map(decryptRow);
      const needle = search.trim().toLowerCase();

      const filtered = needle
        ? decrypted.filter(
            (entry) =>
              entry.title.toLowerCase().includes(needle) ||
              entry.content.toLowerCase().includes(needle)
          )
        : decrypted;

      const totalCount = await diaryRepo.countByOwner(ownerId);

      return {
        entries: filtered,
        totalCount,
        maxEntries: MAX_DIARY_ENTRIES_PER_USER,
      };
    },

    async getEntry(ownerId, entryId, requestContext = {}) {
      const row = await diaryRepo.findByIdAndOwner(entryId, ownerId);
      if (!row) {
        await recordDeniedEntryAccess({
          actorUserId: ownerId,
          entryId,
          action: 'read',
          ipAddress: requestContext.ipAddress,
          requestPath: requestContext.requestPath,
        });
        throw new AppError(404, 'Entrada no encontrada.', { code: 'ENTRY_NOT_FOUND' });
      }
      return decryptRow(row);
    },

    async createEntry(ownerId, { title, entryDate, category, mood, content }) {
      const entryId = randomUUID();
      const keyVersion = cryptoService.activeKeyVersion;

      const titleCrypto = cryptoService.encryptField(title, {
        ownerId,
        recordId: entryId,
        field: 'title',
        keyVersion,
      });
      const contentCrypto = cryptoService.encryptField(content, {
        ownerId,
        recordId: entryId,
        field: 'content',
        keyVersion,
      });

      const created = await withTx(async (client) => {
        // Bloquea la fila del usuario para garantizar el límite de 100 entradas ante concurrencia.
        const locked = await usersRepo.lockRowForUpdate(ownerId, client);
        if (!locked) {
          throw new AppError(404, 'Usuario no encontrado.', { code: 'USER_NOT_FOUND' });
        }

        const currentCount = await diaryRepo.countByOwner(ownerId, client);
        if (currentCount >= MAX_DIARY_ENTRIES_PER_USER) {
          throw new AppError(
            409,
            `Has alcanzado el límite de ${MAX_DIARY_ENTRIES_PER_USER} entradas en tu diario.`,
            { code: 'ENTRY_LIMIT_REACHED' }
          );
        }

        return diaryRepo.create(
          {
            id: entryId,
            ownerId,
            entryDate,
            category,
            mood,
            titleCrypto,
            contentCrypto,
            keyVersion,
          },
          client
        );
      });

      return decryptRow(created);
    },

    async updateEntry(ownerId, entryId, { title, entryDate, category, mood, content, version }, requestContext = {}) {
      const keyVersion = cryptoService.activeKeyVersion;
      const titleCrypto = cryptoService.encryptField(title, {
        ownerId,
        recordId: entryId,
        field: 'title',
        keyVersion,
      });
      const contentCrypto = cryptoService.encryptField(content, {
        ownerId,
        recordId: entryId,
        field: 'content',
        keyVersion,
      });

      let notFound = false;

      try {
        const updated = await withTx(async (client) => {
          const existing = await diaryRepo.findByIdAndOwner(entryId, ownerId, client);
          if (!existing) {
            notFound = true;
            throw new AppError(404, 'Entrada no encontrada.', { code: 'ENTRY_NOT_FOUND' });
          }

          if (existing.version !== version) {
            throw new AppError(
              409,
              'Esta entrada fue modificada en otra pestaña o sesión. Revisa la versión más reciente antes de guardar.',
              {
                code: 'VERSION_CONFLICT',
                details: {
                  currentEntry: decryptRow(existing),
                },
              }
            );
          }

          const row = await diaryRepo.updateWithVersion(
            {
              id: entryId,
              ownerId,
              expectedVersion: version,
              entryDate,
              category,
              mood,
              titleCrypto,
              contentCrypto,
              keyVersion,
            },
            client
          );

          if (!row) {
            const latest = await diaryRepo.findByIdAndOwner(entryId, ownerId, client);
            throw new AppError(
              409,
              'Esta entrada fue modificada en otra pestaña o sesión. Revisa la versión más reciente antes de guardar.',
              {
                code: 'VERSION_CONFLICT',
                details: {
                  currentEntry: latest ? decryptRow(latest) : null,
                },
              }
            );
          }

          return row;
        });

        return decryptRow(updated);
      } catch (err) {
        if (notFound) {
          // Persistido fuera de la transacción para que el ROLLBACK nunca borre el evento de auditoría.
          await recordDeniedEntryAccess({
            actorUserId: ownerId,
            entryId,
            action: 'update',
            ipAddress: requestContext.ipAddress,
            requestPath: requestContext.requestPath,
          });
        }
        throw err;
      }
    },

    async deleteEntry(ownerId, entryId, requestContext = {}) {
      const deleted = await diaryRepo.deleteByIdAndOwner(entryId, ownerId);
      if (!deleted) {
        await recordDeniedEntryAccess({
          actorUserId: ownerId,
          entryId,
          action: 'delete',
          ipAddress: requestContext.ipAddress,
          requestPath: requestContext.requestPath,
        });
        throw new AppError(404, 'Entrada no encontrada.', { code: 'ENTRY_NOT_FOUND' });
      }
      return { deleted: true };
    },
  });
}
