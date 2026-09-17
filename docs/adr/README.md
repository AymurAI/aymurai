# Architecture Decision Records

Decisiones arquitectónicas con su contexto, su evidencia y las alternativas que se descartaron. Los issues
se cierran y se llevan el porqué; estos documentos persisten.

Convención: ver [`../agents/domain.md`](../agents/domain.md).

| # | Decisión | Área |
|---|---|---|
| [0001](0001-sector-como-atributo-del-nodo.md) | El sector del GCBA es un atributo del nodo, no un conjunto de reglas | Organigrama |
| [0002](0002-modelo-del-organigrama.md) | Modelo del organigrama: unidad, titular e identidad estable | Organigrama |
| [0003](0003-inferencia-y-dataset-separados.md) | Caché de inferencia y fila del dataset son entidades distintas | Persistencia |
| [0004](0004-alcance-instance-wide.md) | El alcance compartido se modela con una entidad `dataset` | Persistencia |
| [0005](0005-salida-estructurada-del-llm.md) | Salida estructurada con enums nullables explícitos | LLM |
| [0006](0006-descartar-catalogo-csv-de-sectores.md) | Se descarta el catálogo CSV de sectores | Organigrama |
| [0007](0007-distribucion-gateada-por-feature-flag.md) | La customización se distribuye gateada por feature flag | Distribución |
| [0008](0008-candidatos-de-sector-inferidos-desde-unidad.md) | Los candidatos de sector se infieren desde matches de unidad, no se buscan por nombre de sector | Organigrama |
| [0009](0009-sector-id-validado-independiente-de-unit-id.md) | `sector_id` se valida independiente de `unit_id`, nunca se deriva | Persistencia |
| [0010](0010-identidad-de-unidades-creadas-desde-la-app.md) | Las unidades creadas desde la app llevan `uuid4`, no `uuid5` | Organigrama |
| [0011](0011-fecha-de-asuncion-del-titular.md) | La fecha de asunción del titular es distinta de `created_at` | Organigrama |

0001–0007 surgieron del análisis en [`../defensoria/`](../defensoria/); 0008–0009 surgieron de testear la API
real con documentos reales (ver la conversación de esa sesión para el detalle completo); 0010–0011 surgieron
de construir el ABM de la fase 7, cuando la app pasó a escribir sobre lo que hasta entonces sólo sembraba el
seed.
