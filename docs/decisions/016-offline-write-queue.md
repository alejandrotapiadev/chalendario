# ADR-016: Cola de escritura sin conexión

**Estado:** aceptada

## Contexto

ADR-012 dejó la lectura sin conexión resuelta pero la escritura explícitamente fuera («el
intento falla con un mensaje claro»), con el panel de conflictos (`expectedVersion`) como
base pensada para cuando se añadiera. T-13 la añade: crear, editar y borrar un evento se
guarda en el propio dispositivo si no hay red, y se envía solo al volver la conexión.

## Decisión

### Qué se admite sin conexión

Solo un **evento suelto** (`recurrence: null`, y no una excepción tocada con `scope`
distinto de `series`). Crear, editar o borrar una serie, o una ocurrencia suya, sin conexión
da un aviso claro y no se guarda nada: un ordenador sin red no puede saber qué ocurrencias
existen ya en el servidor (excepciones previas, por ejemplo), así que no hay forma segura de
decidir qué pasaría al reconectar. Es la misma clase de límite que ya existe en otros sitios
de la aplicación (p. ej. el arrastre de excepciones), no una excepción nueva al diseño.

### Cómo se guarda

`apps/web/src/offline/queue.ts`, en `localStorage` (no en el service worker ni en
`IndexedDB`): el volumen es pequeño (como mucho, unos pocos eventos a la vez) y el resto de
preferencias del cliente ya usan `localStorage` (`storage.ts`); añadir `IndexedDB` solo para
esto habría sido complejidad sin beneficio real a esta escala.

**Como mucho una operación pendiente por evento** («la última gana»): editar dos veces un
mismo evento sin conexión no encola dos operaciones, sustituye el contenido de la que ya
había. Si el evento en sí se creó sin conexión (todavía sin id real) y se edita otra vez
antes de reconectar, se corrige lo que se va a crear en vez de guardar una edición aparte; si
se borra antes de reconectar, no queda nada que enviar (nunca llegó a existir en el
servidor). Esto evita tener que encadenar operaciones dependientes entre sí (una edición que
depende de que una creación anterior haya terminado bien) a costa de no guardar el historial
intermedio de ediciones hechas sin conexión — aceptable: ya se pierde igual en cualquier caso,
porque cada versión en el historial (ADR-002) necesita un id real y un `change_reason`, que
no existen hasta que se envía.

Cada evento pendiente se muestra en las vistas superpuesto a lo último que devolvió el
servidor (`overlayEvents`): los creados aparecen con un id `offline:<uuid>` (nunca se envían
a la API con ese id: solo identifica la fila mientras está pendiente), los editados
reemplazan la versión que había, los borrados se ocultan.

### Al volver la conexión

`drainQueue` recorre la cola y, operación por operación, la quita **en cuanto la API
responde** (no todas de golpe al final): así, si la página se cierra o se recarga a mitad de
un envío con varias operaciones pendientes, las que ya se habían enviado no se repiten. El
disparador es el evento `online` del navegador, y también se comprueba al entrar por si algo
se quedó pendiente de una sesión anterior.

Cada operación puede terminar de tres formas:

- **Bien:** se quita de la cola.
- **Sin red todavía** (el error no viene de la API, p. ej. sigue sin conexión): se deja donde
  estaba, para reintentarlo la próxima vez.
- **La API la rechaza** (409 `version_conflict`, 404 porque alguien lo borró, u otro motivo):
  pasa a `listConflicts`, para que la persona decida. Excepción: un borrado que da 404 se
  cuenta como éxito, porque el fin que se buscaba (que ese evento no exista) ya está
  conseguido.

### Revisar conflictos

`SyncPanel.tsx` lista lo que no se pudo aplicar, con el motivo. Dos acciones, iguales para
crear/editar/borrar (a diferencia del panel de conflicto de ADR-012, aquí no hay un
formulario abierto con el que comparar campo a campo):

- **Descartar:** se abandona el cambio hecho sin conexión; lo que hay en el servidor se
  queda como está.
- **Reintentar:** para una edición, primero se pide la versión actual (`GET /events/:id`) y
  se reenvía con ese `expectedVersion`; para crear o borrar, se reenvía tal cual. Si vuelve a
  fallar, se queda en conflictos con el motivo actualizado.

### Deshacer

Las operaciones que se quedan en la cola (aún no confirmadas por el servidor) no ofrecen
«Deshacer»: no hay una versión previa real que restaurar todavía. `toastFor` (`App.tsx`) lo
detecta por el prefijo `offline:` del id.

### Privacidad

A diferencia de la caché de lectura de ADR-012, la cola **no se vacía al cerrar sesión**: son
cambios propios sin enviar, y perder trabajo del usuario sería peor que el riesgo de
privacidad (ya está separada por cuenta, con su propia clave de `localStorage`, igual que
`hiddenCalendars`/`displayTimezone`).

## Consecuencias

- **Pro:** ADR-012 quedó resuelto donde decía que faltaba: la base (panel de conflictos,
  `expectedVersion`) se reutiliza casi sin cambios para la reconciliación.
- **Pro:** ningún cambio de contrato en la API (`packages/shared`, rutas): la cola vive
  entera en el cliente, por encima de `api.ts`.
- **Contra:** las series quedan fuera a propósito (ver arriba); es una limitación conocida,
  no un descuido.
- **Contra:** sin idempotencia en el servidor (no hay una clave de deduplicación en
  `POST /events`), si el envío de una operación se interrumpe justo después de que el
  servidor la recibiera pero antes de que el cliente lo confirme (p. ej. se cierra la
  pestaña en ese instante exacto), en el peor de los casos se podría reintentar y duplicar.
  Ventana muy pequeña (un intercambio de red) y no se ha observado en las pruebas, pero
  sigue sin ser imposible; una clave de idempotencia en `POST /events` la cerraría del todo,
  y queda como mejora futura si llegara a ser un problema real.
