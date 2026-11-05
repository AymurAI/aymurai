# ADR-0006 — Se descarta el catálogo CSV de sectores

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

La implementación histórica ofrecía dos modos para resolver el sector específico de un destinatario:
`"csv"`, que matchea contra `destinatario_por_sector.csv` (~140 filas), y `"hierarchy"`, que lee la ruta del
organigrama. El default ya era `"hierarchy"`, con esta justificación registrada:

> *"`destinatario_por_sector.csv` cubre 16 sectores, mientras que el organigrama tiene ~33. Si el sector real
> de un destinatario no está en esas 16 filas, el modo `csv` no puede acertar nunca."*

## Decisión

**Eliminar `sector_mode`, `sector_top_k`, `search_sector_candidates` y el archivo CSV.**

## Evidencia

Medido contra el organigrama real:

- Los **16 sectores GCBA del CSV existen todos** en el organigrama (16/16).
- El CSV tiene **cero sectores propios** que el organigrama no tenga.
- El organigrama tiene **17 sectores que el CSV no puede producir nunca**.

Es un **subconjunto estricto**: cubre 16 de 33 y no aporta nada.

## Consecuencias

- Mantenerlo sería exactamente el "catálogo paralelo" que el brief prohíbe, y uno que además ya derivó
  respecto del organigrama.
- Junto con el reemplazo de las 5 reglas por el flag `is_sector` (ADR-0001), **`sector_matching.py` completo
  (443 líneas) deja de existir**.
- **El CSV sí tiene un uso puntual antes de descartarse:** sembrar `short_name` para los 3 sectores cuya
  etiqueta corta difiere del `cargo` del nodo (`AGC`, `AGIP`, `Jefatura de Gabinete`). De los 16, **13 tienen
  etiqueta idéntica**.
