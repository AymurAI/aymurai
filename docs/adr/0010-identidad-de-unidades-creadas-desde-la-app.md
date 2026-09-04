# ADR-0010 — Las unidades creadas desde la app llevan `uuid4`, no `uuid5`

**Fecha:** 2026-09-04 · **Estado:** aceptada

## Contexto

[ADR-0002](0002-modelo-del-organigrama.md) fija la identidad de una unidad en
`uuid5(NS, "<ruta_cargos>#<índice entre hermanos>")`, **computada sólo en el seed**, con un guardarraíl
explícito: el UUID se deriva de un valor mutable y es correcto *sólo porque se computa una vez*.

La fase 7 abre el ABM del organigrama: la app crea unidades. Una unidad creada desde la UI **no tiene
`ruta_cargos` en el JSON de origen** — no está en el JSON. Derivar un `uuid5` de su ruta en la base tendría
dos problemas: la ruta cambia con cada renombre o remoción de un ancestro, y dos instalaciones que crearan
"la misma" unidad a mano producirían el mismo id sin que nada garantice que son la misma cosa.

## Decisión

`OrganigramUnit.id` lleva `default_factory=uuid.uuid4`. Las unidades sembradas conservan su `uuid5`; las
creadas desde la app reciben un `uuid4`.

Conviven dos esquemas de identidad en la misma columna, y eso es deliberado: el `uuid5` no es una identidad
*semántica* que haya que preservar, es un mecanismo de **reproducibilidad del seed** — que dos instalaciones
sembradas del mismo JSON coincidan. Ese requisito no aplica a lo que un usuario carga a mano.

## Evidencia

Sin `default_factory`, `POST /organigram/units` fallaba con
`NOT NULL constraint failed: organigram_unit.id` — la columna es `primary_key` y ningún camino le asignaba
valor fuera del seed. En el navegador el 500 llegaba disfrazado de error de CORS, porque la respuesta de
error no lleva los headers.

## Consecuencias

- **Los ids siguen siendo opacos.** Nada en el código deriva significado de un id de unidad; el `uuid5` se
  computa en el seed y no se vuelve a mirar. Que unos sean v5 y otros v4 no es observable.
- **Una unidad creada desde la app es invisible para el seed** y por lo tanto sobrevive intacta a un
  re-seed: `_ensure_unit` busca por el `uuid5` del JSON y nunca la encuentra.
- **El guardarraíl de ADR-0002 se respeta**: renombrar desde el ABM hace `PATCH` del `name` y **no recomputa
  el id**, así que las referencias ya extraídas siguen resolviendo.
- ⚠️ Lo que sí queda abierto es la dirección contraria: el re-seed pisa lo que se editó desde la app
  (`_ensure_unit` sobrescribe nombre y ubicación desde el JSON). Se aborda en la fase 10 (#59); hasta
  entonces, no volver a sembrar sobre una instalación con ediciones.

## Alternativas consideradas

- **`uuid5` de la ruta en base.** Rechazada: la ruta es mutable desde el ABM, que es exactamente la
  condición que el guardarraíl de ADR-0002 prohíbe.
- **Un `uuid5` de namespace distinto para lo creado a mano.** Rechazada: sería determinismo sin nada que
  determinar — no hay una clave natural que dos instalaciones compartan.
- **Que el cliente mande el id.** Rechazada: mueve una decisión de persistencia al frontend sin ganar nada.
