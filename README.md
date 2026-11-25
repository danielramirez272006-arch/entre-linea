# Entre Líneas — Diario Seguro

Aplicación web de diario personal privado construida como monorepo (`client` + `server`) con enfoque de seguridad en profundidad para la etapa de desarrollo local del laboratorio SecureVault.

> **Alcance de esta etapa:** Desarrollo local, controles de seguridad, pruebas automatizadas y documentación técnica. El despliegue público, escaneos de producción y publicación en plataformas quedan para una etapa posterior.

## Tecnologías

- **Frontend (`client/`):** React 19, React Router 7, Vite 6, JavaScript (`.js`/`.jsx`), HTML y CSS propio con tokens de diseño (sin TypeScript ni framework visual).
- **Backend (`server/`):** Node.js LTS (`>=20.11`), Express 5, PostgreSQL (`pg` con consultas parametrizadas), Zod 4, Argon2id (`argon2`), `node:crypto` (AES-256-GCM y SHA-256), Helmet, CORS y Pino (logs JSON redactados).

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

El servidor carga `.env` automáticamente desde la raíz mediante `server/src/config/env.js` (los secretos permanecen exclusivamente en el servidor; cualquier variable `VITE_*` quedaría expuesta en el bundle del navegador y no se utiliza para secretos).

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
| `npm run dev:server` | Inicia solo el backend con `--watch` |
| `npm run dev:client` | Inicia solo el servidor de desarrollo Vite |
| `npm run build` | Compila el frontend React en `client/dist/` |
| `npm start` | Ejecuta Express sirviendo API y `client/dist/` en el mismo origen |
| `npm run db:migrate` | Aplica las migraciones SQL pendientes en PostgreSQL |
| `npm run admin:create` | Crea o promueve el primer administrador desde consola |
| `npm run keys:rotate` | Re-cifra entradas y campos sensibles hacia `ENCRYPTION_ACTIVE_KEY_VERSION` |
| `npm run test:unit` | Ejecuta pruebas unitarias de criptografía, validación y flujos HTTP de seguridad |
| `npm run test:integration` | Ejecuta pruebas de integración contra PostgreSQL real (`TEST_DATABASE_URL` o `DATABASE_URL`) |
| `npm run test:e2e` | Ejecuta prueba de extremo a extremo sirviendo el build React desde Express |
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

En desarrollo (`MAIL_DRIVER=local`), los correos de recuperación se escriben en `server/.dev-mail/` (ignorado por Git). Los tokens nunca se devuelven en respuestas HTTP ni se imprimen en los logs JSON de Pino. Para entornos posteriores puede configurarse `MAIL_DRIVER=https-api` con `MAIL_API_URL` (HTTPS) y `MAIL_API_KEY`.

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

## Limitaciones conocidas de esta etapa

- La prueba de integración contra PostgreSQL real requiere una instancia activa de PostgreSQL configurada en `TEST_DATABASE_URL` o `DATABASE_URL` (si no está disponible en el entorno, la suite se omite informando el motivo).
- Controles dependientes de despliegue en producción (TLS/HSTS en proxy inverso, `Secure` en cookies sobre HTTPS, correo transaccional HTTPS real y escaneos DAST) se verificarán en la etapa posterior.
# entre-linea
