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
- **Escribir sin conexión**: crear, editar y borrar un evento suelto sí está soportado desde
  T-13 (ver ADR-016); una serie, no.
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

- El formulario tiene un campo de **zona horaria** (por defecto la de visualización, ver abajo) y
  las horas se interpretan **en esa zona**; se muestra el equivalente en la de visualización. Al
  reabrir el evento se ve la hora en la zona del evento.

### Zona horaria de visualización (T-10, añadido 2026-09-22)

- Las vistas (mes, semana, día) ya no dibujan siempre en la zona del navegador: hay una **zona de
  visualización** elegible (selector en la barra lateral; por defecto, la del navegador,
  recordada por cuenta). Solo cambia lo que se ve y en qué zona se calculan los arrastres,
  redimensionados y movimientos con el teclado: no toca la zona propia de ningún evento ni las
  horas guardadas.
- Implementación (`apps/web/src/calendar/dates.ts`): `toDisplay(instante, zona)` devuelve un
  `Date` cuyos getters «locales» (`getHours`, `getDate`…) leen la hora de pared en `zona` en vez
  de la del navegador — así el resto del código de la cuadrícula (que ya solo usaba esos
  getters) no cambia. `fromDisplay` es la inversa: del resultado de arrastrar o crear, al
  instante real que se manda a la API. Arrastrar un evento de todo el día lo alinea a medianoche
  en la zona de **visualización** (antes, en la del navegador; con la zona de visualización por
  defecto son la misma cosa).

## Consecuencias

- **Pro:** se puede consultar el calendario sin red sin arriesgar datos de otra cuenta.
- **Pro:** el panel de conflicto es la base que reutiliza T-13 (ADR-016) para reconciliar la
  cola de escritura sin conexión con `expectedVersion`.
- **Pro:** una reunión «a las 10:00 de Londres» se guarda, se repite y se exporta en la zona
  correcta.
- **Contra:** sin conexión no se avisan los recordatorios, y una serie no se puede crear ni
  tocar (ver ADR-016).
- **Contra:** no hay fusión campo a campo: se sobrescribe o se descarta el conjunto.
