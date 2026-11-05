# ADR-0011 — La fecha de asunción del titular es un dato del dominio, distinto de `created_at`

**Fecha:** 2026-09-04 · **Estado:** aceptada

## Contexto

`organigram_holder` nació con `created_at` y nada más en materia de tiempo, y la UI mostraba ese valor como
"Desde {fecha}". Alcanza mientras la única escritura sea "esta persona asume ahora": la fila se crea el día
que la persona asume, y las dos fechas coinciden.

No alcanza para lo que la Defensoría necesita: **cargar el historial real**. Sembrar el organigrama en 2026
registra a personas que asumieron años antes. Con una sola columna, la pantalla afirma que asumieron el día
en que se corrió el seed.

Hacer editable `created_at` no era opción: es un campo de auditoría *y* era la clave de orden del historial.

[ADR-0002](0002-modelo-del-organigrama.md) rechazó la "temporalidad completa (vigencia desde/hasta **por
nodo**)" porque las reorganizaciones son esporádicas y `active` alcanza. Esto es otra cosa: no es la vigencia
de la *unidad*, es la del *mandato*, y el propio ADR-0002 dice que "cambia más seguido quién ejerce que qué
se ejerce".

## Decisión

`organigram_holder.start_date` (`DATE`, nullable), con backfill desde `DATE(created_at)` en la migración.
`created_at` queda como lo que siempre fue: cuándo se escribió la fila.

- `POST /organigram/units/{id}/holders` acepta `start_date`; omitirlo significa "asumió hoy".
- `PATCH /organigram/holders/{id}` acepta `name` y `start_date`, **ambos opcionales**, con un validador que
  rechaza un cuerpo que no corrige nada.
- `holder_history` ordena por `start_date DESC`, con `created_at` como desempate.

**Sólo fecha de inicio, sin fecha de fin.** En una cadena de titulares las fechas de inicio determinan el
historial completo: un mandato termina cuando empieza el siguiente.

## Consecuencias

- **El orden del historial deja de depender del orden de carga.** Un historial cargado a posteriori se
  escribe en el orden en que la persona lo fue tipeando, que no dice nada sobre la sucesión.
- **Ninguna corrección mueve `is_current`.** Vale para el nombre y ahora también para la fecha: el
  guardarraíl de ADR-0002 —corregir una errata en un titular anterior no debe volverlo vigente— sigue en pie.
- **Las filas anteriores a la columna siguen mostrando lo mismo** gracias al backfill; `NULL` queda
  disponible para "no se sabe cuándo asumió", y la UI cae a `created_at` para el valor inicial del campo.
- **No se puede registrar una vacancia** (un período sin titular). Requeriría fecha de fin y un modelo de
  huecos y solapamientos; no hay evidencia todavía de que haga falta.

## Alternativas consideradas

- **Hacer editable `created_at`.** Rechazada: es auditoría, y era la clave de orden.
- **`start_date` + `end_date`.** Rechazada por ahora: agrega consistencia que policiar (huecos,
  solapamientos) para expresar sólo la vacancia. La columna se puede agregar después, nullable y aditiva.
- **Un `date` con precisión variable** (sólo año, cuando no se sabe el día). Rechazada: complica el tipo y
  la UI para un caso que todavía no se observó.
