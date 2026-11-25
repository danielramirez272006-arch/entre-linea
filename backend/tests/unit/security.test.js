import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../../src/security/password.js';
import { createCryptoService, maskPhone, maskSensitiveValue } from '../../src/security/crypto.js';
import { registerSchema, passwordSchema } from '../../src/validators/schemas.js';

describe('Seguridad criptográfica y validación', () => {
  it('genera hashes Argon2id con memoria >= 19456 KiB, t >= 2 y p = 1', async () => {
    const hash = await hashPassword('MiClave!Segura2026');
    assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    assert.equal(await verifyPassword(hash, 'MiClave!Segura2026'), true);
    assert.equal(await verifyPassword(hash, 'OtraClave!Distinta2026'), false);
  });

  it('cifra con AES-256-GCM usando IV aleatorio de 12 bytes, tag de 16 bytes y AAD', () => {
    const keyV1 = randomBytes(32);
    const cryptoSvc = createCryptoService({
      activeKeyVersion: 'v1',
      encryptionKeys: new Map([['v1', keyV1]]),
    });

    const ctx = { ownerId: 'user-1', recordId: 'entry-1', field: 'content' };
    const plain = 'Texto estrictamente privado de mi diario personal.';

    const enc1 = cryptoSvc.encryptField(plain, ctx);
    const enc2 = cryptoSvc.encryptField(plain, ctx);

    assert.equal(enc1.iv.length, 12);
    assert.equal(enc1.tag.length, 16);
    assert.notDeepEqual(enc1.iv, enc2.iv, 'Cada cifrado debe usar un IV nuevo');
    assert.equal(enc1.ciphertext.toString('utf8').includes('privado'), false);

    assert.equal(cryptoSvc.decryptField(enc1, ctx), plain);
  });

  it('impide descifrar si se altera el ciphertext, el tag o el contexto AAD', () => {
    const keyV1 = randomBytes(32);
    const cryptoSvc = createCryptoService({
      activeKeyVersion: 'v1',
      encryptionKeys: new Map([['v1', keyV1]]),
    });

    const ctx = { ownerId: 'user-1', recordId: 'entry-1', field: 'title' };
    const enc = cryptoSvc.encryptField('Mi secreto', ctx);

    // Alteración de ciphertext
    const tamperedCiphertext = Buffer.from(enc.ciphertext);
    tamperedCiphertext[0] ^= 0xff;
    assert.throws(() => {
      cryptoSvc.decryptField({ ...enc, ciphertext: tamperedCiphertext }, ctx);
    });

    // Alteración de tag
    const tamperedTag = Buffer.from(enc.tag);
    tamperedTag[0] ^= 0x01;
    assert.throws(() => {
      cryptoSvc.decryptField({ ...enc, tag: tamperedTag }, ctx);
    });

    // Alteración de propietario en AAD
    assert.throws(() => {
      cryptoSvc.decryptField(enc, { ...ctx, ownerId: 'user-2' });
    });
  });

  it('soporta lectura con llave anterior y re-cifrado hacia nueva versión en rotación', () => {
    const keyV1 = randomBytes(32);
    const keyV2 = randomBytes(32);

    const svcV1 = createCryptoService({
      activeKeyVersion: 'v1',
      encryptionKeys: new Map([['v1', keyV1]]),
    });
    const ctx = { ownerId: 'u-1', recordId: 'r-1', field: 'content' };
    const oldEnc = svcV1.encryptField('Contenido previo a rotación', ctx);

    const svcV2 = createCryptoService({
      activeKeyVersion: 'v2',
      encryptionKeys: new Map([
        ['v1', keyV1],
        ['v2', keyV2],
      ]),
    });

    const decrypted = svcV2.decryptField(oldEnc, ctx);
    assert.equal(decrypted, 'Contenido previo a rotación');

    const rotated = svcV2.encryptField(decrypted, { ...ctx, keyVersion: 'v2' });
    assert.equal(rotated.keyVersion, 'v2');
    assert.equal(svcV2.decryptField(rotated, ctx), 'Contenido previo a rotación');
  });

  it('aplica la política de contraseñas y rechaza envío de rol en registro', () => {
    assert.equal(passwordSchema.safeParse('corta').success, false);
    assert.equal(passwordSchema.safeParse('sinmayusculas123!').success, false);
    assert.equal(passwordSchema.safeParse('SINMINUSCULAS123!').success, false);
    assert.equal(passwordSchema.safeParse('SinNumerosAqui!').success, false);
    assert.equal(passwordSchema.safeParse('SinSimbolos12345').success, false);
    assert.equal(passwordSchema.safeParse('Valida#Clave2026').success, true);

    const withRole = registerSchema.safeParse({
      name: 'Ana',
      email: 'ana@ejemplo.com',
      password: 'Valida#Clave2026',
      role: 'admin',
    });
    assert.equal(withRole.success, false, 'El esquema estricto debe rechazar el campo role');
  });

  it('enmascara teléfono y dato sensible sin exponer el valor completo', () => {
    assert.equal(maskPhone('+506 8888-1234'), '•••• •••• 1234');
    assert.equal(maskSensitiveValue('CODIGO-SECRETO-99'), '••••••••••99');
  });
});
