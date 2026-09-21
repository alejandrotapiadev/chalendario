# ADR-011: Calendarios compartidos con roles e invitaciones

**Estado:** aceptada

## Contexto

Hasta ahora cada calendario es de un único usuario. La fase 4 pide calendarios compartidos e
invitaciones. No hay envío de correo ni notificaciones fuera de la aplicación (ADR-009), y el
modelo de versionado (ADR-002) ya registra quién hizo cada cambio.

## Decisión

- **Propietario y miembros.** El propietario es `calendars.user_id`. El resto de personas con
  acceso están en `calendar_members` con un papel (`viewer` o `editor`) y un estado
  (`pending` → `accepted`). Rechazar, salir o que el propietario lo quite borra la fila.
- **Invitación por email a usuarios ya registrados.** La invitación es una fila `pending` y **no da
  acceso** hasta que el invitado la acepta (consulta `/invitations` al entrar y cada minuto).
  Invitar por email permite comprobar si una cuenta existe: es inherente a compartir por email sin
  un flujo de correo, y se limita a 30 invitaciones por minuto.
- **Matriz de permisos:**

  | Acción                                                  | Propietario | Editor | Lector | Sin acceso |
  | ------------------------------------------------------- | :---------: | :----: | :----: | :--------: |
  | Ver eventos, historial, buscar, avisos, exportar `.ics` |      ✓      |   ✓    |   ✓    |     —      |
  | Crear, editar, borrar, restaurar, importar eventos      |      ✓      |   ✓    |  403   |     —      |
  | Renombrar/recolorear, miembros, enlace, suscripción     |      ✓      |  404   |  404   |    404     |

  «Sin acceso» y «no puede gestionar» dan **404** (el calendario no «existe» para quien no lo
  gestiona; no se revela nada); un lector que intenta escribir recibe **403** porque ya sabe que
  existe.

- **Un único predicado de acceso** (`readableBy`) en todas las consultas de lectura y un único
  chequeo (`assertCanEdit`) antes de escribir, dentro de la misma transacción que bloquea el evento.
- **Autoría:** cada versión ya guarda `created_by`; ahora el historial muestra «por Luis».
- **Categorías personales:** una categoría es del usuario que la creó y solo puede asignarla a
  eventos quien la posee; en un calendario compartido cada persona ve las suyas.
- **Recordatorios del evento:** no son personales (ADR-009): quien edita el evento los define y
  avisan a todas las personas con acceso.
- Un calendario suscrito a una URL sigue siendo de solo lectura aunque se comparta como editor.

## Consecuencias

- **Pro:** los cambios de varias personas conviven con el versionado, la concurrencia optimista y
  el historial sin código nuevo.
- **Pro:** todas las lecturas (rangos, búsqueda, avisos, versiones) respetan el acceso por un único
  punto, y hay tests de la matriz completa.
- **Contra:** las invitaciones no llegan por correo: el invitado las ve al abrir la aplicación.
- **Contra:** no hay grupos, enlaces de invitación, caducidad de invitaciones ni transferencia de
  propiedad; el enlace `.ics` y las suscripciones solo los gestiona el propietario.
- **Contra:** los recordatorios compartidos no se pueden silenciar solo para uno mismo (habría que
  añadir recordatorios por usuario).
