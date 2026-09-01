# ADR-0009 — `sector_id` se valida independiente de `unit_id`, nunca se deriva

**Fecha:** 2026-08-31 · **Estado:** aceptada

## Contexto

El diseño original de Fase 5 (`RecipientValidationRequest`/`RecipientValidationData`/`_reconcile_recipients`)
sólo aceptaba `unit_id` en el `PUT /validate`. `sector_id` se calculaba **siempre** automáticamente vía
`resolve_sector(unit_id)` en el momento de guardar — el humano nunca podía confirmarlo ni corregirlo por su
cuenta.

Al testear el flujo real, surgió que en el frontend la persona valida principalmente el **sector** del
destinatario (un campo de primer nivel, no un detalle derivado del cargo). Esto exigía aceptar `sector_id`
como input explícito e independiente — lo que abrió dos riesgos reales, encontrados ambos probando la API a
mano, no por inspección de código:

1. **Inconsistencia silenciosa:** nada impedía validar un `sector_id` que no fuera el ancestro real de
   `unit_id` en el organigrama (ej. sector de un destinatario y unidad de otro).
2. **Referencias inexistentes silenciadas:** un `unit_id`/`sector_id` con un id que no existe en absoluto
   (typo, id de otra base) se guardaba como `null` sin ningún aviso — `session.get(...)` devuelve `None` para
   un id inexistente, y el guardado seguía de largo sin distinguir "no se mandó nada" de "se mandó algo mal".

## Decisión

- `RecipientValidationRequest`/`RecipientValidationData` aceptan `sector_id` como campo explícito,
  independiente de `unit_id` — nunca derivado.
- `_reconcile_recipients` valida, antes de guardar cualquier cosa:
  - **Existencia:** si `unit_id`/`sector_id` vienen, deben existir de verdad en `organigram_unit`
    (`OrganigramReferenceNotFoundError` si no).
  - **Consistencia:** si ambos vienen, `sector_id` debe ser exactamente `resolve_sector(unit_id)`
    (`InconsistentSectorError` si no).
- El router traduce ambas excepciones a **422**, y la transacción completa se corta — no se persiste nada a
  medias si un solo destinatario de la lista falla.
- El índice aprendido (`recipient_learned_index_lookup`) ahora **lee `sector_id` directo de la fila
  guardada**, nunca lo recalcula vía `resolve_sector` — así una reorganización posterior del árbol no pisa lo
  que el humano ya confirmó. También filtra a unidades `active=True`: una unidad desactivada después de
  validarse deja de ser reutilizable por el índice aprendido.

## Evidencia

Probado contra la base real (Resolución 1765/22, dos destinatarios):

- Validar `sector_id` = "Secretaría de Gobierno y Vínculo Ciudadano" contra `unit_id` de "Dirección General
  Obras en Vías Peatonales" (cuyo sector real es "Ministerio de Espacio Público e Higiene Urbana") →
  **422**, `"sector_id ... is not unit_id ...'s sector in the organigram"`. Los dos destinatarios ya
  guardados de esa recomendación quedaron intactos (rollback correcto).
- Validar `sector_id` = `00000000-0000-0000-0000-000000000000` (no existe) → **422**,
  `"sector_id ... does not exist in the organigram"`, en vez de guardarse como `null` en silencio (el
  comportamiento previo, confirmado antes de este fix).

## Consecuencias

- El export (`SECTOR_FINAL` en la hoja `destinatarios`) ahora lee el `sector_id` **validado** del
  `recipient`, no lo deriva de `unit_id` — es el mismo cambio de fondo, visible en la salida.
- La comparación `RecipientMatch.sector_id`/`sector_name` en la respuesta de extracción (autoresolve) sigue
  derivando vía `resolve_sector` cuando no hay validación previa — esta ADR sólo cambia qué pasa una vez que
  un humano valida, no la sugerencia inicial del sistema.
