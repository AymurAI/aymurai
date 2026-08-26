# Referencia de API
Idioma: [English](../../api/README.md) | **Español**

Este documento describe la API pública actualmente montada en `aymurai/api/main.py` + `aymurai/api/core.py`.

## Base URL y OpenAPI
- Base local: `http://localhost:8899`
- Swagger UI: `http://localhost:8899/api/docs`
- OpenAPI JSON: `http://localhost:8899/api/openapi.json`

## Endpoints públicos (montados)

| Método | Path | Propósito |
|---|---|---|
| `GET` | `/api/server/healthcheck` | Liveness del servicio |
| `GET` | `/api/server/stats/summary` | Métricas de CPU/memoria |
| `POST` | `/api/document-extract` | Alias deprecado de `/api/misc/document-extract` |
| `POST` | `/api/misc/document-extract` | Extrae párrafos normalizados de un documento |
| `POST` | `/api/anonymizer/predict` | Predicción NER por párrafo |
| `POST` | `/api/anonymizer/disambiguate` | Desambiguación canónica + merge de políticas |
| `POST` | `/api/anonymizer/validation` | Obtiene validación manual por párrafo |
| `POST` | `/api/anonymizer/anonymize-document` | Compila y exporta documento anonimizado |
| `POST` | `/api/datapublic/predict/{document_id}` | Predicción para flujo data-public |
| `GET` | `/api/datapublic/validation/document/{document_id}` | Lee validación a nivel documento |
| `POST` | `/api/datapublic/validation/document/{document_id}` | Guarda validación a nivel documento |
| `POST` | `/api/llm/summarize` | Resume un documento vía el backend de LLM |
| `POST` | `/api/llm/summarize/stream` | Igual, en streaming con server-sent events |
| `GET` | `/api/llm/summarize/validation/document/{document_id}` | Lee un resumen guardado y su validación humana |
| `POST` | `/api/llm/summarize/validation/document/{document_id}` | Guarda el resumen validado por la persona |
| `POST` | `/api/asr/transcribe` | Transcribe un archivo de audio subido |
| `POST` | `/api/asr/transcribe/stream` | Igual, en streaming con server-sent events |
| `GET` | `/api/asr/validation/document/{document_id}` | Lee una transcripción guardada y su validación |
| `POST` | `/api/asr/validation/document/{document_id}` | Guarda la transcripción validada por la persona |
| `POST` | `/api/convert/pdf/odt` | Convierte PDF a ODT |
| `POST` | `/api/convert/pdf/docx` | Convierte PDF a DOCX |
| `POST` | `/api/convert/docx/odt` | Convierte DOCX a ODT |
| `POST` | `/api/convert/docx/pdf` | Convierte DOCX a PDF |
| `POST` | `/api/convert/odt/pdf` | Convierte ODT a PDF |
| `POST` | `/api/convert/odt/docx` | Convierte ODT a DOCX |

Las rutas bajo `/api/llm/*` y `/api/asr/*` hacen de proxy sobre servicios externos
(`llama-server` y `coro` respectivamente) y solo son usables una vez configurados.
Responden `500 Configuration error` cuando su base URL no está seteada.

## Contratos de datos principales

Nota: los snippets JSON de abajo son ejemplos mínimos válidos. Los payloads reales pueden incluir campos adicionales según el endpoint y la etapa de procesamiento.

### `TextRequest`
```json
{
  "text": "Acusado: Ramiro Marrón DNI 34.555.666."
}
```

### `EntityAttributes` (campos relevantes)
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

## Detalle de endpoints y ejemplos

### Server

#### `GET /api/server/healthcheck`
- Respuesta `200`:

```json
{"status": "ok"}
```

```bash
curl -s http://localhost:8899/api/server/healthcheck
```

#### `GET /api/server/stats/summary`
- Respuesta `200` (forma):

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

### Extracción de documentos

#### `POST /api/misc/document-extract`
#### `POST /api/document-extract` (alias deprecado)
- Request: `multipart/form-data` con `file`
- Formatos de entrada aceptados: DOCX, PDF
- El extractor todavía parsea ODT, pero el formato está **deprecado** como
  entrada: la aplicación rechaza los `.odt`, así que no conviene depender de él.
- Respuesta `200`:

```json
{
  "document": ["Párrafo 1", "Párrafo 2"],
  "document_id": "f2b25507-cf88-5b11-8f2a-c0b6f940b7f8"
}
```

```bash
curl -s -X POST \
  -F "file=@/resources/data/sample/document-01.docx" \
  http://localhost:8899/api/misc/document-extract
```

Errores comunes:
- `504` timeout de extracción
- `500` errores del extractor/internos

### Anonymizer

#### `POST /api/anonymizer/predict`
- Body: `TextRequest`
- Query param: `use_cache=true|false` (default `true`)
- Respuesta `200`: `DocumentInformation`

```bash
curl -s -X POST "http://localhost:8899/api/anonymizer/predict?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Acusado: Ramiro Marrón DNI 34.555.666."}'
```

#### `POST /api/anonymizer/disambiguate`
- Body request:

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

- Respuesta `200`: `DocumentAnnotations` (incluye `data` y `label_policies` efectivas)

```bash
curl -s -X POST http://localhost:8899/api/anonymizer/disambiguate \
  -H "Content-Type: application/json" \
  -d '{"paragraphs":[{"document":"Acusado: Ramiro Marrón DNI 34.555.666.","labels":[]}],"label_policies":{"PER":{"anonymize":true,"disambiguation":"fuzzy"}}}'
```

#### `POST /api/anonymizer/validation`
- Body: `TextRequest`
- Respuesta `200`: `list[DocLabel] | null`

```bash
curl -s -X POST http://localhost:8899/api/anonymizer/validation \
  -H "Content-Type: application/json" \
  -d '{"text":"Acusado: Ramiro Marrón DNI 34.555.666."}'
```

#### `POST /api/anonymizer/anonymize-document`
- Request: `multipart/form-data`
  - `file`: documento original (`.docx` o `.pdf`)
  - `annotations`: string JSON serializado de `DocumentAnnotations`
- Respuesta `200`: `.odt` anonimizado para entrada DOCX o `.pdf` anonimizado para entrada PDF

```bash
curl -X POST http://localhost:8899/api/anonymizer/anonymize-document \
  -F "file=@/resources/data/sample/document-01.docx" \
  -F 'annotations={"data":[{"document":"Acusado: Ramiro Marrón DNI 34.555.666.","labels":[]}],"label_policies":{"PER":{"anonymize":true,"disambiguation":"fuzzy"}},"render_policy":{"suffix_mode":"auto","suffix_threshold":1}}'
```

Errores comunes:
- `400` payload multipart inválido, formato no soportado o documento inválido
- `500` errores de anonimización/conversión

### Data-Public

#### `POST /api/datapublic/predict/{document_id}`
- Path param: `document_id` (`UUID5`)
- Body: `TextRequest`
- Query param: `use_cache=true|false` (default `true`)
- Respuesta `200`: `DocumentInformation`

```bash
curl -s -X POST "http://localhost:8899/api/datapublic/predict/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"text":"Buenos Aires, 17 de noviembre de 2024"}'
```

#### `GET /api/datapublic/validation/document/{document_id}`
- Respuesta `200`: objeto o `null`
- Respuesta `404`: documento inexistente

```bash
curl -s http://localhost:8899/api/datapublic/validation/document/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc
```

#### `POST /api/datapublic/validation/document/{document_id}`
- Body: objeto JSON libre (se persiste como validación a nivel documento)
- Respuesta `200`: body vacío

```bash
curl -s -X POST http://localhost:8899/api/datapublic/validation/document/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc \
  -H "Content-Type: application/json" \
  -d '{"materia":"penal","violencia_de_genero":"si"}'
```

### Sumarización (LLM)

Estas rutas necesitan un `llama-server` corriendo; ver la sección de backend de
LLM en el [README del repositorio](../../../README.es.md) y la
[referencia de configuración](../configuration/README.md). Si `LLAMACPP_BASE_URL`
no está seteada, responden `500 Configuration error`.

La identidad de cache es **solo el texto fuente** — la config de generación nunca
se compara. Por eso regenerar requiere `use_cache=false` explícito, y hacerlo
borra cualquier validación humana almacenada.

#### `POST /api/llm/summarize`
- Body: `SummarizationRequest`
- Query param: `use_cache=true|false` (default `true`)
- Respuesta `200`: `SummarizationResponse`

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

`model` es inerte en un `llama-server` de un solo modelo: el server sirve aquello
con lo que fue lanzado e informa su propio id. `system_prompt` reemplaza el
template de `resources/llm/summarization.yml`; `information_to_extract` y
`entities_to_identify` completan los placeholders de ese template en lugar de
reemplazarlo.

Respuesta:

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

Errores comunes:
- `400` texto de entrada vacío
- `422` la ventana de contexto del server no alcanza para el prompt más `max_tokens`
- `500` `LLAMACPP_BASE_URL` sin configurar
- `502` el server de LLM está inalcanzable o falló

#### `POST /api/llm/summarize/stream`
Mismo body y mismo `use_cache`; responde `text/event-stream`. Ante un hit de cache
reproduce el resumen almacenado sin llamar al proveedor y sin tocar la validación.

Cada frame es `data: {json}` con un discriminador `type`:

| `type` | Payload |
|---|---|
| `meta` | `{document_id, model, system_prompt, options}` — siempre primero |
| `token` | `{chunk_index, source, text}` — texto generado incremental |
| `summary` | `{summary, chunks_used, steps, model}` — éxito terminal; la fila se persiste justo antes de este frame |
| `error` | `{message}` — el modelo devolvió una completion vacía; el stream termina |

```bash
curl -N -X POST http://localhost:8899/api/llm/summarize/stream \
  -H "Content-Type: application/json" \
  -d '{"text":"AUTOS Y VISTOS ..."}'
```

Un `summary` vacío suele significar que el modelo gastó todo su presupuesto de
`max_tokens` en tokens de razonamiento; subí `max_tokens` o lanzá el server con
`LLM_THINK_BUDGET=0`.

#### `GET /api/llm/summarize/validation/document/{document_id}`
- Path param: `document_id` (`UUID5`, el `text_to_uuid` del texto fuente)
- Respuesta `200`: `SummarizationValidationResponse`
- Respuesta `404`: no hay resumen almacenado para ese id

Devuelve el `summary` del modelo (markdown) **y** la `validation` humana
(`JSONContent` de TipTap, `null` hasta validarse) lado a lado; el cliente elige
cuál renderizar. Deliberadamente no se colapsan.

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
- Body: `{"title": "...", "validation": {...}}` — `title` es opcional y un `title`
  nulo deja intacto el almacenado
- Respuesta `200`: body vacío
- Respuesta `404`: no hay resumen almacenado para ese id

Guarda el documento del editor tal cual. Acá nunca se toca la columna `summary`.

### Transcripción (ASR)

Estas rutas actúan de proxy sobre un server [`coro`](https://github.com/collectiveai-team/coro)
que habla la API de audio compatible con OpenAI. Requieren `TRANSCRIBE_BASE_URL`;
sin eso responden `500 Configuration error`. En compose, `coro` vive detrás del
perfil `asr` — ver la [referencia de configuración](../configuration/README.md).

La identidad de cache es un hash de los **bytes del audio**, así que volver a
subir el mismo archivo es gratis.

#### `POST /api/asr/transcribe`
- Request: `multipart/form-data` con `file`
- Query param: `use_cache=true|false` (default `true`)
- Respuesta `200`: `ASRDocument`

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
Mismo request y mismo `use_cache`; responde `text/event-stream`. Ante un hit de
cache emite `meta`, `segments`, `done` sin llamar a `coro`.

| `type` | Payload |
|---|---|
| `meta` | `{document_id, duration}` — `duration` es `null` si no se puede sondear |
| `delta` | `{text, progress?}` — texto incremental; `progress` se omite si no hay duración |
| `segments` | `{document}` — la lista final de párrafos |
| `done` | `{progress: 1.0}` — éxito terminal |
| `error` | `{detail}` — falla upstream o interna |

`progress` es una estimación suavizada derivada de los caracteres vistos contra la
duración esperada, no un valor informado por el server de ASR. Se acerca al ~90%
cuando la estimación por caracteres cree que terminó, y salta a `1.0` en `done`.

#### `GET /api/asr/validation/document/{document_id}`
- Respuesta `200`: `ASRDocument` — devuelve `validation` cuando no está vacía, y
  la `transcription` del modelo en caso contrario
- Respuesta `404`: no hay transcripción almacenada para ese id

#### `POST /api/asr/validation/document/{document_id}`
- Body: o bien `{"title": "...", "document": [ASRParagraphRequest]}`, o bien una
  lista `[ASRParagraphRequest]` pelada (forma legacy)
- Respuesta `200`: body vacío
- Respuesta `404`: no hay transcripción almacenada para ese id

```bash
curl -s -X POST http://localhost:8899/api/asr/validation/document/9b2f0e5c-8a1d-5f3e-b7c4-2d6a91e04f88 \
  -H "Content-Type: application/json" \
  -d '{"title":"Audiencia 17/11","document":[{"speaker_no":0,"start":"00:00:00","end":"00:00:12","text":"Buenos días."}]}'
```

`start` y `end` aceptan strings `HH:MM:SS` o segundos numéricos.

### Conversión de documentos

Todos los endpoints de conversión usan `multipart/form-data` con campo `file`.

| Método | Path | Input | Output |
|---|---|---|---|
| `POST` | `/api/convert/pdf/odt` | `.pdf` | `.odt` |
| `POST` | `/api/convert/pdf/docx` | `.pdf` | `.docx` |
| `POST` | `/api/convert/docx/odt` | `.docx` | `.odt` |
| `POST` | `/api/convert/docx/pdf` | `.docx` | `.pdf` |
| `POST` | `/api/convert/odt/pdf` | `.odt` | `.pdf` |
| `POST` | `/api/convert/odt/docx` | `.odt` | `.docx` |

Para endpoints con input PDF, query param opcional:
- `backend=libreoffice|pandoc` (default: `libreoffice`)

Ejemplo:

```bash
curl -X POST "http://localhost:8899/api/convert/pdf/docx?backend=libreoffice" \
  -F "file=@input.pdf" -o output.docx
```

Errores comunes:
- `400` extensión de entrada no soportada
- `500` falla de herramienta de conversión

## Legacy / no pública (no montada)
Las siguientes rutas existen en código pero no están incluidas en `core.router` en runtime:

- `aymurai/api/endpoints/routers/datapublic/dataset.py`
  - define `/api/datapublic/dataset/*`, pero ese router no está montado.
- `aymurai/api/endpoints/routers/anonymizer/database.py`
  - define `/api/anonymizer/database/*`, pero `core.router` nunca importa el módulo.
- `aymurai/api/endpoints/routers/database/*`
  - rutas administrativas de DB, sin montaje en `core.router`.

Estas rutas deben tratarse como caminos internos/legacy hasta su exposición explícita.
