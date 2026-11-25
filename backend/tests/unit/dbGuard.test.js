import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntegrationTestConfig } from '../integration/dbGuard.js';

describe('Protección de base de datos de pruebas (dbGuard)', () => {
  it('omite la ejecución cuando falta TEST_DATABASE_URL aunque exista DATABASE_URL', () => {
    const res = validateIntegrationTestConfig({
      testDatabaseUrl: '',
      databaseUrl: 'postgres://postgres:secret@localhost:5432/entre_lineas',
      nodeEnv: 'test',
    });
    assert.equal(res.run, false);
    assert.equal(res.unsafe, false);
    assert.match(res.reason, /TEST_DATABASE_URL/);
  });

  it('rechaza configuraciones inseguras: NODE_ENV != test, nombre no exclusivo de pruebas, misma BD o host remoto', () => {
    const badEnv = validateIntegrationTestConfig({
      testDatabaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas_test',
      nodeEnv: 'development',
    });
    assert.equal(badEnv.run, false);
    assert.equal(badEnv.unsafe, true);

    const prodName = validateIntegrationTestConfig({
      testDatabaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas',
      nodeEnv: 'test',
    });
    assert.equal(prodName.run, false);
    assert.equal(prodName.unsafe, true);

    const sameAsApp = validateIntegrationTestConfig({
      testDatabaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas_test',
      databaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas_test',
      nodeEnv: 'test',
    });
    assert.equal(sameAsApp.run, false);
    assert.equal(sameAsApp.unsafe, true);

    const remoteHost = validateIntegrationTestConfig({
      testDatabaseUrl: 'postgres://postgres:x@db.remoto.ejemplo:5432/entre_lineas_test',
      nodeEnv: 'test',
    });
    assert.equal(remoteHost.run, false);
    assert.equal(remoteHost.unsafe, true);
  });

  it('permite una base local exclusiva de pruebas con NODE_ENV=test', () => {
    const ok = validateIntegrationTestConfig({
      testDatabaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas_test',
      databaseUrl: 'postgres://postgres:x@localhost:5432/entre_lineas',
      nodeEnv: 'test',
    });
    assert.equal(ok.run, true);
    assert.equal(ok.unsafe, false);
    assert.equal(ok.dbName, 'entre_lineas_test');
  });
});
