# ADR-009: Recordatorios en la aplicación, calculados al consultar

**Estado:** aceptada

## Contexto

El MVP pide recordatorios sencillos («30 minutos antes», «10 minutos antes») y permite
empezar con notificaciones dentro de la aplicación. También menciona un worker para
notificaciones, pero solo «cuando haga falta».

## Decisión

- Tabla `event_reminders (event_id, minutes_before, channel)`, canal `in_app`, único por
  evento y antelación. Son de **cada ocurrencia** en los eventos recurrentes.
- **No se versionan.** No forman parte del contenido del evento (ADR-002): cambiarlos no crea
  versión, restaurar una versión no los toca, y no llenan el historial. Se envían en
  `reminders` al crear o actualizar y sustituyen el conjunto entero.
- **Sin cola ni worker:** `GET /reminders/active` calcula en el momento qué avisos están
  activos, es decir, su hora de aviso (inicio de la ocurrencia menos la antelación) ya pasó y
  la ocurrencia aún no ha terminado. Se ignoran los eventos cancelados y borrados. Ninguna
  tabla guarda «avisos pendientes».
- El **cliente consulta cada 30 s** (y tras cada cambio en los eventos). La campana de la
  barra muestra los pendientes; un aviso emergente anuncia los nuevos; si el usuario lo
  permite, también se lanza una notificación del navegador.
- **Descartar es cosa del cliente:** se guarda en `localStorage`, por usuario y con la clave
  `evento|inicio de la ocurrencia|antelación`, y se limpia solo cuando el aviso caduca.

## Consecuencias

- **Pro:** ningún proceso adicional, ninguna tabla que sincronizar y nada que se pueda
  «perder»: si la aplicación estaba cerrada cuando tocaba, el aviso aparece al abrirla mientras
  el evento siga en curso.
- **Pro:** lo que ve el usuario siempre coincide con el estado real (mover un evento mueve sus
  avisos sin más).
- **Contra:** solo avisa con la aplicación abierta. Los avisos con la pestaña cerrada (push,
  correo) requieren un worker y una tabla de entregas (`reminder_deliveries`) para no repetirlos;
  la tabla y la API ya tienen la forma para añadirlos, con otro `channel`.
- **Contra:** descartar no se sincroniza entre dispositivos.
- **Contra:** cada consulta recorre los eventos con recordatorios y expande las series en un
  horizonte de 4 semanas. Es barato para un uso personal; con muchos eventos convendría
  acotar por fecha.
