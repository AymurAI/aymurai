# ADR-0013 — La marca de sugerencia es el acto de validar: un campo no validado queda vacío, no inferido

**Fecha:** 2026-09-17 · **Estado:** aceptada

## Contexto

El formulario de validación nació con cada campo **precargado** con la respuesta del modelo, y además con esa
misma respuesta repetida al lado como marca violeta de sugerencia. Dos problemas, uno de UI y uno de datos.

El de UI se encontró primero: como el valor y la sugerencia eran el mismo string en el primer render, la marca
no podía aceptarse ni descartarse de forma significativa — no había nada que aceptar. Peor con los `Select` de
`@aymurai/ui`, que renderizan su marca **sólo cuando no hay valor**: precargar el campo dejaba la marca
directamente inalcanzable, y Tema, Subtema y Ámbito parecían campos ya resueltos en vez de campos pendientes.

El de datos es el que importa: **un campo precargado se guarda validado aunque nadie lo haya mirado.** La
persona apreta Validar y el dataset registra la respuesta del modelo como si un humano la hubiera confirmado.
Es exactamente lo que el flujo de la Defensoría existe para evitar; el requisito declarado es que no haya que
confiar a ciegas en la resolución de la IA.

## Decisión

**Todo campo que el modelo respondió arranca en blanco, con su respuesta viviendo únicamente en una marca
violeta clickeable. El valor guardado es sólo lo que una persona aceptó o escribió.**

Aceptar la marca y escribir/elegir algo propio son el mismo gesto para el formulario: los dos llenan el campo y
los dos hacen desaparecer la marca. Vaciar un campo devuelve la marca, porque vuelve a no haber respuesta
humana.

Alcanza a `recommendation_number`, `recommendation_date`, y por destinatario `name`, `position`,
`macro_sector` y el par `unit_id`/`sector_id` —que viajan siempre juntos, nunca uno solo—, más `topic` y
`subtopic`. En el hook es `blankValidatedFields`.

**Quedan afuera, deliberadamente:** `recommendation_date_text` (prosa cruda que nunca se edita, sólo se muestra
como contexto — PLAN.md §D.3 la conserva verbatim), y los campos cuyo control no puede llevar una marca:
`personal_data` e `is_primary` (pares de radios) y `publishable_content` (textarea). Esos tres siguen
precargados con lo que dijo el modelo.

## Evidencia

- El camino de datos está verificado punta a punta: `toPayload` manda `topic: null` si nadie lo tocó;
  `_resolve_topic_subtopic` mapea un label nulo a `topic_id = None` **sin error ni aviso**
  (`aymurai/database/crud/recommendation.py`); y el export escribe `""` en la columna TEMA
  (`data_extraction_export.py`). O sea: el campo no validado llega vacío hasta la planilla, sin ruido en el
  medio.
- La marca de los `Select` no hubo que construirla: `@aymurai/ui` ya la renderiza como `Suggestion`
  clickeable dentro del trigger, y el formulario ya le pasaba el prop `suggestion`. La rama era inalcanzable
  sólo por la precarga. Blanquear el valor fue todo el mecanismo — no se tocó la librería.
- La decisión se fue tomando de a pedazos, por síntoma, antes de estar declarada: `ff76aeb` (dejar de duplicar
  el texto de la sugerencia dentro del valor), `9493d2f` (restaurar la marca inline siempre visible), `aec3ba8`
  (unidad y sector), `baaa830` (Tema, Subtema y Ámbito). Este ADR es el primer lugar donde se enuncia como
  regla.

## Consecuencias

- **Cambia la semántica del dataset**: un campo vacío ahora significa *"nadie lo validó"*, no *"el modelo no
  supo"*. Antes esos dos casos eran indistinguibles, porque el segundo se guardaba con la respuesta del modelo
  igual que un campo confirmado. Cualquier consulta o métrica sobre completitud tiene que leerse con esto en
  la mano.
- **Se puede guardar una recomendación con TEMA en blanco.** El server no lo impide y este ADR no agrega un
  gate: la decisión es que el dato refleje lo que pasó, no que el formulario obligue. Si la Defensoría
  necesita que Tema sea obligatorio, eso es una decisión aparte, y el lugar natural es el mismo gate que ya
  bloquea el guardado por inconsistencia sector/unidad (ver [ADR-0009](0009-sector-id-validado-independiente-de-unit-id.md)).
- **La respuesta del modelo nunca se pierde**: sigue viajando en `prediction`, que se persiste completo, y la
  marca la ofrece mientras el campo esté vacío. Lo que cambia es que deja de colarse sola a la fila validada.
- **Una sugerencia fuera de catálogo tiene que ser una opción del `Select`.** La marca resuelve el id contra
  la lista de opciones, y aceptarla hace el mismo lookup: una sugerencia ausente de la lista sería invisible
  *e* inaceptable, justo lo contrario del keep-and-flag que el formulario ya hacía. Por eso las opciones se
  arman desde los valores **y** las sugerencias, y el aviso de fuera-de-catálogo mira lo que está en pantalla
  (`value ?? suggestion`), no sólo lo aceptado.
- **Asimetría conocida**: los tres campos que no llevan marca (`personal_data`, `is_primary`,
  `publishable_content`) siguen guardándose con la respuesta del modelo sin intervención humana. Para
  `publishable_content` es razonable —es una síntesis larga que se edita, no se confirma—; para los dos
  booleanos es una deuda: hoy no hay forma de distinguir "contestó que no" de "no lo miró", salvo por
  `personal_data`, que ya es tri-estado y arranca en `null` cuando el modelo tampoco respondió.

## Alternativas consideradas

- **Precargar el valor y marcar visualmente los campos no confirmados** (un borde, un ícono de pendiente).
  Rechazada: el dato guardado seguiría siendo el del modelo, así que no resuelve el problema de fondo; sólo lo
  hace más visible mientras la pantalla está abierta.
- **Guardar la respuesta del modelo y además un flag `validated_by_human` por campo.** Rechazada por costo:
  una columna extra por campo en la fila del dataset, o una tabla de auditoría, para expresar lo mismo que ya
  expresa un campo vacío. `prediction` completo ya queda persistido, así que la respuesta del modelo siempre
  se puede recuperar y comparar contra lo validado.
- **Bloquear el guardado hasta que todos los campos estén validados.** Rechazada acá, no descartada para
  siempre: convierte cada recomendación en un trámite de N clicks obligatorios, incluso cuando el modelo
  acertó todo. Si hace falta, corresponde decidirlo campo por campo y con el gate como mecanismo.
