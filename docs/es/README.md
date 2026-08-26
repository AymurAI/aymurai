# Índice de Documentación
Idioma: [English](../README.md) | **Español**

Documentación operativa de AymurAI `v2.0.0`.

## Documentos principales
- Entrada del repositorio: [../../README.es.md](../../README.es.md)
- Referencia de API: [api/README.md](api/README.md)
- Referencia de configuración: [configuration/README.md](configuration/README.md)
- Esquema de base de datos interna: [database/README.md](database/README.md)
- Desarrollo y empaquetado del frontend: [../../frontend/README.md](../../frontend/README.md)

## Flujos
- Índice de pipelines: [pipelines/README.md](pipelines/README.md)
- Flujo anonymizer: [pipelines/anonymizer/README.md](pipelines/anonymizer/README.md)
- Flujo datapublic: [pipelines/datapublic/README.md](pipelines/datapublic/README.md)
- Flujo de sumarización: [pipelines/summarization/README.md](pipelines/summarization/README.md)
- Flujo de transcripción (ASR): [pipelines/transcription/README.md](pipelines/transcription/README.md)

## Entidades
- Índice de entidades: [entities/README.md](entities/README.md)
- Entidades de datapublic: [entities/datapublic/README.md](entities/datapublic/README.md)
- Entidades de anonymizer: [entities/anonymizer/README.md](entities/anonymizer/README.md)

## Modelos
- Índice de modelos: [models/README.md](models/README.md)
- Model card del NER de anonymizer: [models/anonymizer-model-card.md](models/anonymizer-model-card.md)
- Model card de Flair NER: [models/flair-model-card.md](models/flair-model-card.md)
- Model card de Decision: [models/decision-model-card.md](models/decision-model-card.md)

## Notas de diseño
Material que documenta intención y no comportamiento en producción. Leerlo como
propuestas; las páginas lo aclaran explícitamente donde divergen de producción.

- Desambiguación de entidades: [anonymization/README.md](anonymization/README.md)
- Métrica de evaluación de la desambiguación: [../metrics/entity-disambiguation-metric.md](../metrics/entity-disambiguation-metric.md)

## Gobernanza
Estos documentos están disponibles solo en inglés.

- Contribución: [../CONTRIBUTING.md](../CONTRIBUTING.md)
- Seguridad y ética: [../SECURITY.md](../SECURITY.md)
- Código de conducta: [../CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md)

## Trabajo con agentes
Convenciones para agentes de IA que contribuyen a este repositorio. Los estándares
de ingeniería en sí viven en `.agents/rules/` y están resumidos en
[`AGENTS.md`](../../AGENTS.md).

- Convenciones del issue tracker: [../agents/issue-tracker.md](../agents/issue-tracker.md)
- Etiquetas de triage: [../agents/triage-labels.md](../agents/triage-labels.md)
- Documentos de dominio: [../agents/domain.md](../agents/domain.md)
