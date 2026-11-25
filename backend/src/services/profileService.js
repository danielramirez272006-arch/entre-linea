import { maskPhone, maskSensitiveValue } from '../security/crypto.js';
import { AppError } from './errors.js';

export function createProfileService({ usersRepo, cryptoService }) {
  function formatProfile(user) {
    let phonePlain = null;
    if (user.phone_ciphertext) {
      phonePlain = cryptoService.decryptField(
        {
          ciphertext: user.phone_ciphertext,
          iv: user.phone_iv,
          tag: user.phone_tag,
          keyVersion: user.phone_key_version,
        },
        { ownerId: user.id, recordId: user.id, field: 'phone' }
      );
    }

    let sensitiveNotePlain = null;
    if (user.sensitive_note_ciphertext) {
      sensitiveNotePlain = cryptoService.decryptField(
        {
          ciphertext: user.sensitive_note_ciphertext,
          iv: user.sensitive_note_iv,
          tag: user.sensitive_note_tag,
          keyVersion: user.sensitive_note_key_version,
        },
        { ownerId: user.id, recordId: user.id, field: 'sensitive_note' }
      );
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      hasPhone: Boolean(phonePlain),
      phoneMasked: maskPhone(phonePlain),
      phoneKeyVersion: user.phone_key_version || null,
      hasSensitiveNote: Boolean(sensitiveNotePlain),
      sensitiveNoteMasked: maskSensitiveValue(sensitiveNotePlain),
      sensitiveNoteKeyVersion: user.sensitive_note_key_version || null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  return Object.freeze({
    async getProfile(userId) {
      const user = await usersRepo.findById(userId);
      if (!user) {
        throw new AppError(404, 'Usuario no encontrado.', { code: 'USER_NOT_FOUND' });
      }
      return formatProfile(user);
    },

    async updateProfile(userId, { name, phone, sensitiveNote }) {
      const existing = await usersRepo.findById(userId);
      if (!existing) {
        throw new AppError(404, 'Usuario no encontrado.', { code: 'USER_NOT_FOUND' });
      }

      const keyVersion = cryptoService.activeKeyVersion;

      // phone === undefined mantiene el valor existente; '' o null lo elimina explícitamente.
      let phoneCrypto = existing.phone_ciphertext
        ? {
            ciphertext: existing.phone_ciphertext,
            iv: existing.phone_iv,
            tag: existing.phone_tag,
            keyVersion: existing.phone_key_version,
          }
        : null;

      if (phone !== undefined) {
        if (phone === null || phone === '') {
          phoneCrypto = null;
        } else {
          phoneCrypto = cryptoService.encryptField(phone, {
            ownerId: userId,
            recordId: userId,
            field: 'phone',
            keyVersion,
          });
        }
      }

      let sensitiveNoteCrypto = existing.sensitive_note_ciphertext
        ? {
            ciphertext: existing.sensitive_note_ciphertext,
            iv: existing.sensitive_note_iv,
            tag: existing.sensitive_note_tag,
            keyVersion: existing.sensitive_note_key_version,
          }
        : null;

      if (sensitiveNote !== undefined) {
        if (sensitiveNote === null || sensitiveNote === '') {
          sensitiveNoteCrypto = null;
        } else {
          sensitiveNoteCrypto = cryptoService.encryptField(sensitiveNote, {
            ownerId: userId,
            recordId: userId,
            field: 'sensitive_note',
            keyVersion,
          });
        }
      }

      const updated = await usersRepo.updateProfile({
        id: userId,
        name,
        phoneCrypto,
        sensitiveNoteCrypto,
      });

      return formatProfile(updated);
    },
  });
}
