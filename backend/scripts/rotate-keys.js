import { loadConfig } from '../src/config/env.js';
import { createDbPool, withTransaction } from '../src/db/pool.js';
import { createCryptoService } from '../src/security/crypto.js';
import { createUsersRepository } from '../src/repositories/usersRepository.js';
import { createDiaryRepository } from '../src/repositories/diaryRepository.js';
import { createAuditRepository } from '../src/repositories/auditRepository.js';

async function main() {
  const config = loadConfig();
  const pool = createDbPool(config);
  const cryptoService = createCryptoService({
    activeKeyVersion: config.activeKeyVersion,
    encryptionKeys: config.encryptionKeys,
  });

  const usersRepo = createUsersRepository(pool);
  const diaryRepo = createDiaryRepository(pool);
  const auditRepo = createAuditRepository(pool);

  const targetVersion = config.activeKeyVersion;
  let rotatedEntries = 0;
  let rotatedUsers = 0;

  try {
    await withTransaction(pool, async (client) => {
      const outdatedEntries = await diaryRepo.listWithOutdatedKeyVersion(targetVersion, client);
      for (const row of outdatedEntries) {
        const plainTitle = cryptoService.decryptField(
          {
            ciphertext: row.title_ciphertext,
            iv: row.title_iv,
            tag: row.title_tag,
            keyVersion: row.key_version,
          },
          { ownerId: row.owner_id, recordId: row.id, field: 'title' }
        );
        const plainContent = cryptoService.decryptField(
          {
            ciphertext: row.content_ciphertext,
            iv: row.content_iv,
            tag: row.content_tag,
            keyVersion: row.key_version,
          },
          { ownerId: row.owner_id, recordId: row.id, field: 'content' }
        );

        const newTitle = cryptoService.encryptField(plainTitle, {
          ownerId: row.owner_id,
          recordId: row.id,
          field: 'title',
          keyVersion: targetVersion,
        });
        const newContent = cryptoService.encryptField(plainContent, {
          ownerId: row.owner_id,
          recordId: row.id,
          field: 'content',
          keyVersion: targetVersion,
        });

        await diaryRepo.updateReencryptedEntry(
          {
            id: row.id,
            ownerId: row.owner_id,
            titleCrypto: newTitle,
            contentCrypto: newContent,
            keyVersion: targetVersion,
          },
          client
        );
        rotatedEntries += 1;
      }

      const outdatedUsers = await usersRepo.listWithOutdatedKeyVersion(targetVersion, client);
      for (const user of outdatedUsers) {
        let phoneCrypto = user.phone_ciphertext
          ? {
              ciphertext: user.phone_ciphertext,
              iv: user.phone_iv,
              tag: user.phone_tag,
              keyVersion: user.phone_key_version,
            }
          : null;

        if (phoneCrypto && phoneCrypto.keyVersion !== targetVersion) {
          const plainPhone = cryptoService.decryptField(phoneCrypto, {
            ownerId: user.id,
            recordId: user.id,
            field: 'phone',
          });
          phoneCrypto = cryptoService.encryptField(plainPhone, {
            ownerId: user.id,
            recordId: user.id,
            field: 'phone',
            keyVersion: targetVersion,
          });
        }

        let sensitiveNoteCrypto = user.sensitive_note_ciphertext
          ? {
              ciphertext: user.sensitive_note_ciphertext,
              iv: user.sensitive_note_iv,
              tag: user.sensitive_note_tag,
              keyVersion: user.sensitive_note_key_version,
            }
          : null;

        if (sensitiveNoteCrypto && sensitiveNoteCrypto.keyVersion !== targetVersion) {
          const plainNote = cryptoService.decryptField(sensitiveNoteCrypto, {
            ownerId: user.id,
            recordId: user.id,
            field: 'sensitive_note',
          });
          sensitiveNoteCrypto = cryptoService.encryptField(plainNote, {
            ownerId: user.id,
            recordId: user.id,
            field: 'sensitive_note',
            keyVersion: targetVersion,
          });
        }

        await usersRepo.updateReencryptedFields(
          { id: user.id, phoneCrypto, sensitiveNoteCrypto },
          client
        );
        rotatedUsers += 1;
      }

      await auditRepo.insert(
        {
          eventType: 'keys_rotated',
          severity: 'info',
          details: { targetVersion, rotatedEntries, rotatedUsers },
        },
        client
      );
    });

    console.log(
      `Rotación completada hacia versión "${targetVersion}". Entradas re-cifradas: ${rotatedEntries}. Perfiles re-cifrados: ${rotatedUsers}.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error durante la rotación de llaves:', err.message);
  process.exit(1);
});
