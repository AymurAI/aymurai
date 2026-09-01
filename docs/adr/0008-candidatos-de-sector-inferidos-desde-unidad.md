# ADR-0008 — Los candidatos de sector se infieren desde matches de unidad, no se buscan por nombre de sector

**Fecha:** 2026-08-31 · **Estado:** aceptada

## Contexto

La Fase 4 original (auto-resolución) sólo devolvía un `unit_id`/`sector_id` (o `null`) — nunca una lista de
alternativas. Al testear el flujo completo contra documentos reales, surgió la necesidad real de mostrarle al
humano una lista de candidatos para elegir cuando el auto-resolve no está seguro (o para corregirlo cuando sí
lo está pero se equivocó), replicando el `candidatos_sector`/`search_sector_candidates` que sí existía en el
histórico (nunca implementado en este repo hasta ahora).

**Primer intento (rechazado):** filtrar el corpus de búsqueda a únicamente nodos `is_sector=True`, y limpiar
el texto del cargo con una función nueva (`clean_sector`) que aislaba la cadena de institución padre en vez
de descartarla (lo que sí hace `clean_cargo` para matchear contra unidades específicas).

## Decisión

**Los candidatos de sector se obtienen buscando contra *unidades* (con `clean_cargo`, igual que el
auto-resolve) y recién después infiriendo el sector de cada unidad candidata vía `resolve_sector` (caminar el
árbol hasta el ancestro-o-sí-mismo con `is_sector=True`), deduplicando por sector y quedándose con el mejor
score visto.**

Se busca un pool más amplio que el `top_k` final (`max(DATA_EXTRACTION_TOP_K * 5, 25)`) antes de deduplicar,
porque varias unidades bien rankeadas suelen colapsar al mismo sector.

## Evidencia

Cargo real: *"Directora General Obras en Vías Peatonales, dependiente del Ministerio de Espacio Público e
Higiene Urbana del Gobierno de la Ciudad Autónoma de Buenos Aires"*.

- **Con el primer intento** (`clean_sector` + corpus filtrado a sectores): "Ministerio de Espacio Público e
  Higiene Urbana" no entraba en el top-10 de 33 sectores — la comparación era contra un texto corto, sin el
  contexto rico de la unidad específica.
- **Con la decisión final**: la unidad "Dirección General Obras en Vías Peatonales" matchea con score
  **87.6** (casi exacto) vía `clean_cargo`; `resolve_sector` la resuelve a "Ministerio de Espacio Público e
  Higiene Urbana", que queda primero en `sector_candidates` con ese mismo score.
- **Caso más exigente** (Luciano Nicolás Martínez, cargo *"dependiente de la Jefatura de Gabinete de
  Ministros..."* — el texto **nunca menciona** su sector real, "Secretaría de Gobierno y Vínculo Ciudadano",
  que es una secretaría intermedia entre esa jefatura y su unidad): la decisión final igual lo resuelve
  primero (score 91.0), porque el sector se infiere caminando el **árbol real** (`parent_id`), no buscando el
  nombre del sector en el texto. El primer intento no podía resolver este caso bajo ninguna circunstancia,
  porque el sector correcto simplemente no está escrito en el cargo.

## Consecuencias

- Hereda gratis la desambiguación por cadena de padres que ya usaba el auto-resolve (`match_cargo`) — el caso
  de las DGTAL homónimas (ver ADR-0002) se resuelve igual de bien para sectores.
- No hace falta ninguna función de limpieza de texto nueva ni corpus separado — `_sector_corpus`,
  `clean_sector` y el parámetro `query_clean_fn` de `match_cargo` se agregaron y se revirtieron en la misma
  sesión al confirmar que el enfoque no rendía.
- `sector_candidates` se calcula **siempre**, incluso cuando el índice aprendido (`recipient_learned_index_lookup`)
  resuelve con confianza sin correr ninguna búsqueda — un humano debe poder ver alternativas aunque el sistema
  ya tenga una respuesta aprendida.
