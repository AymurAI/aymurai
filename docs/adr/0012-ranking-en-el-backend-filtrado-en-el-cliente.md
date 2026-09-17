# ADR-0012 — El ranking vive en el backend; el filtrado por sector, en el cliente

**Fecha:** 2026-09-17 · **Estado:** aceptada

## Contexto

[ADR-0008](0008-candidatos-de-sector-inferidos-desde-unidad.md) fija que los candidatos de sector se obtienen
buscando contra **unidades** y recién después colapsando cada match a su sector. Para eso el backend rankea un
pool más ancho que el top-k final —`max(DATA_EXTRACTION_TOP_K * 5, 25)`, o sea 25 unidades con el default de
5— y después deduplica. **Ese pool se descartaba**: la respuesta sólo llevaba `sector_candidates`, una fila por
sector.

Probando el flujo real apareció el síntoma: después de validar un sector a mano, el selector de unidad seguía
ofreciendo unidades de otros ministerios. La causa es aritmética, no un bug de matching. El colapso deja una
unidad por sector candidato (~5 filas, vía `source_unit`), así que filtrar esas cinco por el sector validado
suele dejar **una sola** —o ninguna, si el sector que la persona eligió no estaba entre los cinco—. El campo
quedaba sin nada útil que ofrecer justo después del acto que más lo acota.

La pregunta de fondo que abrió esto fue de competencias: *ordenar las unidades de un sector por similitud con
el cargo, ¿es trabajo del front o del back?*

## Decisión

**La división se hace por naturaleza del cálculo, no por conveniencia:**

- **Rankear por similitud con el cargo es del backend.** Es un score híbrido —embeddings MiniLM con peso 0.25
  más `rapidfuzz.token_set_ratio` con 0.75, sobre el texto que normaliza `clean_cargo`— que el renderer no
  puede reproducir: no tiene el modelo de embeddings ni debería tenerlo.
- **Filtrar por sector es del cliente.** Es una caminata de árbol sobre `parent_id`/`is_sector`, y el cliente
  ya tiene el corpus entero en memoria (`listUnits()`), que además necesita para otras cosas.

De ahí la consecuencia concreta: **el backend expone el pool que ya calculaba en vez de tirarlo**. Se agrega
`unit_candidates` a `RecipientMatch` y a `RecipientResponse` (`OrganigramUnitCandidate`: el ranking sin
colapsar, cada unidad con el sector que la contiene). El formulario lo filtra al sector validado y conserva el
orden del backend; las unidades del sector que no están en el pool van después, en orden de árbol.

`sector_candidates` no cambia: sigue siendo la lista colapsada que describe ADR-0008. Son dos vistas del mismo
ranking, para dos preguntas distintas.

## Evidencia

- El pool ya existía y ya estaba rankeado: `match_cargo(..., top_k=max(TOP_K * 5, 25))` en
  `organigram_matching.py`. Exponerlo no agrega ningún cómputo — `_unit_candidates_from_ranked` sólo resuelve
  el sector de cada fila y arma el schema.
- Con el ranking colapsado, un sector validado dejaba **≤1 unidad** ofrecible de las ~5 disponibles. Con el
  pool, quedan las que el backend efectivamente rankeó dentro de ese sector, en su orden.
- La alternativa de rankear en el cliente se probó mentalmente contra el caso que ADR-0008 documenta (Luciano
  Nicolás Martínez, score 91.0): ese score sale de comparar el cargo completo contra el texto de cada unidad.
  Reproducirlo en el renderer significaría reimplementar `clean_cargo` y `token_set_ratio` y aceptar que la
  mitad con embeddings simplemente no existe — dos rankings distintos para el mismo campo según quién lo
  calcule.

## Consecuencias

- **Se revierte un descarte de la sesión anterior.** El spec de diseño del 2026-09-16 (decisión 2) había
  descartado exponer el ranking sin colapsar *"por ahora"*, con el criterio de no tocar el backend y ver si
  las ~5 unidades alcanzaban en uso real. No alcanzaron, y el dato que lo mostró fue el QA del día siguiente.
  Ese spec vive bajo `docs/superpowers/`, que está en `.gitignore`: o sea que el único registro de la vuelta
  atrás estaba en un archivo que nunca sale de la máquina donde se escribió. Este ADR es lo que queda.
- La respuesta de extracción lleva ahora **dos listas derivadas del mismo pool**. Un consumidor que confunda
  cuál usa arrastra los problemas de ADR-0008 (ver la trampa `unit_id === sector_id` ahí documentada).
- El cliente duplica la regla de sector de [ADR-0001](0001-sector-como-atributo-del-nodo.md) para poder
  filtrar. Ese espejo, y su riesgo de divergencia, están en las consecuencias de ese ADR.
- El costo de la respuesta sube: 25 filas de unidad por destinatario en vez de 5 de sector. Es el tamaño que el
  backend ya tenía en memoria y el que el cliente necesita para no quedarse corto después de filtrar.

## Alternativas consideradas

- **Rankear en el cliente, con el corpus que ya tiene.** Rechazada: ver Evidencia. Produciría un orden distinto
  del que el backend usa para su propia autorresolución, sin forma de explicar la diferencia.
- **Ampliar `sector_candidates` en vez de agregar una lista.** Rechazada: cambiaría el contrato que ADR-0008
  fija —una fila por sector— y rompería a cualquier consumidor que lo lea como está escrito.
- **Pedir las unidades del sector en una llamada aparte, al validar el sector.** Rechazada: el backend tendría
  que rankear de nuevo contra un cargo que ya no está en el request, o el endpoint tendría que recibirlo otra
  vez. El pool ya estaba calculado en la extracción; pedirlo dos veces es trabajo repetido para el mismo
  resultado.
