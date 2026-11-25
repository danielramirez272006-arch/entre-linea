# Entre Líneas — Diario Seguro

Aplicación web de diario personal privado construida como monorepo (`frontend` + `backend`) con enfoque de seguridad en profundidad para la etapa de desarrollo local del laboratorio SecureVault.

> **Alcance de esta etapa:** Desarrollo local, controles de seguridad, pruebas automatizadas y documentación técnica. El despliegue público, escaneos de producción y publicación en plataformas quedan para una etapa posterior.

## Tecnologías

- **Frontend (`frontend/`):** React 19, React Router 7, Vite 6, JavaScript (`.js`/`.jsx`), HTML y CSS propio con tokens de diseño (sin TypeScript ni framework visual).
- **Backend (`backend/`):** Node.js LTS (`>=20.11`), Express 5, PostgreSQL (`pg` con consultas parametrizadas), Zod 4, Argon2id (`argon2`), `node:crypto` (AES-256-GCM y SHA-256), Helmet, CORS y Pino (logs JSON redactados).

## Requisitos previos

- Node.js LTS (probado en Node.js `v24.13.0` y npm `11.4.0`).
- PostgreSQL 15+ en ejecución local para persistencia real y pruebas de integración.

## Preparación local

### 1. Instalar dependencias

Desde la raíz del proyecto (usa el `package-lock.json` único del monorepo):

```bash
npm ci
```

### 2. Configurar variables de entorno

Copia `.env.example` a `.env` en la raíz del proyecto:

```bash
cp .env.example .env
```

El servidor carga `.env` automáticamente desde la raíz mediante `backend/src/config/env.js` (los secretos permanecen exclusivamente en el servidor; cualquier variable `VITE_*` quedaría expuesta en el bundle del navegador y no se utiliza para secretos).

### 3. Generar llave maestra AES-256-GCM (32 bytes / 64 hex)

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Coloca el resultado en `.env`:

```env
ENCRYPTION_ACTIVE_KEY_VERSION=v1
ENCRYPTION_KEYS_JSON={"v1":"<64_CARACTERES_HEX>"}
```

> **Advertencia crítica sobre llaves:** Si se pierden todas las copias de la llave usada para cifrar los registros, los datos cifrados en PostgreSQL serán **irrecuperables**. Mantén respaldos seguros de tus llaves fuera del repositorio.

### 4. Crear base de datos y ejecutar migraciones

Crea la base de datos en PostgreSQL (por ejemplo `entre_lineas`) y ajusta `DATABASE_URL` en `.env`. Luego ejecuta:

```bash
npm run db:migrate
```

### 5. Crear el primer administrador

No existen credenciales fijas ni selección de rol en el registro. Crea el primer administrador mediante el comando interactivo (o variables temporales `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`):

```bash
npm run admin:create
```

## Comandos principales

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia backend Express (`:3001`) y frontend Vite (`:5173` con proxy `/api` y `/health`) |
| `npm run dev:backend` | Inicia solo el backend con `--watch` |
| `npm run dev:frontend` | Inicia solo el servidor de desarrollo Vite |
| `npm run build` | Compila el frontend React en `frontend/dist/` |
| `npm start` | Ejecuta Express sirviendo API y `frontend/dist/` en el mismo origen |
| `npm run db:migrate` | Aplica las migraciones SQL pendientes en PostgreSQL |
| `npm run admin:create` | Crea o promueve el primer administrador desde consola |
| `npm run keys:rotate` | Re-cifra entradas y campos sensibles hacia `ENCRYPTION_ACTIVE_KEY_VERSION` |
| `npm run test:unit` | Ejecuta pruebas unitarias, `dbGuard`, correo/resiliencia, auditoría y flujos HTTP (repositorio simulado) |
| `npm run test:integration` | Ejecuta pruebas de integración y concurrencia contra PostgreSQL real (`TEST_DATABASE_URL`) |
| `npm run test:browser` | Ejecuta pruebas completas de navegador Playwright (React + Express + PostgreSQL desechable) |
| `npm run test:e2e` | Ejecuta prueba HTTP de humo sirviendo `frontend/dist/` desde Express |
| `npm test` | Ejecuta pruebas unitarias e integración del servidor |
| `npm run audit:check` | Verifica vulnerabilidades altas o críticas con `npm audit` |

## Rotación de llaves criptográficas

1. Genera una nueva llave de 32 bytes (64 hex).
2. Agrégala en `ENCRYPTION_KEYS_JSON` conservando la versión anterior y actualiza `ENCRYPTION_ACTIVE_KEY_VERSION`:
   ```env
   ENCRYPTION_ACTIVE_KEY_VERSION=v2
   ENCRYPTION_KEYS_JSON={"v1":"<llave_anterior>","v2":"<llave_nueva>"}
   ```
3. Ejecuta:
   ```bash
   npm run keys:rotate
   ```
4. Una vez re-cifrados todos los registros y verificada la lectura, puedes retirar `v1` del entorno cuando ya no exista ningún registro con `key_version = 'v1'`.

## Recuperación de contraseña en desarrollo

En desarrollo (`MAIL_DRIVER=local`), los correos de recuperación se escriben en `backend/.dev-mail/` (ignorado por Git). Los tokens nunca se devuelven en respuestas HTTP ni se imprimen en los logs JSON de Pino. Para entornos posteriores puede configurarse `MAIL_DRIVER=https-api` con `MAIL_API_URL` (HTTPS) y `MAIL_API_KEY`.

## Decisiones criptográficas y privacidad honesta

- **No es cifrado de extremo a extremo (E2EE):** El servidor descifra título, contenido, teléfono y dato sensible de prueba para mostrarlos únicamente al usuario autenticado propietario.
- **Contraseñas (verificación):** Argon2id con memoria mínima `19456 KiB`, `2` iteraciones y paralelismo `1`.
- **Datos privados (cifrado autenticado):** AES-256-GCM con IV aleatorio nuevo de `12 bytes` por cifrado, tag de `16 bytes` y AAD vinculada a `ownerId`, `recordId`, nombre de campo y `keyVersion`.
- **Tokens de sesión y recuperación:** `crypto.randomBytes(32)` almacenando únicamente su hash `SHA-256` en PostgreSQL.

## Documentación técnica

- [Arquitectura y flujo de capas](docs/arquitectura.md)
- [Modelo de datos y restricciones](docs/modelo-datos.md)
- [Modelo de amenazas y riesgos residuales](docs/amenazas.md)
- [Matriz OWASP Top 10:2025](docs/matriz-owasp.md)

### Pruebas de integración con base desechable de PostgreSQL

Las pruebas de integración ejecutan `TRUNCATE` sobre las tablas de prueba y **nunca** hacen fallback a `DATABASE_URL`. Exigen explícitamente `NODE_ENV=test` y una `TEST_DATABASE_URL` local cuyo nombre termine en `_test` (o `-test` / `_testing` / prefijo `test_`) y sea distinta a `DATABASE_URL`.

1. Crea una base desechable dedicada:
   ```powershell
   psql -U postgres -c "CREATE DATABASE entre_lineas_test;"
   ```
2. Ejecuta la suite de integración apuntando únicamente a esa base desechable:
   ```powershell
   $env:NODE_ENV="test"
   $env:TEST_DATABASE_URL="postgres://postgres:<tu_clave>@localhost:5432/entre_lineas_test"
   npm run test:integration
   ```

## Despliegue en producción (Render)

El repositorio incluye [render.yaml](render.yaml) y [Dockerfile](Dockerfile) (multi-stage con usuario no root `appuser` y migraciones automáticas idempotentes al arrancar).

### Pasos para desplegar en Render
1. Entra a [Render Dashboard](https://dashboard.render.com/), selecciona **New + → Blueprint** y conecta tu repositorio de GitHub (`entre-linea`).
2. Render detectará `render.yaml`, creará la base PostgreSQL gestionada (`entre-lineas-db`) y el servicio web Docker (`entre-lineas-diario-seguro`).
3. En la pantalla de variables pendientes (`sync: false`) o en **Environment** del servicio web, configura:
   - `APP_ORIGIN`: la URL pública HTTPS asignada por Render (ej. `https://entre-lineas-diario-seguro.onrender.com`, sin barra final).
   - `ENCRYPTION_KEYS_JSON`: `{"v1":"<64_HEX_ALEATORIOS>"}` generados con:
     ```bash
     node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
     ```
4. Al iniciar el contenedor, se ejecutan automáticamente las migraciones (`001_initial_schema.sql` y `002_auth_version_and_concurrency.sql`) y luego arranca Express sirviendo la API y `frontend/dist/` en el mismo origen sobre HTTPS.
5. Verifica salud en `https://<tu-url>.onrender.com/health` (`{"status":"ok"}`).
6. Para crear el primer administrador en producción, ejecuta localmente apuntando temporalmente a la **External Database URL** de Render (con `DB_SSL=true`) o desde el shell del servicio:
   ```powershell
   $env:DATABASE_URL="<EXTERNAL_DATABASE_URL_DE_RENDER>"
   $env:DB_SSL="true"
   $env:DB_SSL_REJECT_UNAUTHORIZED="false"
   $env:ENCRYPTION_KEYS_JSON='{"v1":"<TU_LLAVE_64_HEX>"}'
   npm run admin:create
   ```

## Verificación posterior al despliegue (Fase 4)

Una vez activa tu URL pública `https://<tu-url>.onrender.com`, ejecuta las siguientes verificaciones únicamente sobre tu propia aplicación:

1. **Cabeceras HTTP (A02):** analiza tu URL en https://securityheaders.com/ (esperado: calificación **A / A+** gracias a Helmet CSP, HSTS, `Referrer-Policy`, `X-Content-Type-Options` y `Permissions-Policy`).
2. **TLS / Certificado HTTPS (A04):** analiza tu dominio en https://www.ssllabs.com/ssltest/.
3. **OWASP ZAP Baseline Scan (con Docker local):**
   ```powershell
   docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://<tu-url>.onrender.com
   ```
4. **Demo de ataques bloqueados (para presentación de 10 minutos):**
   - **IDOR (A01):** Usuario A intenta `GET /api/diary/<id_de_B>` → `404` + evento `diary_access_denied` en bitácora.
   - **Fuerza bruta (A07):** 5 intentos fallidos de login → `HTTP 429` con `Retry-After` + alerta `brute_force_alert` en bitácora.
   - **CSRF / Origen no permitido (A08):** `POST /api/diary` sin `X-CSRF-Token` o con `Origin: https://atacante.ejemplo` → `HTTP 403`.
   - **Inyección SQL / XSS (A05):** `GET /api/diary/' OR 1=1 --` → `HTTP 400`; `<script>alert(1)</script>` en título se renderiza como texto plano neutralizado.

## Limitaciones conocidas de esta etapa

- La prueba de integración contra PostgreSQL real requiere `NODE_ENV=test` y `TEST_DATABASE_URL` apuntando a una base local desechable; si falta `TEST_DATABASE_URL`, la suite informa explícitamente que no se ejecutó.
- Controles dependientes de despliegue en producción (TLS/HSTS en proxy inverso, `Secure` en cookies sobre HTTPS, correo transaccional HTTPS real y escaneos DAST) se verificarán en la etapa posterior.
# entre-linea
