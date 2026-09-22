# ADR-015: Archivar en vez de borrar calendarios y categorías

**Estado:** aceptada

## Contexto

Los calendarios y las categorías no se pueden borrar de verdad: `events.calendar_id` y
`event_versions.category_id` los referencian, y las versiones son inmutables (ADR-002), así
que un `DELETE` rompería el historial o quedaría bloqueado por la propia base de datos. Aun
así, con el tiempo se acumulan calendarios y categorías que ya no se usan y que solo estorban
al elegir dónde va un evento nuevo.

## Decisión

`calendars.archived` y `categories.archived` (booleanos, por defecto `false`; migración 015).
Se activan con el mismo `PATCH` que ya existe para cada uno (`archived: true`/`false`), sin
rutas nuevas. `GET /calendars` y `GET /categories` siguen devolviendo también los archivados
(con el campo en el DTO): así la interfaz puede seguir resolviendo el nombre y el color de un
evento que ya lleva un calendario o una categoría archivada, y ofrecer un sitio donde
restaurarlos.

Un calendario o una categoría archivados:

- Dejan de ofrecerse al crear o editar un evento (el formulario los excluye del selector,
  salvo que el evento que se está editando ya los tuviera).
- Un calendario archivado además deja de listarse en la barra lateral y de aportar eventos a
  la vista (a diferencia de «ocultar» un calendario, que es una preferencia local del
  navegador y no afecta a con quién se comparte ni a qué se puede editar, archivar es un
  estado del propio calendario: lo decide su propietario y lo ven todos los que tengan
  acceso).
- Una categoría archivada solo deja de ofrecerse; los eventos que ya la llevan la conservan
  tal cual (nombre, color e historial) hasta que se les cambie a mano.
- Solo el propietario puede archivar o restaurar (mismo `WHERE user_id = $2` que ya
  protegía el `PATCH`); no hay una acción de archivar para quien solo tiene acceso
  compartido.

## Consecuencias

- **Pro:** reversible sin más que quitar la marca; ningún dato ni versión se pierde.
- **Pro:** no hace falta tocar el trigger de inmutabilidad ni las claves foráneas.
- **Contra:** un calendario o una categoría archivados siguen ocupando su fila para siempre
  (igual que ADR-005 con los eventos borrados); no hay un borrado definitivo.
- **Contra:** `GET /calendars` y `GET /categories` no aceptan filtrar por archivado en el
  servidor; hoy es la interfaz la que separa activos de archivados en la misma lista. Si el
  número de calendarios o categorías archivados llegara a ser grande, convendría añadir un
  parámetro de consulta en vez de mandarlos siempre todos.
