# Documentation Index
Language: **English** | [Español](es/README.md)

Operational documentation for AymurAI `v2.0.0`.

## Core docs
- Repository entrypoint: [../README.md](../README.md)
- API reference: [api/README.md](api/README.md)
- Configuration reference: [configuration/README.md](configuration/README.md)
- Defensoria deployment runbook: [deployment/defensoria.md](deployment/defensoria.md)
- Internal database schema: [database/README.md](database/README.md)
- Frontend development and packaging: [../frontend/README.md](../frontend/README.md)

## Workflows
- Pipelines index: [pipelines/README.md](pipelines/README.md)
- Anonymizer flow: [pipelines/anonymizer/README.md](pipelines/anonymizer/README.md)
- Datapublic flow: [pipelines/datapublic/README.md](pipelines/datapublic/README.md)
- Summarization flow: [pipelines/summarization/README.md](pipelines/summarization/README.md)
- Transcription (ASR) flow: [pipelines/transcription/README.md](pipelines/transcription/README.md)
- Defensoría del Pueblo (CABA) data extraction (feature-flagged): [pipelines/defensoria/README.md](pipelines/defensoria/README.md)

## Entities
- Entities index: [entities/README.md](entities/README.md)
- Datapublic entities: [entities/datapublic/README.md](entities/datapublic/README.md)
- Anonymizer entities: [entities/anonymizer/README.md](entities/anonymizer/README.md)

## Models
- Models index: [models/README.md](models/README.md)
- Anonymizer NER model card: [models/anonymizer-model-card.md](models/anonymizer-model-card.md)
- Flair NER model card: [models/flair-model-card.md](models/flair-model-card.md)
- Decision model card: [models/decision-model-card.md](models/decision-model-card.md)

## Design notes
Material that documents intent rather than shipped behaviour. Read it as
proposals; the pages say so explicitly where they diverge from production.

- Entity disambiguation: [anonymization/README.md](anonymization/README.md)
- Disambiguation evaluation metric (Spanish only): [metrics/entity-disambiguation-metric.md](metrics/entity-disambiguation-metric.md)
- Defensoría del Pueblo (CABA) design record — analysis, plan, ADRs (Spanish only): [defensoria/README.md](defensoria/README.md)

## Governance
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security and ethics: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Working with agents
Conventions for AI agents contributing to this repository. The engineering
standards themselves live in `.agents/rules/` and are summarized in
[`AGENTS.md`](../AGENTS.md).

- Issue tracker conventions: [agents/issue-tracker.md](agents/issue-tracker.md)
- Triage labels: [agents/triage-labels.md](agents/triage-labels.md)
- Domain docs: [agents/domain.md](agents/domain.md)
