import argon2 from 'argon2';

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB mínimo OWASP / requisito del proyecto
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
});

let cachedDummyHash = null;

export async function hashPassword(plainPassword) {
  return argon2.hash(plainPassword, ARGON2_OPTIONS);
}

export async function verifyPassword(storedHash, candidatePassword) {
  if (typeof storedHash !== 'string' || typeof candidatePassword !== 'string') {
    return false;
  }
  try {
    return await argon2.verify(storedHash, candidatePassword);
  } catch {
    return false;
  }
}

/**
 * Ejecuta una verificación dummy cuando el correo no existe para reducir
 * diferencias observables de tiempo en el endpoint de login.
 */
export async function verifyAgainstDummy(candidatePassword) {
  if (!cachedDummyHash) {
    cachedDummyHash = await hashPassword('Dummy!Password#NotUsed2026');
  }
  await verifyPassword(cachedDummyHash, candidatePassword || 'invalid');
}
