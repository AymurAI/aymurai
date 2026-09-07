# Pipelines
Language: **English** | [Español](../es/pipelines/README.md)

This section documents the AymurAI backend workflows by flow.

Two of them are AymurAI ML pipelines, configured by a JSON file under
`resources/pipelines/production/`. Two more orchestrate external services and
have no pipeline config of their own. A fifth, feature-flagged flow adds a
customer-specific LLM extraction on top of the same external service.

## ML pipelines
- Anonymizer: [anonymizer/README.md](anonymizer/README.md)
- Datapublic: [datapublic/README.md](datapublic/README.md)

## Service-backed flows
- Summarization (llama.cpp): [summarization/README.md](summarization/README.md)
- Transcription / ASR (coro): [transcription/README.md](transcription/README.md)

## Feature-flagged flows
- Defensoría del Pueblo (CABA) data extraction (llama.cpp, `DEFENSORIA_ENABLED`): [defensoria/README.md](defensoria/README.md)

## Related model docs
- Models index: [../models/README.md](../models/README.md)
- Flair NER model card: [../models/flair-model-card.md](../models/flair-model-card.md)
- Decision model card: [../models/decision-model-card.md](../models/decision-model-card.md)

## Production pipeline sources
- Anonymizer config: `resources/pipelines/production/flair-anonymizer/pipeline.json`
- Datapublic config: `resources/pipelines/production/datapublic/pipeline.json`

Both configs hardcode `"device": "cpu"` for every model. There is no environment
variable that overrides this — the `TORCH_DEVICE` variable set by
`docker-compose.yml` is read by nothing. Running inference on GPU means editing
the `device` fields in these files. See the
[configuration reference](../configuration/README.md#inference).

## API mapping
| Flow | Entry route | Backing |
|---|---|---|
| `anonymizer` | `POST /api/anonymizer/predict` | `flair-anonymizer` pipeline |
| `datapublic` | `POST /api/datapublic/predict/{document_id}` | `datapublic` pipeline |
| summarization | `POST /api/llm/summarize` | external `llama-server` |
| transcription | `POST /api/asr/transcribe` | external `coro` server |
| defensoria data extraction | `POST /api/llm/data-extraction` | external `llama-server` (feature-flagged) |

## Related docs
- API reference: [../api/README.md](../api/README.md)
- Configuration: [../configuration/README.md](../configuration/README.md)
- Internal database: [../database/README.md](../database/README.md)
- Entity disambiguation design notes: [../anonymization/README.md](../anonymization/README.md)
