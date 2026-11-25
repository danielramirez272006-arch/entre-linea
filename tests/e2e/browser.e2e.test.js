import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { createDbPool } from '../../backend/src/db/pool.js';
import { createApp } from '../../backend/src/app.js';
import { createLogger } from '../../backend/src/config/logger.js';
import { runMigrations } from '../../backend/scripts/migrate.js';
import { validateIntegrationTestConfig } from '../../backend/tests/integration/dbGuard.js';

const guard = validateIntegrationTestConfig();
const requireBrowserDb = process.env.CI === 'true' || process.env.REQUIRE_INTEGRATION_DB === 'true';

if (guard.unsafe) {
  throw new Error(`EJECUCIÓN ABORTADA POR SEGURIDAD: ${guard.reason}`);
}

async function probePostgres(url) {
  const probePool = createDbPool({
    databaseUrl: url,
    dbQueryTimeoutMs: 3000,
    dbStatementTimeoutMs: 3000,
  });
  try {
    await probePool.query('SELECT 1');
    return { ok: true, pool: probePool };
  } catch (err) {
    await probePool.end().catch(() => {});
    return { ok: false, reason: `PostgreSQL de pruebas no accesible: ${err.message || err.code}` };
  }
}

const pgStatus = guard.run ? await probePostgres(guard.url) : { ok: false, reason: guard.reason };

if (!pgStatus.ok) {
  if (requireBrowserDb) {
    throw new Error(`PRUEBAS DE NAVEGADOR OBLIGATORIAS EN CI FALLIDAS: ${pgStatus.reason}`);
  }
  console.warn(`[browser-e2e] Suite NO ejecutada: ${pgStatus.reason}`);
}

async function launchBrowser() {
  const winChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  if (process.env.CI !== 'true' && process.platform === 'win32' && fs.existsSync(winChrome)) {
    return chromium.launch({ headless: true, executablePath: winChrome });
  }
  return chromium.launch({ headless: true });
}

describe(
  'Flujos completos en navegador (Playwright + React + Express + PostgreSQL desechable)',
  { skip: !pgStatus.ok ? pgStatus.reason : false },
  () => {
    let pool;
    let server;
    let baseUrl;
    let browser;
    let tmpMailDir;

    before(async () => {
      pool = pgStatus.pool;
      await runMigrations(pool);
      await pool.query(
        'TRUNCATE TABLE diary_entries, sessions, password_reset_tokens, security_audit_logs, rate_limits, users RESTART IDENTITY CASCADE'
      );

      tmpMailDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'entre-lineas-e2e-mail-'));
      const keyV1 = randomBytes(32);

      // Primero reservamos puerto efímero para construir APP_ORIGIN exacto.
      const tempServer = http.createServer();
      await new Promise((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
      const { port } = tempServer.address();
      await new Promise((resolve) => tempServer.close(resolve));

      baseUrl = `http://127.0.0.1:${port}`;
      const config = Object.freeze({
        nodeEnv: 'test',
        isProduction: false,
        isTest: true,
        port,
        appOrigin: baseUrl,
        trustProxy: 0,
        databaseUrl: guard.url,
        dbQueryTimeoutMs: 5000,
        dbStatementTimeoutMs: 5000,
        sessionCookieName: 'el_sid',
        sessionTtlMs: 60 * 60 * 1000,
        sessionAbsoluteTtlMs: 24 * 60 * 60 * 1000,
        activeKeyVersion: 'v1',
        encryptionKeys: new Map([['v1', keyV1]]),
        passwordResetTtlMs: 15 * 60 * 1000,
        mailDriver: 'local',
        devMailDir: tmpMailDir,
        mailTimeoutMs: 5000,
        rateLimitWindowMs: 60_000,
        rateLimitMaxRequests: 500,
        loginMaxAttempts: 5,
        loginLockoutBaseSeconds: 30,
        alertFailedLoginsThreshold: 5,
        logLevel: 'silent',
      });

      const app = createApp({ config, logger: createLogger('silent'), pool });
      server = http.createServer(app);
      await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
      browser = await launchBrowser();
    });

    after(async () => {
      if (browser) await browser.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      if (pool) await pool.end();
      if (tmpMailDir) await fsp.rm(tmpMailDir, { recursive: true, force: true });
    });

    it('recorre registro, validación, CRUD, búsqueda/filtros, error de red, conflictos entre pestañas, borradores, perfil, admin, recuperación y responsive', async () => {
      const consoleErrors = [];
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const page = await context.newPage();
      page.on('pageerror', (err) => consoleErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      // 1. Registro con validación fallida y luego registro válido (Cuenta ficticia A)
      await page.goto(`${baseUrl}/registro`);
      await page.getByLabel(/Nombre/).fill('Ana Prueba');
      await page.getByLabel(/Correo electrónico/).fill('ana.e2e@ejemplo.test');
      await page.getByLabel(/^Contraseña/).fill('debil');
      await page.getByRole('button', { name: 'Registrarme' }).click();
      await page.getByRole('alert').first().waitFor();

      await page.getByLabel(/^Contraseña/).fill('Clave!AnaE2E2026');
      await page.getByRole('button', { name: 'Registrarme' }).click();
      await page.waitForURL(`${baseUrl}/diario`);
      await page.getByText('Tu libreta está lista para empezar').waitFor();

      // 2. Crear dos entradas, buscar y filtrar
      await page.getByRole('button', { name: '+ Nueva entrada' }).click();
      await page.getByLabel(/Título/).fill('Mañana serena');
      await page.getByLabel(/Categoría/).selectOption('gratitud');
      await page.getByLabel(/Estado de ánimo/).selectOption('tranquilo');
      await page.getByLabel(/Contenido/).fill('Agradecida por una caminata tranquila.');
      await page.getByRole('button', { name: 'Guardar entrada' }).click();
      await page.getByText('Mañana serena').waitFor();

      await page.getByRole('button', { name: '+ Nueva entrada' }).click();
      await page.getByLabel(/Título/).fill('Meta semanal');
      await page.getByLabel(/Categoría/).selectOption('metas');
      await page.getByLabel(/Estado de ánimo/).selectOption('bien');
      await page.getByLabel(/Contenido/).fill('Terminar pruebas de seguridad.');
      await page.getByRole('button', { name: 'Guardar entrada' }).click();
      await page.getByText('Meta semanal').waitFor();

      // Búsqueda y filtro
      await page.getByLabel('Buscar en tu diario').fill('caminata');
      await page.getByText('Mostrando 1 de 2 entradas.').waitFor();
      assert.equal(await page.getByText('Meta semanal').count(), 0);
      await page.getByRole('button', { name: 'Limpiar filtros' }).click();
      await page.getByText('Meta semanal').waitFor();

      // 3. Conservación de texto cuando falla el guardado por error de red
      await page.locator('article', { hasText: 'Mañana serena' }).getByRole('button', { name: 'Abrir entrada' }).click();
      await page.getByLabel(/Contenido/).fill('Texto editado que debe conservarse ante fallo de red.');
      await page.route('**/api/diary/*', (route) => {
        if (route.request().method() === 'PUT') {
          return route.abort('failed');
        }
        return route.continue();
      });
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText(/resultado de la operación podría haber quedado incierto/i).waitFor();
      assert.equal(
        await page.getByLabel(/Contenido/).inputValue(),
        'Texto editado que debe conservarse ante fallo de red.'
      );
      await page.unroute('**/api/diary/*');

      // 4. Conflicto de edición entre dos pestañas
      const page2 = await context.newPage();
      await page2.goto(`${baseUrl}/diario`);
      await page2.locator('article', { hasText: 'Mañana serena' }).getByRole('button', { name: 'Abrir entrada' }).click();

      // Pestaña 1 guarda versión 2
      await page.getByRole('button', { name: 'Guardar cambios' }).click();
      await page.getByText('Cambios guardados y confirmados por el servidor.').waitFor();

      // Pestaña 2 intenta guardar con versión 1 obsoleta -> conflicto 409 visible
      await page2.getByLabel(/Contenido/).fill('Edición desde pestaña atrasada');
      await page2.getByRole('button', { name: 'Guardar cambios' }).click();
      await page2.getByText('Conflicto de edición').waitFor();
      await page2.close();

      // 5. Confirmación de eliminación + teclado Escape devuelve foco y luego elimina
      await page.locator('article', { hasText: 'Meta semanal' }).getByRole('button', { name: 'Abrir entrada' }).click();
      const deleteBtn = page.getByRole('button', { name: 'Eliminar entrada' });
      await deleteBtn.click();
      await page.getByRole('dialog', { name: 'Eliminar entrada' }).waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('dialog').count(), 0);
      await deleteBtn.click();
      await page.getByRole('button', { name: 'Sí, eliminar' }).click();
      await page.getByText('Entrada eliminada correctamente.').waitFor();

      // 6. Protección de borradores al navegar, volver atrás, cerrar sesión y cerrar editor
      await page.getByRole('link', { name: 'Perfil' }).click();
      await page.waitForURL(`${baseUrl}/perfil`);
      await page.getByRole('link', { name: 'Mi diario' }).click();
      await page.waitForURL(`${baseUrl}/diario`);

      await page.getByRole('button', { name: '+ Nueva entrada' }).click();
      await page.getByLabel(/Título/).fill('Borrador E2E');
      await page.getByLabel(/Contenido/).fill('No perder este texto');

      // Navegar a Perfil -> cancelar
      await page.getByRole('link', { name: 'Perfil' }).click();
      await page.getByRole('dialog', { name: 'Cambios sin guardar' }).waitFor();
      await page.getByRole('button', { name: 'Seguir editando' }).click();
      assert.equal(await page.getByLabel(/Contenido/).inputValue(), 'No perder este texto');

      // Navegar Atrás -> cancelar
      await page.goBack();
      await page.getByRole('dialog', { name: 'Cambios sin guardar' }).waitFor();
      await page.getByRole('button', { name: 'Seguir editando' }).click();
      assert.equal(await page.getByLabel(/Contenido/).inputValue(), 'No perder este texto');

      // Cerrar sesión -> cancelar
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await page.getByRole('dialog', { name: 'Cambios sin guardar' }).waitFor();
      await page.getByRole('button', { name: 'Seguir editando' }).click();
      assert.equal(await page.getByLabel(/Contenido/).inputValue(), 'No perder este texto');

      // Cerrar editor -> descartar
      await page.getByRole('button', { name: 'Cancelar' }).click();
      await page.getByRole('dialog', { name: 'Cambios sin guardar' }).waitFor();
      await page.getByRole('button', { name: 'Descartar cambios' }).click();
      await page.getByText('Mañana serena').waitFor();

      // 7. Perfil y enmascaramiento del teléfono + dato sensible
      await page.getByRole('link', { name: 'Perfil' }).click();
      await page.waitForURL(`${baseUrl}/perfil`);
      await page.getByLabel('Actualizar o eliminar teléfono').check();
      await page.getByLabel('Nuevo teléfono').fill('+506 8888-4321');
      await page.getByLabel('Actualizar o eliminar dato sensible de prueba').check();
      await page.getByLabel('Nuevo dato sensible de prueba').fill('CODIGO-DEMO-88');
      await page.getByRole('button', { name: 'Guardar perfil' }).click();
      await page.getByText('Perfil actualizado correctamente.').waitFor();
      await page.getByText('•••• •••• 4321').waitFor();
      await page.getByText(/•+88/).waitFor();

      // 8. Sesión caducada (invalidación en PostgreSQL)
      await pool.query('DELETE FROM sessions');
      await page.reload();
      await page.waitForURL(`${baseUrl}/iniciar-sesion`);
      await page.getByText('Tu sesión ha caducado').waitFor();

      // 9. Separación entre cuentas y usuario normal sin acceso a /admin
      const contextB = await browser.newContext({
        viewport: { width: 390, height: 844 },
        reducedMotion: 'reduce',
      });
      const pageB = await contextB.newPage();
      await pageB.goto(`${baseUrl}/registro`);
      await pageB.getByLabel(/Nombre/).fill('Bruno Móvil');
      await pageB.getByLabel(/Correo electrónico/).fill('bruno.e2e@ejemplo.test');
      await pageB.getByLabel(/^Contraseña/).fill('Clave!BrunoE2E2026');
      await pageB.getByRole('button', { name: 'Registrarme' }).click();
      await pageB.waitForURL(`${baseUrl}/diario`);
      await pageB.getByText('Tu libreta está lista para empezar').waitFor();
      assert.equal(await pageB.getByText('Mañana serena').count(), 0);

      // Menú móvil visible y ruta /admin bloqueada para usuario normal
      await pageB.getByRole('button', { name: 'Menú' }).waitFor();
      await pageB.goto(`${baseUrl}/admin`);
      await pageB.waitForURL(`${baseUrl}/diario`);
      await contextB.close();

      // 10. Administración: promover a Ana en BD desechable, reautenticación y cambio de rol
      await pool.query(`UPDATE users SET role = 'admin' WHERE email = 'ana.e2e@ejemplo.test'`);
      await page.getByLabel(/Correo electrónico/).fill('ana.e2e@ejemplo.test');
      await page.getByLabel(/^Contraseña/).fill('Clave!AnaE2E2026');
      await page.getByRole('button', { name: 'Entrar a mi diario' }).click();
      // Al volver a iniciar sesión tras caducar en /perfil, regresa a /perfil.
      await page.waitForURL(`${baseUrl}/perfil`);

      await page.getByRole('link', { name: 'Administración' }).click();
      await page.waitForURL(`${baseUrl}/admin`);
      await page.getByText('bruno.e2e@ejemplo.test').first().waitFor();

      await page
        .locator('tr', { hasText: 'bruno.e2e@ejemplo.test' })
        .first()
        .getByRole('button', { name: 'Cambiar rol' })
        .click();
      await page.getByRole('dialog', { name: 'Confirmar cambio de rol' }).waitFor();
      await page.getByLabel(/Confirmo que autorizo/).check();
      await page.getByLabel(/Tu contraseña de administrador/).fill('Clave!AnaE2E2026');
      await page.getByRole('button', { name: 'Confirmar cambio' }).click();
      await page.getByText(/Rol actualizado para bruno\.e2e@ejemplo\.test/).waitFor();

      // Logout
      await page.getByRole('button', { name: 'Cerrar sesión' }).click();
      await page.waitForURL(`${baseUrl}/iniciar-sesion`);

      // 11. Recuperación mediante correo local + rechazo de token reutilizado
      await page.goto(`${baseUrl}/recuperar`);
      await page.getByLabel(/Correo electrónico/).fill('ana.e2e@ejemplo.test');
      await page.getByRole('button', { name: 'Enviar enlace de recuperación' }).click();
      await page.getByText(/Si el correo está registrado/).waitFor();

      const mailFiles = await fsp.readdir(tmpMailDir);
      assert.equal(mailFiles.length, 1);
      const mailBody = await fsp.readFile(path.join(tmpMailDir, mailFiles[0]), 'utf8');
      const linkMatch = mailBody.match(/http:\/\/127\.0\.0\.1:\d+\/restablecer\?token=[0-9a-f]{64}/);
      assert.ok(linkMatch);

      await page.goto(linkMatch[0]);
      await page.getByLabel(/^Nueva contraseña/).fill('Clave!AnaNueva2026');
      await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
      await page.getByText(/Tu contraseña se actualizó correctamente/).waitFor();

      // Reutilizar el mismo enlace debe rechazarse
      await page.goto(linkMatch[0]);
      await page.getByLabel(/^Nueva contraseña/).fill('Clave!AnaOtra2026');
      await page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();
      await page.getByText(/inválido, ya fue utilizado o ha caducado/i).waitFor();

      // Verificar ausencia de errores de consola inesperados (excluyendo el abort intencional de red del paso 3)
      const unexpectedConsoleErrors = consoleErrors.filter(
        (m) => !m.includes('ERR_FAILED') && !m.includes('401') && !m.includes('409') && !m.includes('400')
      );
      assert.deepEqual(unexpectedConsoleErrors, []);

      await context.close();
    });
  }
);
