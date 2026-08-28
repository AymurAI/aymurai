# ADR-0002 — Modelo del organigrama: unidad, titular e identidad estable

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

El organigrama del GCBA llega como un JSON derivado de un PDF oficial: un árbol de nodos con `cargo`,
`sigla`, `nombre` (el titular) y `dependencias`. La implementación histórica lo cargaba en memoria y
buscaba sobre un DataFrame, con persona y cargo **en la misma fila**.

Esa fusión obligaba a `search_candidates` a devolver dos listas independientes, con la advertencia de que
*"la persona X puede ya no ocupar el cargo Y que el organigrama le asigna"*.

El dominio distingue los dos ritmos explícitamente: **cambia más seguido quién ejerce que qué se ejerce.**

## Decisión

Dos entidades:

- **`organigram_unit`** — el cargo/oficina. Auto-referenciada por `parent_id`, profundidad arbitraria.
- **`organigram_holder`** — quién lo ocupa. Historial completo, con `is_current` y un **índice único parcial**
  `(unit_id) WHERE is_current = true`.

**Identidad:** `id = uuid5(NS, "<ruta_cargos>#<índice entre hermanos>")`, computado **sólo en el seed**.

## Evidencia

- **`sigla` NO es única**: 482 distintas sobre 489, con 6 duplicadas legítimas (pares entidad/adjunta).
- **`cargo` tampoco**: 463 sobre 489.
- **`ruta_cargos` sola tampoco**: dos nodos `Dirección` homónimos bajo el mismo padre. Añadir la sigla no
  alcanza; añadir el nombre del titular sí, pero haría depender la identidad de la unidad de su ocupante.

## Consecuencias

- **La advertencia del histórico desaparece del código de búsqueda**: la relación persona↔cargo es explícita.
- Cambiar el titular **inserta** una fila y baja la anterior; el historial se acumula solo.
- `is_current` es un **flag curado**, no "la fila más reciente": corregir una errata en un titular anterior
  no debe convertirlo en vigente.
- **`ruta_cargos` se computa, no se materializa** — 520 nodos entran en memoria.
- ⚠️ **Guardarraíl:** el UUID se deriva de un valor mutable. Es correcto **sólo porque se computa una vez**.
  Recomputarlo tras un renombre rompería todas las referencias de los registros ya extraídos. Debe estar
  escrito en el seed y cubierto por un test.

## Alternativas consideradas

- **`sigla` como id natural.** Rechazada: no es única, y la duplicación es legítima.
- **Temporalidad completa** (vigencia desde/hasta por nodo). Rechazada: las reorganizaciones son
  "esporádicas o inexistentes en toda una gestión"; `active` alcanza.
- **`nombre` como entidad `person`.** Rechazada: son texto libre de un PDF, sin sistema de identidad;
  emparejar personas por string es la fragilidad que este diseño elimina en todas partes.
