# ADR-007: Autenticación con sesiones en cookie

**Estado:** aceptada

## Contexto

Hasta la fase 2 la API actuaba como un único usuario local. Un calendario personal guarda
datos sensibles (dónde estás y cuándo) y va a exponerse en algún momento a una red, así que
necesita cuentas reales. Es una aplicación de una sola web y una sola API en el mismo
origen (el proxy de Vite en desarrollo), sin terceros que necesiten un token.

## Decisión

- **Email y contraseña**, con registro propio. `REGISTRATION_OPEN=false` cierra el alta de
  cuentas nuevas (útil en un servidor personal cuando ya existe la tuya).
- **Sesiones opacas en base de datos**, no JWT. La cookie `sid` lleva un token aleatorio
  de 256 bits; la tabla `sessions` guarda solo su hash SHA-256, de modo que un volcado de
  la base de datos no permite usar sesiones activas. Cerrar sesión la borra al instante
  (con un JWT no se podría revocar) y caducan a los 30 días.
- **Cookie** `HttpOnly` (inaccesible desde JS, así que un XSS no puede robar el token),
  `SameSite=Lax` y `Secure` en producción.
- **Contraseñas con scrypt** (módulo `node:crypto`, sin dependencias nativas), con sal
  aleatoria y los parámetros de OWASP (N=32768, r=8, p=3). Los parámetros se guardan en el
  propio hash, así que se pueden endurecer sin invalidar las cuentas existentes.
- **Sin filtrar qué cuentas existen:** login devuelve el mismo 401 con email desconocido
  y con contraseña incorrecta, y en el primer caso gasta el mismo tiempo en un hash falso.
- **Límite de 10 intentos por minuto y IP** en `/auth/login` y `/auth/register`.
- **CSRF:** `SameSite=Lax` impide que otro sitio envíe la cookie en POST/PATCH/DELETE, y la
  API solo acepta cuerpos `application/json`, que un formulario HTML cruzado no puede
  enviar. No se añade un token CSRF aparte.
- Todas las rutas de datos exigen sesión (`onRequest`, antes de leer el cuerpo) y filtran
  por `request.userId`; `/health` y `/auth/register|login` son públicas.

## Consecuencias

- **Pro:** revocación inmediata, sin secretos que rotar y sin dependencias criptográficas.
- **Pro:** los módulos siguen leyendo solo `request.userId`, así que el cambio no los tocó.
- **Contra:** cada petición autenticada hace una consulta a `sessions`. Es un acceso por
  índice único; si llegara a pesar, se puede cachear unos segundos.
- **Contra:** el límite por IP asume que la API ve la IP real. Detrás de un proxy inverso
  hay que activar `trustProxy` en Fastify.
- **Contra:** no hay recuperación de contraseña, verificación de email, 2FA ni gestión de
  sesiones activas. Son mejoras posibles; requieren un canal de correo.
- **Contra:** las cuentas creadas antes de la autenticación (sin `password_hash`) no
  pueden iniciar sesión. No hay migración de datos: eran solo datos de desarrollo.
