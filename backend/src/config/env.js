import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Carga .env desde la raíz del monorepo sin sobrescribir variables ya definidas en el entorno.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const KEY_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

function parseKeyring(rawJson, activeVersion) {
  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('ENCRYPTION_KEYS_JSON debe ser un objeto JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('ENCRYPTION_KEYS_JSON debe ser un objeto con pares versión:llave.');
  }

  const keys = new Map();
  for (const [version, hexValue] of Object.entries(parsed)) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version)) {
      throw new Error(`Versión de llave inválida: "${version}".`);
    }
    if (typeof hexValue !== 'string' || !KEY_HEX_REGEX.test(hexValue)) {
      throw new Error(
        `La llave de cifrado "${version}" debe tener exactamente 64 caracteres hexadecimales (32 bytes / 256 bits).`
      );
    }
    const buf = Buffer.from(hexValue, 'hex');
    if (buf.length !== 32) {
      throw new Error(`La llave de cifrado "${version}" no mide 32 bytes.`);
    }
    keys.set(version, buf);
  }

  if (keys.size === 0) {
    throw new Error('ENCRYPTION_KEYS_JSON debe contener al menos una llave de 32 bytes.');
  }

  if (!keys.has(activeVersion)) {
    throw new Error(
      `ENCRYPTION_ACTIVE_KEY_VERSION ("${activeVersion}") no existe en ENCRYPTION_KEYS_JSON.`
    );
  }

  return keys;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z
    .string()
    .url()
    .refine((val) => {
      const u = new URL(val);
      return u.protocol === 'http:' || u.protocol === 'https:';
    }, 'APP_ORIGIN debe usar http o https')
    .default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z.string().min(1).optional(),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  DB_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),

  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{2,40}$/)
    .default('el_sid'),
  SESSION_TTL_HOURS: z.coerce.number().min(0.1).max(720).default(24),
  SESSION_ABSOLUTE_TTL_HOURS: z.coerce.number().min(0.1).max(2160).default(168),

  ENCRYPTION_ACTIVE_KEY_VERSION: z.string().min(1).max(32).default('v1'),
  ENCRYPTION_KEYS_JSON: z.string().min(2),

  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(15),
  MAIL_DRIVER: z.enum(['local', 'https-api']).default('local'),
  DEV_MAIL_DIR: z.string().min(1).default('backend/.dev-mail'),
  MAIL_API_URL: z.string().optional().default(''),
  MAIL_API_KEY: z.string().optional().default(''),
  MAIL_FROM: z.string().email().default('no-responder@entre-lineas.local'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(5).default(120),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(20).default(5),
  LOGIN_LOCKOUT_BASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  ALERT_FAILED_LOGINS_THRESHOLD: z.coerce.number().int().min(3).max(50).default(5),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
});

export function loadConfig(sourceEnv = process.env) {
  const parsed = envSchema.safeParse(sourceEnv);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno inválida: ${details}`);
  }

  const data = parsed.data;
  const encryptionKeys = parseKeyring(data.ENCRYPTION_KEYS_JSON, data.ENCRYPTION_ACTIVE_KEY_VERSION);
  const normalizedOrigin = new URL(data.APP_ORIGIN).origin;

  if (data.MAIL_DRIVER === 'https-api') {
    if (!data.MAIL_API_URL || !data.MAIL_API_URL.startsWith('https://')) {
      throw new Error('MAIL_API_URL debe ser una URL HTTPS cuando MAIL_DRIVER=https-api.');
    }
    if (!data.MAIL_API_KEY) {
      throw new Error('MAIL_API_KEY es obligatorio cuando MAIL_DRIVER=https-api.');
    }
  }

  const devMailDir = path.isAbsolute(data.DEV_MAIL_DIR)
    ? data.DEV_MAIL_DIR
    : path.resolve(PROJECT_ROOT, data.DEV_MAIL_DIR);

  return Object.freeze({
    nodeEnv: data.NODE_ENV,
    isProduction: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
    port: data.PORT,
    appOrigin: normalizedOrigin,
    trustProxy: data.TRUST_PROXY,

    databaseUrl: data.DATABASE_URL,
    testDatabaseUrl: data.TEST_DATABASE_URL,
    dbQueryTimeoutMs: data.DB_QUERY_TIMEOUT_MS,
    dbStatementTimeoutMs: data.DB_STATEMENT_TIMEOUT_MS,

    sessionCookieName: data.SESSION_COOKIE_NAME,
    sessionTtlMs: Math.round(data.SESSION_TTL_HOURS * 60 * 60 * 1000),
    sessionAbsoluteTtlMs: Math.round(data.SESSION_ABSOLUTE_TTL_HOURS * 60 * 60 * 1000),

    activeKeyVersion: data.ENCRYPTION_ACTIVE_KEY_VERSION,
    encryptionKeys,

    passwordResetTtlMs: data.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    mailDriver: data.MAIL_DRIVER,
    devMailDir,
    mailApiUrl: data.MAIL_API_URL,
    mailApiKey: data.MAIL_API_KEY,
    mailFrom: data.MAIL_FROM,

    rateLimitWindowMs: data.RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: data.RATE_LIMIT_MAX_REQUESTS,
    loginMaxAttempts: data.LOGIN_MAX_ATTEMPTS,
    loginLockoutBaseSeconds: data.LOGIN_LOCKOUT_BASE_SECONDS,
    alertFailedLoginsThreshold: data.ALERT_FAILED_LOGINS_THRESHOLD,

    logLevel: data.LOG_LEVEL,
  });
}
