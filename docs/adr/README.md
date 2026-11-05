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
| [0012](0012-ranking-en-el-backend-filtrado-en-el-cliente.md) | El ranking vive en el backend; el filtrado por sector, en el cliente | Organigrama |
| [0013](0013-la-marca-de-sugerencia-es-el-acto-de-validar.md) | La marca de sugerencia es el acto de validar: un campo no validado queda vacío | Validación |
| [0014](0014-workbook-exportado-de-solo-lectura.md) | El workbook exportado es un reporte de sólo lectura | Export |
| [0015](0015-catalogos-cerrados-de-seguimiento-como-enums.md) | Situación y estado son catálogos cerrados en el código, no ABM | Persistencia |
| [0016](0016-la-grilla-se-alcanza-desde-el-flujo-de-recomendaciones.md) | La grilla de seguimiento se alcanza desde el flujo de recomendaciones, no desde el menú de features | Navegación |

0001–0007 surgieron del análisis en [`../defensoria/`](../defensoria/); 0008–0009 surgieron de testear la API
real con documentos reales (ver la conversación de esa sesión para el detalle completo); 0010–0011 surgieron
de construir el ABM de la fase 7, cuando la app pasó a escribir sobre lo que hasta entonces sólo sembraba el
seed; 0012–0013 salieron de una pasada retrospectiva sobre las decisiones que se habían ido tomando por
síntoma durante el QA del formulario de validación, sin quedar declaradas en ningún lado.

En esa misma pasada se enmendaron 0001, 0008 y 0009. Las enmiendas van fechadas dentro de cada documento, con
la decisión original intacta: lo que se agrega es lo que se aprendió después, no una reescritura de lo que se
había decidido.

0014–0015 salieron de una sesión de `/grill-with-docs` sobre la Fase 9 y la estrategia de
persistencia/exportación: ratificaron el rol del workbook exportado, que ADR-0004 dejaba implícito, y dejaron
por escrito por qué dos catálogos de seguimiento no siguen el patrón administrable de los demás. El vocabulario
que esa sesión fijó está en [`CONTEXT.md`](../../CONTEXT.md).

0016 registra una decisión que se tomó en el código antes que en un documento: al construir la tajada A de la
Fase 9 se sacaron dos de los tres accesos a la grilla que pedía el issue #58, para alinear con la
implementación histórica de escritorio. Se escribió en la revisión del PR de la tajada B, cuando la diferencia
con el issue apareció como hallazgo.
