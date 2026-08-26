# API Reference
Language: **English** | [Español](../es/api/README.md)

This document describes the currently mounted public API in `aymurai/api/main.py` + `aymurai/api/core.py`.

## Base URL and OpenAPI
- Local base URL: `http://localhost:8899`
- Swagger UI: `http://localhost:8899/api/docs`
- OpenAPI JSON: `http://localhost:8899/api/openapi.json`

## Public Endpoints (Mounted)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/server/healthcheck` | Service liveness check |
| `GET` | `/api/server/stats/summary` | Runtime CPU/memory stats |
| `POST` | `/api/document-extract` | Deprecated alias of `/api/misc/document-extract` |
| `POST` | `/api/misc/document-extract` | Extract normalized paragraphs from uploaded document |
| `POST` | `/api/anonymizer/predict` | NER prediction for a paragraph |
| `POST` | `/api/anonymizer/disambiguate` | Canonical entity disambiguation + policy merge |
| `POST` | `/api/anonymizer/validation` | Fetch paragraph-level manual validation |
| `POST` | `/api/anonymizer/anonymize-document` | Compile and export anonymized document |
| `POST` | `/api/datapublic/predict/{document_id}` | Predict entities for data-public flow |
| `GET` | `/api/datapublic/validation/document/{document_id}` | Read document-level validation |
| `POST` | `/api/datapublic/validation/document/{document_id}` | Save document-level validation |
| `POST` | `/api/llm/summarize` | Summarize a document through the LLM backend |
| `POST` | `/api/llm/summarize/stream` | Same, streamed as server-sent events |
| `GET` | `/api/llm/summarize/validation/document/{document_id}` | Read a stored summary and its human validation |
| `POST` | `/api/llm/summarize/validation/document/{document_id}` | Save the human-validated summary |
| `POST` | `/api/asr/transcribe` | Transcribe an uploaded audio file |
| `POST` | `/api/asr/transcribe/stream` | Same, streamed as server-sent events |
| `GET` | `/api/asr/validation/document/{document_id}` | Read a stored transcription and its validation |
| `POST` | `/api/asr/validation/document/{document_id}` | Save the human-validated transcription |
| `POST` | `/api/convert/pdf/odt` | Convert PDF to ODT |
| `POST` | `/api/convert/pdf/docx` | Convert PDF to DOCX |
| `POST` | `/api/convert/docx/odt` | Convert DOCX to ODT |
| `POST` | `/api/convert/docx/pdf` | Convert DOCX to PDF |
| `POST` | `/api/convert/odt/pdf` | Convert ODT to PDF |
| `POST` | `/api/convert/odt/docx` | Convert ODT to DOCX |

Routes under `/api/llm/*` and `/api/asr/*` proxy external services (`llama-server`
and `coro` respectively) and are only usable once those are configured. They
answer `500 Configuration error` when their base URL is unset.

## Core Data Contracts

Note: the JSON snippets below are minimal valid examples. Real payloads may include additional fields depending on the endpoint and processing stage.

### `TextRequest`
```json
{
  "text": "Acusado: Ramiro Marrón DNI 34.555.666."
}
```

### `EntityAttributes` (relevant fields)
```json
{
  "aymurai_label": "PER",
  "aymurai_label_subclass": [],
  "aymurai_method": "flair",
  "aymurai_score": 0.97,
  "canonical_entity_id": "a3f8b60f-8e7e-4c8b-9de2-ec8dd3f44c12",
  "aymurai_label_instance": 1,
  "aymurai_disambiguation": "fuzzy",
  "aymurai_anonymize": true
}
```

### `DocLabel`
```json
{
  "text": "Ramiro Marrón",
  "start_char": 9,
  "end_char": 22,
  "attrs": {
    "aymurai_label": "PER"
  }
}
```

### `DocumentInformation`
```json
{
  "document": "Acusado: Ramiro Marrón DNI 34.555.666.",
  "labels": [
    {
      "text": "Ramiro Marrón",
      "start_char": 9,
      "end_char": 22,
      "attrs": {
        "aymurai_label": "PER"
      }
    }
  ]
}
```

### `LabelPolicy`
```json
{
  "anonymize": true,
  "disambiguation": "fuzzy",
  "use_subclass_when_available": true
}
```

### `RenderPolicy`
```json
{
  "suffix_mode": "auto",
  "suffix_threshold": 1
}
```

### `DocumentAnnotations`
```json
{
  "data": [
    {
      "document": "...",
      "labels": []
    }
  ],
  "label_policies": {
    "PER": {
      "anonymize": true,
      "disambiguation": "fuzzy",
      "use_subclass_when_available": false
    }
  },
  "render_policy": {
    "suffix_mode": "auto",
    "suffix_threshold": 1
  }
}
```

## Endpoint Details and Examples

### Server

#### `GET /api/server/healthcheck`
- Response `200`:

```json
{"status": "ok"}
```

```bash
curl -s http://localhost:8899/api/server/healthcheck
```

#### `GET /api/server/stats/summary`
- Response `200` (shape):

```json
{
  "is_docker": true,
  "cpu_core_limit": 4,
  "cpu_usage_percent": 0.0,
  "memory_limit_mb": 4096.0,
  "memory_usage_mb": 823.5
}
```

```bash
curl -s http://localhost:8899/api/server/stats/summary
```

### Document Extraction

#### `POST /api/misc/document-extract`
#### `POST /api/document-extract` (deprecated alias)
- Request: `multipart/form-data` with `file`
- Accepted input formats: DOCX, PDF
- The extractor still parses ODT, but the format is **deprecated** as an input:
  the application rejects `.odt` uploads, so do not rely on it.
- Response `200`:

```json
{
  "document": ["Paragraph 1", "Paragraph 2"],
  "document_id": "f2b25507-cf88-5b11-8f2a-c0b6f940b7f8"
}
```

```bash
curl -s -X POST \
  -F "file=@/resources/data/sample/document-01.docx" \
  http://localhost:8899/api/misc/document-extract
```

Common errors:
- `504` extraction timeout
- `500` extractor/internal errors

### Anonymizer

#### `POST /api/anonymizer/predict`
- Request body: `TextRequest`
- Query param: `use_cache=true|false` (default `true`)
- Response `200`: `DocumentInformation`

```bash
curl -s -X POST "http://localhost:8899/api/anonymizer/predict?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Acusado: Ramiro Marrón DNI 34.555.666."}'
```

#### `POST /api/anonymizer/disambiguate`
- Request body:

```json
{
  "paragraphs": [
    {
      "document": "Acusado: Ramiro Marrón DNI 34.555.666.",
      "labels": []
    }
  ],
  "label_policies": {
    "PER": {
      "anonymize": true,
      "disambiguation": "fuzzy",
      "use_subclass_when_available": false
    }
  }
}
```

- Response `200`: `DocumentAnnotations` (with `data` and effective `label_policies`)

```bash
curl -s -X POST http://localhost:8899/api/anonymizer/disambiguate \
  -H "Content-Type: application/json" \
  -d '{"paragraphs":[{"document":"Acusado: Ramiro Marrón DNI 34.555.666.","labels":[]}],"label_policies":{"PER":{"anonymize":true,"disambiguation":"fuzzy"}}}'
```

#### `POST /api/anonymizer/validation`
- Request body: `TextRequest`
- Response `200`: `list[DocLabel] | null`

```bash
curl -s -X POST http://localhost:8899/api/anonymizer/validation \
  -H "Content-Type: application/json" \
  -d '{"text":"Acusado: Ramiro Marrón DNI 34.555.666."}'
```

#### `POST /api/anonymizer/anonymize-document`
- Request: `multipart/form-data`
  - `file`: original document (`.docx` or `.pdf`)
  - `annotations`: JSON string serialized from `DocumentAnnotations`
- Response `200`: anonymized `.odt` for DOCX input or anonymized `.pdf` for PDF input

```bash
curl -X POST http://localhost:8899/api/anonymizer/anonymize-document \
  -F "file=@/resources/data/sample/document-01.docx" \
  -F 'annotations={"data":[{"document":"Acusado: Ramiro Marrón DNI 34.555.666.","labels":[]}],"label_policies":{"PER":{"anonymize":true,"disambiguation":"fuzzy"}},"render_policy":{"suffix_mode":"auto","suffix_threshold":1}}'
```

Common errors:
- `400` invalid form payload, unsupported input format, or invalid document
- `500` conversion/anonymization failures

### Data-Public

#### `POST /api/datapublic/predict/{document_id}`
- Path param: `document_id` (`UUID5`)
- Request body: `TextRequest`
- Query param: `use_cache=true|false` (default `true`)
- Response `200`: `DocumentInformation`

```bash
curl -s -X POST "http://localhost:8899/api/datapublic/predict/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Buenos Aires, 17 de noviembre de 2024"}'
```

#### `GET /api/datapublic/validation/document/{document_id}`
- Response `200`: object or `null`
- Response `404`: document not found

```bash
curl -s http://localhost:8899/api/datapublic/validation/document/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc
```

#### `POST /api/datapublic/validation/document/{document_id}`
- Request body: free-form JSON object (stored as document-level validation)
- Response `200`: empty body

```bash
curl -s -X POST http://localhost:8899/api/datapublic/validation/document/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc \
  -H "Content-Type: application/json" \
  -d '{"materia":"penal","violencia_de_genero":"si"}'
```

### Summarization (LLM)

These routes require a running `llama-server`; see the LLM backend section of the
[repository README](../../README.md) and the
[configuration reference](../configuration/README.md). When `LLAMACPP_BASE_URL`
is unset the routes answer `500 Configuration error`.

Cache identity is **the source text alone** — the generation config is never
compared. Regenerating therefore needs an explicit `use_cache=false`, and doing
so clears any stored human validation.

#### `POST /api/llm/summarize`
- Request body: `SummarizationRequest`
- Query param: `use_cache=true|false` (default `true`)
- Response `200`: `SummarizationResponse`

```json
{
  "text": "Texto de entrada a resumir.",
  "model": null,
  "system_prompt": null,
  "information_to_extract": null,
  "entities_to_identify": null,
  "options": {"max_tokens": 4096, "temperature": null, "top_p": null, "seed": null, "stop": null}
}
```

`model` is inert on a single-model `llama-server`: the server serves whatever it
was launched with and reports its own id back. `system_prompt` overrides the
template in `resources/llm/summarization.yml`; `information_to_extract` and
`entities_to_identify` fill that template's placeholders instead of replacing it.

Response:

```json
{
  "document_id": "f2b25507-cf88-5b11-8f2a-c0b6f940b7f8",
  "summary": "## Resumen del documento\n...",
  "model": "qwen3-8b",
  "system_prompt": "Eres un asistente especializado ...",
  "options": {"max_tokens": 4096},
  "chunks_used": 3,
  "steps": [{"chunk_index": 0, "input_tokens": 3820, "source": "chunk"}],
  "config": {"model": "qwen3-8b", "system_prompt": "...", "options": {"max_tokens": 4096}}
}
```

```bash
curl -s -X POST "http://localhost:8899/api/llm/summarize?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Buenos Aires, 17 de noviembre de 2024. AUTOS Y VISTOS ..."}'
```

Common errors:
- `400` empty input text
- `422` the server's context window is too small for the prompt plus `max_tokens`
- `500` `LLAMACPP_BASE_URL` not configured
- `502` the LLM server is unreachable or errored

#### `POST /api/llm/summarize/stream`
Same request body and `use_cache` param; responds `text/event-stream`. On a cache
hit it replays the stored summary without calling the provider and without
touching stored validation.

Each frame is `data: {json}` with a `type` discriminator:

| `type` | Payload |
|---|---|
| `meta` | `{document_id, model, system_prompt, options}` — always first |
| `token` | `{chunk_index, source, text}` — incremental generated text |
| `summary` | `{summary, chunks_used, steps, model}` — terminal success; the row is persisted just before this frame |
| `error` | `{message}` — the model returned an empty completion; the stream ends |

```bash
curl -N -X POST http://localhost:8899/api/llm/summarize/stream \
  -H "Content-Type: application/json" \
  -d '{"text":"AUTOS Y VISTOS ..."}'
```

An empty `summary` usually means the model spent its whole `max_tokens` budget on
reasoning tokens; raise `max_tokens` or launch the server with `LLM_THINK_BUDGET=0`.

#### `GET /api/llm/summarize/validation/document/{document_id}`
- Path param: `document_id` (`UUID5`, the `text_to_uuid` of the source text)
- Response `200`: `SummarizationValidationResponse`
- Response `404`: no summary stored for that id

Returns the machine `summary` (markdown) **and** the human `validation` (TipTap
`JSONContent`, `null` until validated) side by side; the client picks which to
render. They are deliberately not collapsed.

```json
{
  "document_id": "f2b25507-cf88-5b11-8f2a-c0b6f940b7f8",
  "title": "Resolución 1234/2024",
  "text": "AUTOS Y VISTOS ...",
  "summary": "## Resumen del documento\n...",
  "validation": {"type": "doc", "content": []},
  "chunks_used": 3,
  "steps": [],
  "config": {"model": "qwen3-8b", "system_prompt": "...", "options": {}}
}
```

#### `POST /api/llm/summarize/validation/document/{document_id}`
- Request body: `{"title": "...", "validation": {...}}` — `title` is optional and a
  `null` title leaves the stored one untouched
- Response `200`: empty body
- Response `404`: no summary stored for that id

Stores the editor document verbatim. The machine-generated `summary` column is
never touched here.

### Transcription (ASR)

These routes proxy a [`coro`](https://github.com/collectiveai-team/coro) server
speaking the OpenAI-compatible audio API. They require `TRANSCRIBE_BASE_URL`;
without it they answer `500 Configuration error`. In compose, `coro` lives behind
the `asr` profile — see the [configuration reference](../configuration/README.md).

Cache identity is a hash of the **audio bytes**, so re-uploading the same file is
free.

#### `POST /api/asr/transcribe`
- Request: `multipart/form-data` with `file`
- Query param: `use_cache=true|false` (default `true`)
- Response `200`: `ASRDocument`

```json
{
  "document_id": "9b2f0e5c-8a1d-5f3e-b7c4-2d6a91e04f88",
  "title": "audiencia-2024-11-17.mp3",
  "document": [
    {
      "speaker_no": 0,
      "speaker_name": null,
      "start": "PT0S",
      "end": "PT12S",
      "text": "Buenos días, damos inicio a la audiencia.",
      "paragraph_id": "3f9c1a72-55de-5b60-9a11-7c0e8d2b4a63"
    }
  ],
  "speaker_turns": []
}
```

```bash
curl -s -X POST "http://localhost:8899/api/asr/transcribe?use_cache=true" \
  -F "file=@audiencia.mp3"
```

#### `POST /api/asr/transcribe/stream`
Same request and `use_cache` param; responds `text/event-stream`. On a cache hit
it emits `meta`, `segments`, `done` without calling `coro`.

| `type` | Payload |
|---|---|
| `meta` | `{document_id, duration}` — `duration` is `null` when it cannot be probed |
| `delta` | `{text, progress?}` — incremental text; `progress` is omitted when duration is unknown |
| `segments` | `{document}` — the final paragraph list |
| `done` | `{progress: 1.0}` — terminal success |
| `error` | `{detail}` — upstream or internal failure |

`progress` is an eased estimate derived from characters seen against expected
duration, not a figure reported by the ASR server. It approaches ~90% when the
character estimate thinks transcription is done and snaps to `1.0` on `done`.

#### `GET /api/asr/validation/document/{document_id}`
- Response `200`: `ASRDocument` — returns `validation` when non-empty, otherwise
  the machine `transcription`
- Response `404`: no transcription stored for that id

#### `POST /api/asr/validation/document/{document_id}`
- Request body: either `{"title": "...", "document": [ASRParagraphRequest]}` or a
  bare `[ASRParagraphRequest]` list (legacy form)
- Response `200`: empty body
- Response `404`: no transcription stored for that id

```bash
curl -s -X POST http://localhost:8899/api/asr/validation/document/9b2f0e5c-8a1d-5f3e-b7c4-2d6a91e04f88 \
  -H "Content-Type: application/json" \
  -d '{"title":"Audiencia 17/11","document":[{"speaker_no":0,"start":"00:00:00","end":"00:00:12","text":"Buenos días."}]}'
```

`start` and `end` accept `HH:MM:SS` strings or numeric seconds.

### Document Conversion

All conversion endpoints use `multipart/form-data` with a `file` field.

| Method | Path | Input | Output |
|---|---|---|---|
| `POST` | `/api/convert/pdf/odt` | `.pdf` | `.odt` |
| `POST` | `/api/convert/pdf/docx` | `.pdf` | `.docx` |
| `POST` | `/api/convert/docx/odt` | `.docx` | `.odt` |
| `POST` | `/api/convert/docx/pdf` | `.docx` | `.pdf` |
| `POST` | `/api/convert/odt/pdf` | `.odt` | `.pdf` |
| `POST` | `/api/convert/odt/docx` | `.odt` | `.docx` |

For PDF input endpoints, optional query param:
- `backend=libreoffice|pandoc` (default: `libreoffice`)

Example:

```bash
curl -X POST "http://localhost:8899/api/convert/pdf/docx?backend=libreoffice" \
  -F "file=@input.pdf" -o output.docx
```

Common errors:
- `400` unsupported input extension
- `500` conversion tool failure

## Legacy / Not Public (Not Mounted)
The following route modules exist in code but are not included in `core.router` at runtime:

- `aymurai/api/endpoints/routers/datapublic/dataset.py`
  - includes `/api/datapublic/dataset/*` CRUD/batch routes, but router is not mounted.
- `aymurai/api/endpoints/routers/anonymizer/database.py`
  - `/api/anonymizer/database/*` routes exist, but the module is never imported by `core.router`.
- `aymurai/api/endpoints/routers/database/*`
  - additional DB admin routes exist, but no mounting in `core.router`.

Treat these as legacy/internal code paths until explicitly exposed in the public router.
