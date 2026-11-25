import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function buildAad({ ownerId, recordId, field, keyVersion }) {
  if (!ownerId || !recordId || !field || !keyVersion) {
    throw new Error('Contexto AAD incompleto para cifrado autenticado.');
  }
  return Buffer.from(`entre-lineas:v1|owner:${ownerId}|record:${recordId}|field:${field}|kv:${keyVersion}`, 'utf8');
}

export function createCryptoService({ activeKeyVersion, encryptionKeys }) {
  if (!encryptionKeys || !encryptionKeys.has(activeKeyVersion)) {
    throw new Error('Servicio criptográfico inicializado sin llave activa válida.');
  }

  function getKey(keyVersion) {
    const key = encryptionKeys.get(keyVersion);
    if (!key || key.length !== 32) {
      throw new Error(`No existe una llave AES-256 válida para la versión "${keyVersion}".`);
    }
    return key;
  }

  function encryptField(plaintext, { ownerId, recordId, field, keyVersion = activeKeyVersion }) {
    if (typeof plaintext !== 'string') {
      throw new TypeError('El valor a cifrar debe ser texto.');
    }

    const key = getKey(keyVersion);
    const iv = randomBytes(IV_LENGTH);
    const aad = buildAad({ ownerId, recordId, field, keyVersion });

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    cipher.setAAD(aad);

    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext,
      iv,
      tag,
      keyVersion,
    };
  }

  function decryptField({ ciphertext, iv, tag, keyVersion }, { ownerId, recordId, field }) {
    if (!Buffer.isBuffer(ciphertext) || !Buffer.isBuffer(iv) || !Buffer.isBuffer(tag)) {
      throw new Error('Datos cifrados con formato inválido.');
    }
    if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Longitud inválida de IV o tag de autenticación.');
    }

    const key = getKey(keyVersion);
    const aad = buildAad({ ownerId, recordId, field, keyVersion });

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);

    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  }

  return Object.freeze({
    activeKeyVersion,
    encryptField,
    decryptField,
    hasKeyVersion(version) {
      return encryptionKeys.has(version);
    },
  });
}

export function maskPhone(phone) {
  if (!phone) return null;
  const trimmed = String(phone).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length <= 4) {
    return '••••';
  }
  const visible = digits.slice(-4);
  return `•••• •••• ${visible}`;
}

export function maskSensitiveValue(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) {
    return '••••';
  }
  return `${'•'.repeat(Math.min(10, trimmed.length - 2))}${trimmed.slice(-2)}`;
}
