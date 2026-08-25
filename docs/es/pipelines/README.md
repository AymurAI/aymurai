# Pipelines
Idioma: [English](../../pipelines/README.md) | **Español**

Esta sección documenta los flujos del backend de AymurAI, uno por flujo.

Dos de ellos son pipelines de ML de AymurAI, configurados por un archivo JSON bajo
`resources/pipelines/production/`. Los otros dos orquestan servicios externos y no
tienen config de pipeline propia.

## Pipelines de ML
- Anonymizer: [anonymizer/README.md](anonymizer/README.md)
- Datapublic: [datapublic/README.md](datapublic/README.md)

## Flujos sobre servicios
- Sumarización (llama.cpp): [summarization/README.md](summarization/README.md)
- Transcripción / ASR (coro): [transcription/README.md](transcription/README.md)

## Documentos de modelos relacionados
- Índice de modelos: [../models/README.md](../models/README.md)
- Model card de Flair NER: [../models/flair-model-card.md](../models/flair-model-card.md)
- Model card de Decision: [../models/decision-model-card.md](../models/decision-model-card.md)

## Fuentes de pipelines de producción
- Config de anonymizer: `resources/pipelines/production/flair-anonymizer/pipeline.json`
- Config de datapublic: `resources/pipelines/production/datapublic/pipeline.json`

Ambas configs tienen `"device": "cpu"` hardcodeado para todos los modelos. No hay
variable de entorno que lo sobreescriba — la variable `TORCH_DEVICE` que setea
`docker-compose.yml` no la lee nadie. Correr inferencia en GPU implica editar los
campos `device` de esos archivos. Ver la
[referencia de configuración](../configuration/README.md#inferencia).

## Mapeo con la API
| Flujo | Ruta de entrada | Respaldo |
|---|---|---|
| `anonymizer` | `POST /api/anonymizer/predict` | pipeline `flair-anonymizer` |
| `datapublic` | `POST /api/datapublic/predict/{document_id}` | pipeline `datapublic` |
| sumarización | `POST /api/llm/summarize` | `llama-server` externo |
| transcripción | `POST /api/asr/transcribe` | server `coro` externo |

## Documentos relacionados
- Referencia de API: [../api/README.md](../api/README.md)
- Configuración: [../configuration/README.md](../configuration/README.md)
- Base de datos interna: [../database/README.md](../database/README.md)
- Notas de diseño de desambiguación: [../../anonymization/README.md](../../anonymization/README.md)
