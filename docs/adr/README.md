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

Todos surgieron del análisis en [`../defensoria/`](../defensoria/), donde está la evidencia completa.
