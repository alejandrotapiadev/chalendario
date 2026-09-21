# ADR-012: Lectura sin conexión, conflictos de edición y zona horaria por evento

**Estado:** aceptada

## Contexto

La fase 4 menciona «offline», «resolución de conflictos» y «zonas horarias avanzadas». Escribir
sin conexión implica una cola de cambios pendientes que luego hay que reconciliar con lo que
haya cambiado en el servidor, que es justo el problema de los conflictos. Y hasta ahora el
formulario interpretaba siempre las horas en la zona del navegador.

## Decisión

### Lectura sin conexión

- Un **service worker** (`apps/web/public/sw.js`, solo en la versión compilada) guarda la
  aplicación y las últimas lecturas de la API (`events`, `calendars`, `categories`,
  `invitations`, `auth/me`). Primero red (con límite de 4 s); si falla o el servidor responde 5xx,
  la última respuesta guardada, marcada con `x-from-cache` para que la interfaz muestre «Sin
  conexión: se muestran los datos guardados». Se ve lo que ya se había consultado (por rangos de
  fechas). Los ficheros con hash de `/assets/` van primero desde la caché.
- **Escribir sin conexión no está soportado**: el intento falla con un mensaje claro y el
  formulario no se pierde.
- **Privacidad:** esa caché es del navegador, no de la cuenta. Se vacía al **cerrar sesión (aunque
  no haya red)**, al caducar la sesión y al iniciar sesión. No se guardan `export`, `feed`,
  miembros ni avisos.

### Conflictos de edición

- `PATCH` ya acepta `expectedVersion` (ADR-002). Si el evento cambió desde que se abrió el
  formulario, en vez de un error suelto se muestra un panel con **qué cambiaría al guardar los
  cambios propios sobre la versión actual** (se reutiliza `describeChanges`) y tres salidas:
  sobrescribir (queda como versión nueva, sin perder el historial), descartar los propios o
  seguir editando. Si el evento se eliminó, se explica y no se ofrece sobrescribir.

### Zona horaria por evento

- El formulario tiene un campo de **zona horaria** (por defecto la del navegador) y las horas se
  interpretan **en esa zona**; se muestra el equivalente en la del navegador. Al reabrir el evento
  se ve la hora en la zona del evento. Las vistas (mes, semana, día) siguen dibujando en la zona del
  navegador.

## Consecuencias

- **Pro:** se puede consultar el calendario sin red sin arriesgar datos de otra cuenta.
- **Pro:** el panel de conflicto es la base para reconciliar cambios hechos sin conexión cuando se
  añada escritura offline (cola + `expectedVersion`).
- **Pro:** una reunión «a las 10:00 de Londres» se guarda, se repite y se exporta en la zona
  correcta.
- **Contra:** sin conexión no se puede crear ni editar, ni se avisan los recordatorios.
- **Contra:** no hay una «zona de visualización» elegible para las vistas (hoy solo la del
  navegador), y arrastrar un evento de todo el día lo pasa a la zona del navegador.
- **Contra:** no hay fusión campo a campo: se sobrescribe o se descarta el conjunto.
