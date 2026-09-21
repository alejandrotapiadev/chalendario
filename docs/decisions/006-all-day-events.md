# ADR-006: Eventos de todo el día como instantes con fin exclusivo

**Estado:** aceptada

## Contexto

Un evento de todo el día conceptualmente es una fecha (o un rango de fechas), no un instante.
Modelarlo como `date` obligaría a tener dos representaciones en el esquema, las consultas por
rango y la recurrencia.

## Decisión

Se guarda igual que cualquier evento, como dos instantes `timestamptz`: medianoche local del
primer día y medianoche local del día siguiente al último (fin exclusivo), en la zona
`timezone` del evento. `all_day = true` marca la intención. `packages/domain` rechaza los que
no estén alineados a medianoche local; para ello usa `Intl` (sin librerías de fechas).

## Consecuencias

- **Pro:** una sola forma de consultar, ordenar y solapar eventos.
- **Pro:** el fin exclusivo evita el caso «23:59:59» y hace trivial contar días.
- **Contra:** el cliente debe convertir fechas a instantes (y el fin inclusivo que ve el
  usuario a exclusivo). Lo hace `EventDialog` en el frontend.
- **Contra:** si se cambia la zona horaria de un evento de todo el día, hay que recalcular
  ambos instantes; la validación lo obliga a hacerlo de forma explícita.
- **Contra:** en zonas donde un día no tiene medianoche (cambios de hora a las 00:00) no se
  puede representar un evento de todo el día ese día. Se asume aceptable para el MVP.
