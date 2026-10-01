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
| `POST` | `/api/asr/transcribe` | Transcribe un archivo de audio o video subido |
| `POST` | `/api/asr/transcribe/stream` | Igual, en streaming con server-sent events |
| `GET` | `/api/asr/validation/document/{document_id}` | Lee una transcripción guardada y su validación |
| `POST` | `/api/asr/validation/document/{document_id}` | Guarda la transcripción validada por la persona |
| `POST` | `/api/convert/pdf/odt` | Convierte PDF a ODT |
| `POST` | `/api/convert/pdf/docx` | Convierte PDF a DOCX |
| `POST` | `/api/convert/docx/odt` | Convierte DOCX a ODT |
| `POST` | `/api/convert/docx/pdf` | Convierte DOCX a PDF |
| `POST` | `/api/convert/odt/pdf` | Convierte ODT a PDF |
| `POST` | `/api/convert/odt/docx` | Convierte ODT a DOCX |
| `POST` | `/api/llm/data-extraction` | Corre (o reproduce cacheada) una extracción estructurada con LLM sobre un documento |
| `PUT` | `/api/llm/data-extraction/{document_id}/validate` | Persiste una recomendación validada por una persona |
| `GET` | `/api/llm/data-extraction/recommendations` | Listado paginado y filtrado de recomendaciones validadas |
| `GET` | `/api/llm/data-extraction/recommendations/{recommendation_id}` | Detalle de una recomendación validada |
| `GET` | `/api/llm/data-extraction/export` | Exporta todas las recomendaciones como `.xlsx` o `.csv` |
| `POST` `GET` `PATCH` `DELETE` | `/api/organigram/units[/{unit_id}]` | CRUD del árbol de unidades del organigrama |
| `GET` `POST` | `/api/organigram/units/{unit_id}/holders` | Historial de titulares de una unidad |
| `PATCH` | `/api/organigram/holders/{holder_id}` | Renombra un titular |
| `POST` `GET` `PATCH` `DELETE` | `/api/catalogs/topics[/{topic_id}]` | CRUD del catálogo de temas |
| `POST` `GET` `PATCH` `DELETE` | `/api/catalogs/subtopics[/{subtopic_id}]` | CRUD del catálogo de subtemas |
| `GET` `PATCH` `DELETE` | `/api/catalogs/macro_sectors[/{macro_sector_id}]` | Lista fija de macro-sectores (solo edición/desactivación) |

Las rutas bajo `/api/llm/*` y `/api/asr/*` hacen de proxy sobre servicios externos
(`llama-server` y `coro` respectivamente) y solo son usables una vez configurados.
Responden `500 Configuration error` cuando su base URL no está seteada.

Las rutas `/api/llm/data-extraction*`, `/api/organigram/*` y `/api/catalogs/*`
además están **gateadas por feature flag**: se montan solo cuando
`DEFENSORIA_ENABLED=true` (default `False`). Con el flag apagado, ninguna de
esas rutas existe (`404` plano, no un error de configuración). Ver
[Defensoría del Pueblo (gateada por feature flag)](#defensoría-del-pueblo-gateada-por-feature-flag)
más abajo y la [referencia de pipeline](../pipelines/defensoria/README.md).

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

La identidad de cache es un hash de los **bytes subidos**, así que volver a subir
el mismo archivo es gratis.

#### `POST /api/asr/transcribe`
- Request: `multipart/form-data` con `file`
- Acepta: audio (`.mp3`, `.wav`, `.m4a`, `.webm`, `.ogg`, `.flac`) y video
  (`.mp4`, `.mov`, `.mkv`, `.avi`, `.m4v`). El video se transcribe desde su pista
  de audio. El backend no impone whitelist — `coro` decodifica con ffmpeg — así que
  este es el conjunto que ofrece la aplicación, no un límite duro de la API.
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

## Defensoría del Pueblo (gateada por feature flag)

Customización para la Defensoría del Pueblo (CABA): una extracción
estructurada con LLM que reemplaza el flujo NER genérico para este
despliegue, más CRUD de administración para el organigrama institucional y
los catálogos de tema/subtema/macro-sector de los que depende. Montada solo
cuando `DEFENSORIA_ENABLED=true`. Ver la
[referencia de pipeline](../pipelines/defensoria/README.md) para el flujo
end-to-end completo y la
[referencia de base de datos](../database/README.md#defensoría-del-pueblo-caba)
para las tablas involucradas.

### Extracción de datos

#### `POST /api/llm/data-extraction`
- Query param: `use_cache=true|false` (default `true`)
- Body: `DataExtractionRequest`

```json
{
  "document": {
    "document": ["Buenos Aires, 17 de noviembre de 2024.", "Se recomienda ..."],
    "document_id": "7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc"
  },
  "model": null,
  "options": null
}
```

Se espera que `document_id` sea un `UUID5` que el cliente deriva
determinísticamente del texto del documento, así que reenviar el mismo
contenido es un cache hit.

- Respuesta `200`: `DataExtractionResponse`

```json
{
  "document_id": "7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc",
  "recommendation_number": "1234/24",
  "recommendation_date": "2024-11-17",
  "recipients": [
    {
      "name": "Juan Pérez",
      "position": "Director",
      "is_primary": true,
      "macro_sector": "GCBA",
      "unit_id": null,
      "unit_name": null,
      "sector_id": null,
      "sector_name": null,
      "match_method": null,
      "sector_candidates": [
        {
          "unit_id": "3fae2e6a-1111-4c22-9a3c-abcdefabcdef",
          "unit_name": "Ministerio de Salud",
          "sector_name": "Ministerio de Salud",
          "ruta_organigrama": "GCBA > Ministerio de Salud",
          "score": 92.5
        }
      ]
    }
  ],
  "topic": "SALUD",
  "subtopic": "Hospitales",
  "personal_data": false,
  "publishable_content": "Se recomienda ...",
  "config": {
    "model": "qwen3-8b",
    "options": {"max_tokens": 1024, "attempts": 1},
    "catalogs_hash": "a1b2c3..."
  }
}
```

`unit_id`/`sector_id` de cada destinatario son un match de organigrama
**vivo y no persistido** — ver
[matching de organigrama](../pipelines/defensoria/README.md#matching-de-organigrama).
`sector_candidates` siempre viene poblado con alternativas rankeadas, se
haya resuelto o no un match automático, para que una persona pueda elegir
otro al validar.

```bash
curl -s -X POST "http://localhost:8899/api/llm/data-extraction?use_cache=true" \
  -H "Content-Type: application/json" \
  -d '{"document":{"document":["Buenos Aires, 17 de noviembre de 2024.","Se recomienda ..."],"document_id":"7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc"}}'
```

Errores comunes:
- `422` documento demasiado grande para la ventana de contexto del modelo (`ContextTooSmallError`)
- `422` falla estándar de validación del body del request
- `500 Configuration error` cuando `LLAMACPP_BASE_URL` no está seteada

#### `PUT /api/llm/data-extraction/{document_id}/validate`
- Path param: `document_id` (`UUID`) — tiene que existir una extracción cacheada
- Body: `ValidateRecommendationRequest`

```json
{
  "recommendation_number": "1234/24",
  "recommendation_date_text": "17 de noviembre de 2024",
  "topic": "SALUD",
  "subtopic": "Hospitales",
  "personal_data": false,
  "publishable_content": "Se recomienda ...",
  "recipients": [
    {
      "id": null,
      "name": "Juan Pérez",
      "position": "Director",
      "is_primary": true,
      "macro_sector": "GCBA",
      "unit_id": "3fae2e6a-1111-4c22-9a3c-abcdefabcdef",
      "sector_id": "3fae2e6a-1111-4c22-9a3c-abcdefabcdef"
    }
  ]
}
```

El `id` de un destinatario está presente cuando se corrige uno existente y
ausente (`null`) al agregar uno nuevo; los destinatarios que faltan en la
lista se borran.

- Respuesta `200`: `RecommendationDetailResponse` (`RecommendationResponse` más `source_text` y la `prediction` cruda)

```bash
curl -s -X PUT http://localhost:8899/api/llm/data-extraction/7e6b6f35-2f29-58f7-9f8e-fd1d9026a6bc/validate \
  -H "Content-Type: application/json" \
  -d '{"publishable_content":"Se recomienda ...","recipients":[]}'
```

Errores comunes:
- `404 Resource not found` — todavía no hay una extracción cacheada para `document_id`
- `422` — `unit_id`/`sector_id` referencian una unidad de organigrama inexistente
  (`OrganigramReferenceNotFoundError`), o `sector_id` nombra una unidad que
  no es sector (`is_sector=false`), o es inconsistente con la posición de
  `unit_id` en el organigrama (`InconsistentSectorError`). El llamado entero
  es una sola transacción — un destinatario rechazado hace rollback de todos
  los demás campos también.

#### `GET /api/llm/data-extraction/recommendations`
- Query params (todos opcionales): `topic_id`, `sector_id` (`UUID`),
  `date_from`, `date_to` (inclusivos, sobre `recommendation_date`), `q`
  (búsqueda de substring insensible a mayúsculas sobre `publishable_content`
  — literal: `%`/`_` en `q` se escapan en vez de tratarse como wildcards de
  `LIKE` de SQL), `page` (default `1`), `page_size` (default `20`)
- Respuesta `200`: `RecommendationPageResponse`

```json
{"items": [ /* RecommendationResponse[] */ ], "total": 1, "page": 1, "page_size": 20}
```

```bash
curl -s "http://localhost:8899/api/llm/data-extraction/recommendations?topic_id=c1d2...&page=1&page_size=20"
```

#### `GET /api/llm/data-extraction/recommendations/{recommendation_id}`
- Respuesta `200`: `RecommendationDetailResponse`
- Respuesta `404`: `recommendation_id` desconocido

#### `GET /api/llm/data-extraction/export`
- Query param: `format=xlsx|csv` (default `xlsx`)
- Respuesta `200`: archivo binario (`recomendaciones.xlsx` con una segunda
  hoja `destinatarios`, o `recomendaciones.csv` con solo las filas de
  recomendaciones)
- El texto con forma de fórmula (una celda que empieza con `=`, `+`, `-`,
  `@`, tabulación o CR) nunca se exporta como fórmula activa. El `.xlsx` es el
  formato fiel: esas celdas se guardan como texto con su valor exacto. El
  `.csv` no tiene tipos de celda, así que esas celdas llevan una `'` adelante
  (recomendación de OWASP contra la inyección en CSV), lo que también se ve en
  texto legítimo como una viñeta `- `.

```bash
curl -s "http://localhost:8899/api/llm/data-extraction/export?format=xlsx" -o recomendaciones.xlsx
```

### Organigrama

#### `POST /api/organigram/units`
- Body: `OrganigramUnitCreateRequest`

```json
{"parent_id": null, "name": "Ministerio de Salud", "acronym": "MSAL", "short_name": "Salud", "is_sector": true, "order": 0}
```

- Respuesta `200`/`201`: `OrganigramUnitResponse`

```json
{
  "id": "3fae2e6a-1111-4c22-9a3c-abcdefabcdef",
  "parent_id": null,
  "name": "Ministerio de Salud",
  "acronym": "MSAL",
  "short_name": "Salud",
  "is_sector": true,
  "active": true,
  "order": 0,
  "created_at": "2024-11-17T12:00:00",
  "updated_at": null
}
```

#### `GET /api/organigram/units`
- Query params: `parent_id` (`UUID`, opcional — lista los hijos de esa
  unidad, o las raíces si se omite), `include_inactive` (default `false`),
  `flat` (default `false` — con `true`, devuelve todas las unidades en un
  solo llamado en vez de nivel por nivel, para clientes que renderizan,
  buscan y expanden el árbol entero)
- Respuesta `200`: `list[OrganigramUnitResponse]`

#### `GET /api/organigram/units/{unit_id}`
- Respuesta `200`: `OrganigramUnitResponse`; `404` si no existe

#### `PATCH /api/organigram/units/{unit_id}`
- Body: `OrganigramUnitUpdateRequest` (todos los campos opcionales, solo se aplican los enviados)
- Respuesta `200`: `OrganigramUnitResponse`; `404` si no existe

#### `DELETE /api/organigram/units/{unit_id}`
- Soft-delete (`active=false`); respuesta `200`; `404` si no existe

#### `GET /api/organigram/units/{unit_id}/holders`
- Respuesta `200`: `list[OrganigramHolderResponse]` (historial completo, más reciente primero)

#### `POST /api/organigram/units/{unit_id}/holders`
- Body: `OrganigramHolderCreateRequest`

```json
{"name": "María Gómez"}
```

- Asigna el nuevo titular actual (agrega una fila al historial); respuesta `200`: `OrganigramHolderResponse`

```json
{
  "id": "b2c3...uuid...",
  "unit_id": "3fae2e6a-1111-4c22-9a3c-abcdefabcdef",
  "name": "María Gómez",
  "is_current": true,
  "created_at": "2024-11-17T12:00:00",
  "updated_at": null
}
```

#### `PATCH /api/organigram/holders/{holder_id}`
- Body: `OrganigramHolderUpdateRequest` (`{"name": "..."}`)
- Respuesta `200`: `OrganigramHolderResponse`; `404` si no existe

### Catálogos

#### `POST /api/catalogs/topics`
- Body: `TopicCreateRequest`

```json
{"code": "SALUD", "name": "Salud", "order": 0}
```

- Respuesta `200`/`201`: `TopicResponse`; `409 Resource conflict` si el `code` ya existe

#### `GET /api/catalogs/topics`
- Query param: `include_inactive` (default `false`)
- Respuesta `200`: `list[TopicResponse]`

#### `GET /api/catalogs/topics/{topic_id}` / `PATCH` / `DELETE`
- Body de `PATCH`: `TopicUpdateRequest` (`code`, `name`, `active`, `order`, todos opcionales)
- `DELETE` hace soft-delete (`active=false`)
- `404` si no existe

#### `GET /api/catalogs/topics/{topic_id}/usage`
- Respuesta `200`: `{"count": <int>}` — registros que referencian este topic

#### `POST /api/catalogs/subtopics`
- Body: `SubtopicCreateRequest`

```json
{"topic_id": "c1d2...uuid...", "code": "HOSP", "name": "Hospitales", "order": 0}
```

- Respuesta `200`/`201`: `SubtopicResponse`; `409 Resource conflict` si el
  `code` ya existe globalmente, o si el `name` ya existe dentro del mismo
  `topic_id` (cada caso reporta un mensaje distinto, para que el cliente
  sepa qué campo cambiar)

#### `GET /api/catalogs/subtopics`
- Query params: `topic_id` (`UUID`, opcional), `include_inactive` (default `false`)
- Respuesta `200`: `list[SubtopicResponse]`

#### `GET /api/catalogs/subtopics/{subtopic_id}` / `PATCH` / `DELETE`
Misma forma que topics; `404` si no existe.

#### `GET /api/catalogs/subtopics/{subtopic_id}/usage`
- Respuesta `200`: `{"count": <int>}`

#### `POST /api/catalogs/subtopics/{subtopic_id}/reassign`
- Body: `{"target_subtopic_id": "<UUID>"}`
- Repunta cada registro referenciante al subtopic destino (usar antes de borrar uno)
- Respuesta `200`: `{"reassigned": <int>}`

#### `GET /api/catalogs/macro_sectors` / `GET .../{macro_sector_id}` / `PATCH` / `DELETE`
- Conjunto fijo de 4 filas sembradas (`GCBA`, `ORGANISMOS_NACIONALES`,
  `OBRA_SOCIAL_PREPAGA`, `EMPRESA`) — **sin endpoint de creación**, y `code`
  nunca es editable.
- Body de `PATCH`: `MacroSectorUpdateRequest` (`name`, `active`, `order`, todos opcionales)
- `DELETE` hace soft-delete (`active=false`)

```bash
curl -s http://localhost:8899/api/catalogs/macro_sectors
```

Errores comunes en los endpoints de catálogos:
- `404 Resource not found` — id desconocido
- `409 Resource conflict` — `code` duplicado al crear

## Legacy / no pública (no montada)
Las siguientes rutas existen en código pero no están incluidas en `core.router` en runtime:

- `aymurai/api/endpoints/routers/datapublic/dataset.py`
  - define `/api/datapublic/dataset/*`, pero ese router no está montado.
- `aymurai/api/endpoints/routers/anonymizer/database.py`
  - define `/api/anonymizer/database/*`, pero `core.router` nunca importa el módulo.
- `aymurai/api/endpoints/routers/database/*`
  - rutas administrativas de DB, sin montaje en `core.router`.

Estas rutas deben tratarse como caminos internos/legacy hasta su exposición explícita.
