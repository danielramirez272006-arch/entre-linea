# Modelo de Amenazas y Casos de Abuso

## Activos principales

1. **Entradas privadas del diario** (título y contenido personal).
2. **Credenciales y sesiones** (contraseñas, cookies de sesión, tokens CSRF y de recuperación).
3. **Datos personales sensibles** (teléfono y dato sensible de prueba en perfil).
4. **Integridad de privilegios y auditoría** (roles `user`/`admin` y bitácora de seguridad).
5. **Llaves de cifrado AES-256-GCM** en variables de entorno del servidor.

## Casos de abuso y mitigaciones

| Amenaza / Caso de abuso | Vector | Mitigación implementada |
| --- | --- | --- |
| **IDOR en entradas del diario** | Un usuario autenticado cambia el UUID en `GET/PUT/DELETE /api/diary/:id` | Todas las consultas filtran por `owner_id = req.auth.user.id` en el repositorio y usan AAD ligada al `ownerId`. Devuelve `404` sin revelar existencia ajena. |
| **Escalación de privilegios en registro o API** | Enviar `role: "admin"` en `POST /api/auth/register` o llamar `/api/admin/*` como usuario estándar | `registerSchema.strict()` rechaza campos extra; el servicio fija `role: 'user'`; `/api/admin/*` exige `requireRole('admin')` y el servicio vuelve a verificar `actor.role === 'admin'`. |
| **Cambio no autorizado de rol** | Sesión administrativa abandonada o manipulada | Cambiar rol exige confirmación explícita (`confirmed: true`) y reautenticación con la contraseña actual del administrador; además impide dejar el sistema sin administradores. |
| **CSRF y peticiones cross-site** | Sitio externo envía `POST/PUT/DELETE` aprovechando cookie de sesión | Cookie `SameSite=Lax`, validación estricta de `Origin`/`Referer` contra `APP_ORIGIN` y token CSRF por sesión (`X-CSRF-Token`) comparado con `timingSafeEqual`. |
| **Fuerza bruta y relleno de credenciales** | Intentos repetidos en `/api/auth/login` | Rate limiting compartido en PostgreSQL (HTTP 429 + `Retry-After`), bloqueo progresivo exponencial por cuenta, verificación dummy de tiempo constante para correos inexistentes y alerta `brute_force_alert` (`severity: 'alert'`) en bitácora. |
| **Compromiso de lectura de base de datos** | Volcado SQL de PostgreSQL | Contraseñas con Argon2id (`19456 KiB`), sesiones y tokens de recuperación almacenados solo como SHA-256, y títulos/contenidos/teléfono/dato sensible cifrados con AES-256-GCM + IV único + AAD. |
| **Manipulación de ciphertext en BD** | Alteración de bytes cifrados o intercambio entre usuarios | AES-256-GCM con tag de 16 bytes y AAD (`ownerId`, `recordId`, `field`, `keyVersion`) detecta cualquier modificación y rechaza el descifrado. |
| **Envenenamiento de enlace de recuperación (Host Header Injection)** | Cliente envía `Host: atacante.tld` en `forgot-password` | El enlace se construye exclusivamente a partir de `config.appOrigin`, ignorando `Host` del cliente. |
| **Reutilización o carrera en token de recuperación** | Dos peticiones simultáneas con el mismo token | Consumo atómico en PostgreSQL (`UPDATE ... WHERE consumed_at IS NULL AND expires_at > NOW()`), caducidad de 15 min y revocación inmediata de todas las sesiones del usuario. |
| **Sobrescritura silenciosa entre pestañas** | Dos pestañas editan la misma entrada | Control optimista mediante columna `version`; guardar una versión antigua responde `409 VERSION_CONFLICT` devolviendo la versión más reciente. |
| **Abuso de almacenamiento concurrente** | Envío simultáneo para superar el límite de 100 entradas | Transacción con `SELECT ... FOR UPDATE` sobre la fila del usuario antes de validar el conteo, más límite de 10 000 caracteres y `64kb` de cuerpo HTTP. |
| **XSS en contenido del diario** | Guardar `<script>` o atributos maliciosos en título o contenido | React escapa todo texto por defecto (sin `dangerouslySetInnerHTML`) y Helmet impone CSP estricta (`script-src 'self'`, sin inline). |

## Riesgos residuales y controles dependientes de producción

- **No es cifrado E2EE:** Un atacante con control total del servidor en ejecución y acceso a las variables de entorno podría descifrar datos. Esto se comunica de forma honesta en la pantalla de inicio.
- **Pérdida de llaves:** Perder todas las copias de `ENCRYPTION_KEYS_JSON` imposibilita recuperar entradas y campos cifrados.
- **Controles a verificar en despliegue posterior:** Terminación TLS/HTTPS, cabecera HSTS, flag `Secure` en cookies bajo HTTPS, `TRUST_PROXY` ajustado al proxy inverso real, gestión de secretos en bóveda/KMS y monitoreo externo de alertas.
