# Arquitectura — Entre Líneas

## Flujo de extremo a extremo

Todas las operaciones siguen una separación estricta de responsabilidades:

```text
Página React (frontend/src/pages/*)
  → Servicio HTTP centralizado (frontend/src/services/apiClient.js)
  → Ruta y cadena de middleware Express (backend/src/routes/* + backend/src/middleware/*)
  → Controller HTTP (backend/src/controllers/*)
  → Servicio de negocio y transacciones (backend/src/services/*)
  → Repository con SQL parametrizado (backend/src/repositories/*)
  → PostgreSQL
```

## Responsabilidades por capa

### Frontend (`frontend/`)
- **Vistas (`pages/`):** Orquestan estado de pantalla (carga, vacío, éxito, error, sesión caducada) sin incrustar detalles de red ni tokens.
- **Componentes (`components/ui`, `components/layout`, `components/diary`):** Presentación accesible, gestión de foco en diálogos (`useFocusTrap`), advertencia de cambios sin guardar (`useUnsavedChanges`) y renderizado seguro de React (sin `dangerouslySetInnerHTML`).
- **Contexto (`context/AuthContext.jsx`):** Consulta `/api/auth/me` al iniciar y mantiene sesión y token CSRF únicamente en memoria JS (nunca en `localStorage`).
- **Servicio HTTP (`services/apiClient.js`):** Centraliza `fetch` con `credentials: 'include'`, adjunta `X-CSRF-Token` en métodos mutables, detecta `401 SESSION_EXPIRED` y distingue errores de red cuyo resultado pudo quedar incierto en el servidor.
- **Estilos (`styles/tokens.css`, `global.css`, `animations.css`):** Paleta crema cálido, verde salvia profundo, tinta oscura y acentos terracota; animaciones basadas en `opacity`/`transform` con soporte completo para `prefers-reduced-motion`.

### Backend (`backend/`)
- **`app.js`:** Ensambla Helmet (CSP estricta sin CDN ni scripts inline), CORS restringido, `cookie-parser`, límite de cuerpo (`64kb`), `GET /health`, middleware común `/api`, rutas, servicio del build `frontend/dist` en mismo origen y manejador de errores.
- **`routes/`:** Declaran endpoints, rate limiters específicos, validación Zod (`validateBody`/`validateQuery`/`validateUuidParam`) y guardias de sesión/rol.
- **`middleware/`:** Sesión desde PostgreSQL (`sessionMiddleware`), verificación de `Origin`/`Referer` y token CSRF (`csrfMiddleware`), rate limiting compartido en PostgreSQL (`rateLimitMiddleware`) y manejo uniforme de errores sin filtración (`errorMiddleware`).
- **`controllers/`:** Traducen `req`/`res`, gestionan cookies HttpOnly y delegan toda la lógica a `services/`.
- **`services/`:** Aplican reglas de negocio, autorización por propietario/rol, transacciones (`withTransaction`), cifrado/descifrado mediante `security/crypto.js` y registro en bitácora.
- **`repositories/`:** Contienen exclusivamente SQL parametrizado (`$1, $2, ...`) y aceptan un cliente de transacción opcional (`client`) para operaciones atómicas.

## Entorno, secretos y desarrollo

- **Desarrollo:** Vite escucha en `http://localhost:5173` y hace proxy de `/api` y `/health` hacia `http://localhost:3001`, evitando problemas de cookies entre orígenes.
- **Producción / mismo origen:** `npm run build` genera `frontend/dist/` y `backend/src/app.js` sirve los estáticos y el fallback SPA desde el mismo origen que la API.
- **Secretos:** Residen únicamente en `.env` (ignorado por Git) en el servidor. El frontend no recibe llaves, secretos de BD ni variables `VITE_*` sensibles.
- **Correo local:** `backend/.dev-mail/` está listado en `.gitignore` para evitar versionar enlaces de recuperación.
