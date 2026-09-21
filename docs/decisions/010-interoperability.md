# ADR-010: Interoperabilidad con ICS, enlace de suscripción y suscripción a URLs

**Estado:** aceptada

## Contexto

La fase 4 pide «Google Calendar / Apple Calendar, sincronización, ICS». Una integración con la
API de Google exige una app OAuth registrada con credenciales de quien despliega el proyecto, y
CalDAV (lo que usa Apple) es un servidor de protocolo entero. Pero casi todos los calendarios
saben **publicar y seguir direcciones `.ics`** (Google: «dirección secreta en formato iCal»;
Apple: suscripción a un calendario; Outlook: igual), lo que cubre el caso de uso real (mover
datos y ver lo mismo en varios sitios) sin cuentas de terceros.

## Decisión

- **ICS propio y puro** (`packages/domain/src/ics.ts`): serializa y lee el subconjunto que
  entiende la aplicación (título, descripción, ubicación, estado, fechas con zona y «todo el día»,
  repetición diaria/semanal/mensual, avisos `VALARM` y categoría). Lo que no cabe **se avisa** en
  `warnings` (o se omite en `skipped` con su motivo), nunca falla en silencio: `EXDATE`, `RDATE`,
  `RECURRENCE-ID`, reglas `RRULE` complejas, avisos absolutos… Se comprobó con un feed real de
  Google (386 eventos) y con ciclos serializar → leer.
- **Identidad por UID.** `events.uid` (identidad, no contenido versionado) guarda el UID externo.
  Al exportar, un evento creado aquí usa `<id>@personal-calendar`, así que reimportar un fichero
  propio reconoce cada evento. Importar es un _upsert_: si el evento existe y cambió añade una
  **versión** (`change_reason` = `import` o `sync`, con historial y «deshacer» como cualquier
  edición); si es idéntico no toca nada; si estaba borrado, lo recupera.
- **Enlace de suscripción** (`/feeds/<token>.ics`, sin sesión, solo lectura): token de 256 bits
  del que solo se guarda el hash; se muestra al crearlo y se **regenera** (invalidando el
  anterior) o se desactiva. El token no se escribe en los logs de peticiones. `ETag` +
  `If-None-Match`; el `DTSTAMP` es la última modificación (no «ahora») para que el `ETag` sirva.
- **Suscripción a una URL** (`POST /subscriptions`): crea un calendario **de solo lectura**
  (escrituras rechazadas con 409 `calendar_read_only`, también para editores) que refleja el
  origen: crea, actualiza y borra por UID. Se sincroniza al suscribirse, a mano y cada 15 min en
  el propio proceso de la API (sin worker aparte) para las suscripciones cuyo último intento tiene
  más de 30 min; un `advisory lock` evita dos sincronizaciones a la vez y un fallo se anota en
  `last_error` sin tocar los eventos. Solo se expone el dominio de la URL (puede llevar un
  secreto en la ruta).
- **SSRF.** Descargar una URL elegida por el usuario convierte al servidor en un proxy hacia la red
  interna, así que: solo `https://` (o `webcal://`) al puerto 443; la dirección se valida **al
  conectar** (no solo al parsear la URL), rechazando cualquier resolución con IP privada,
  loopback, enlace local (metadatos de la nube), CGNAT, multicast, ULA… incluidas las IPv4
  mapeadas en IPv6 en cualquiera de sus formas; cada redirección se vuelve a validar; límites de
  tamaño (5 MB), tiempo (15 s) y redirecciones (3); los mensajes de error no filtran detalles
  de red.

## Consecuencias

- **Pro:** Google, Apple y Outlook pueden **seguir tu calendario** (enlace) y tú puedes **seguir
  los suyos** (URL) sin cuentas ni credenciales de terceros; y se puede sacar todo en un `.ics`.
- **Pro:** la sincronización reutiliza el versionado: cada cambio del origen queda en el historial.
- **Contra:** es de **una sola dirección por enlace** (lectura). Editar en Google y verlo aquí
  requiere suscribirse a su enlace; editar aquí y verlo allí, el enlace. No hay escritura de vuelta
  ni notificaciones push: los clientes externos refrescan cuando quieren (Google, cada varias
  horas).
- **Contra:** las excepciones de series (`EXDATE`, ocurrencias modificadas) no se conservan hasta que
  existan excepciones propias (ADR-008); se avisa al importar.
- **Contra:** desde `localhost` los servicios externos no pueden abrir el enlace: hace falta que la
  aplicación sea accesible desde Internet (la interfaz lo avisa).
- **Pendiente si se necesitara:** API de Google con OAuth (sincronización bidireccional) y un
  servidor CalDAV para clientes nativos.
