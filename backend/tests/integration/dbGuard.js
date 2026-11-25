const FORBIDDEN_DB_NAMES = new Set([
  '',
  'postgres',
  'template0',
  'template1',
  'entre_lineas',
  'production',
  'prod',
  'main',
  'defaultdb',
]);

const ALLOWED_TEST_DB_PATTERN = /(^test_|_test$|_testing$|-test$)/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function normalizeDbIdentity(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';
  const dbName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  return { protocol: parsed.protocol, host, port, dbName };
}

/**
 * Valida estrictamente que la configuración de integración apunte
 * exclusivamente a una base de datos desechable de pruebas.
 * Rechaza cualquier configuración ambigua o insegura antes de conectar o truncar.
 */
export function validateIntegrationTestConfig({
  testDatabaseUrl = process.env.TEST_DATABASE_URL,
  databaseUrl = process.env.DATABASE_URL,
  nodeEnv = process.env.NODE_ENV,
  allowRemote = process.env.ALLOW_REMOTE_TEST_DB === 'true',
} = {}) {
  if (!testDatabaseUrl || !testDatabaseUrl.trim()) {
    return {
      run: false,
      unsafe: false,
      reason:
        'TEST_DATABASE_URL no está configurada. La suite de integración no se ejecutó (nunca se usa DATABASE_URL como respaldo).',
    };
  }

  if (nodeEnv !== 'test') {
    return {
      run: false,
      unsafe: true,
      reason: `Configuración insegura: NODE_ENV debe ser "test" para ejecutar pruebas destructivas (valor actual: "${nodeEnv || 'undefined'}").`,
    };
  }

  let testDb;
  try {
    testDb = normalizeDbIdentity(testDatabaseUrl.trim());
  } catch {
    return {
      run: false,
      unsafe: true,
      reason: 'Configuración insegura: TEST_DATABASE_URL no es una URL válida.',
    };
  }

  if (testDb.protocol !== 'postgres:' && testDb.protocol !== 'postgresql:') {
    return {
      run: false,
      unsafe: true,
      reason: `Configuración insegura: protocolo no permitido en TEST_DATABASE_URL ("${testDb.protocol}").`,
    };
  }

  if (!allowRemote && !LOCAL_HOSTS.has(testDb.host)) {
    return {
      run: false,
      unsafe: true,
      reason: `Configuración insegura: TEST_DATABASE_URL apunta a un host remoto ("${testDb.host}"). Usa una base local o define ALLOW_REMOTE_TEST_DB=true explícitamente.`,
    };
  }

  if (FORBIDDEN_DB_NAMES.has(testDb.dbName.toLowerCase()) || !ALLOWED_TEST_DB_PATTERN.test(testDb.dbName)) {
    return {
      run: false,
      unsafe: true,
      reason: `Configuración insegura: el nombre de base "${testDb.dbName || '(vacío)'}" no es exclusivo de pruebas (debe terminar en "_test", "-test", "_testing" o iniciar con "test_").`,
    };
  }

  if (databaseUrl && databaseUrl.trim()) {
    try {
      const appDb = normalizeDbIdentity(databaseUrl.trim());
      if (appDb.host === testDb.host && appDb.port === testDb.port && appDb.dbName === testDb.dbName) {
        return {
          run: false,
          unsafe: true,
          reason: `Configuración insegura: TEST_DATABASE_URL apunta a la misma base que DATABASE_URL ("${testDb.dbName}").`,
        };
      }
    } catch {
      // Si DATABASE_URL está malformada, seguimos protegiendo con las validaciones previas.
    }
  }

  return {
    run: true,
    unsafe: false,
    url: testDatabaseUrl.trim(),
    dbName: testDb.dbName,
  };
}
