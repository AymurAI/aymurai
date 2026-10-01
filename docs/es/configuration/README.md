# Configuración
Idioma: [English](../../configuration/README.md) | **Español**

Todas las perillas de runtime del backend, en un solo lugar. Los nombres son
insensibles a mayúsculas.

## De dónde salen los settings
La mayoría son campos del modelo `Settings` en `aymurai/settings.py`
(`pydantic-settings`). Al importarse, `load_env()` lee `.env` y luego — si `STAGE`
está seteada — `.env.<STAGE>` encima. Las variables de entorno ya presentes en el
proceso siempre ganan sobre ambos archivos.

Bajo Docker Compose, los servicios de la API además cargan `.env` y `.env.common`
vía `env_file`, y setean algunas variables inline por servicio.

Un puñado de variables se leen directamente con `os.getenv` fuera del módulo de
settings en lugar de pasar por `Settings`; están marcadas **(directa)** abajo y
listadas aparte en [Variables leídas fuera de `Settings`](#variables-leídas-fuera-de-settings).

## Server

| Variable | Default | Propósito |
|---|---|---|
| `API_HOST` | `0.0.0.0` | Dirección de bind del entrypoint `aymurai-api` |
| `API_PORT` | `8899` | Puerto de bind del mismo |
| `CORS_ORIGINS` | ver abajo | Lista separada por comas de orígenes permitidos |
| `ENV` | `None` | Marcador de entorno libre; el backend no ramifica sobre él |
| `STAGE` | sin setear | Si está seteada, se carga `.env.<STAGE>` encima de `.env` |
| `LOG_LEVEL` **(directa)** | `info` | Uno de `debug`, `info`, `warning`, `error` |

`CORS_ORIGINS` tiene como default
`http://localhost,https://localhost,http://localhost:8080,http://localhost:3000,0.0.0.0:8899,0.0.0.0:3000`
y se parte por comas.

> `CORS_ORIGINS` también tiene que permitir el origen de la app de escritorio:
> Chromium manda `Origin: null` cuando el renderer de Electron carga la página
> vía `file://`. Sin `null` en la lista permitida, la API responde sin (o, en
> un preflight, rechaza con 400 en vez de otorgar)
> `Access-Control-Allow-Origin` y el navegador bloquea la respuesta
> cross-origin **completa** — el pedido del cliente de escritorio falla como
> error de red y nunca ve el status, el body ni ningún header (incluido
> `Content-Disposition` para el nombre del archivo exportado). Con `null`
> permitido, los headers listados en `expose_headers` (hoy solo
> `Content-Disposition`) también se pueden leer.
>
> **Compromiso de seguridad.** `null` no es un origen privado: todo iframe con
> `sandbox`, URL `data:` y página de archivo local manda `Origin: null`
> también. Como la API está configurada con `allow_credentials=True`
> (`aymurai/api/main.py`, `CORSMiddleware`), permitir `null` deja que
> *cualquier* página web que visite el usuario embeba un iframe con `sandbox`
> que llame a la API local y lea sus respuestas — y la API local no tiene
> autenticación. Se permite hoy solo porque la app de Electron carga su UI vía
> `file://`; el arreglo previsto es servir el renderer desde un protocolo
> propio (por ejemplo `app://`) y permitir ese origen puntual en vez de
> `null`. Dejá `null` fuera de `CORS_ORIGINS` en cualquier deploy que no sea
> la app de escritorio.

> `LOG_LEVEL` se resuelve una sola vez al importar e indexa un mapa fijo. Un valor
> fuera de esas cuatro claves lanza `KeyError` en la primera llamada a
> `get_logger` en lugar de caer a un default.

## Rutas y almacenamiento

| Variable | Default | Propósito |
|---|---|---|
| `SQLALCHEMY_DATABASE_URI` | `sqlite:////resources/cache/sqlite/database.db` | URI de la base; Alembic migra a head al iniciar |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | Cuánto espera una escritura a otro escritor antes de "database is locked" |
| `RESOURCES_BASEPATH` | `/resources` | Raíz de recursos embebidos (pipelines, prompts, muestras) |
| `CACHE_BASEPATH` | `/resources/cache` | Raíz de cache de modelos/artefactos. También acepta `AYMURAI_CACHE_BASEPATH` |
| `FRONTEND_DIST_DIR` | `frontend-dist` | Directorio servido en `GET /`. También acepta `AYMURAI_FRONTEND_DIST_DIR` |
| `ALEMBIC_INI_PATH` | `<paquete>/alembic.ini` | Config de Alembic usada por la migración de arranque |
| `DISKCACHE_ROOT` **(directa)** | `/resources/cache/diskcache` | Cache en disco de resultados de pipeline |

Montá un volumen del host en `/resources/cache` para conservar la base y los
caches entre reinicios del container.

## Backups

### Variables que consume Compose, no la API
Configuran el servicio sidecar `db-backup` y nunca llegan al proceso de la API. Compose las sustituye en `docker-compose.yml` (`${BACKUP_RETENTION:-336}`, etc.) tomándolas primero del entorno del shell y después del archivo `.env` del directorio del proyecto; las entradas `env_file` no intervienen en esa sustitución. Dónde setearlas depende entonces de cómo se invoque Compose:
- **Vía `make`** (`make db-backup-up`, `make db-restore`, …): el Makefile hace `include .env` e `include .env.common` y `export` de cada variable nombrada en ellos, así que los valores de **cualquiera** de los dos archivos llegan a la interpolación de Compose (una variable presente en ambos toma el valor de `.env.common`, que se incluye último).
- **`docker compose …` directo**: solo se leen el entorno del shell y el `.env` del proyecto — un valor seteado solo en `.env.common` no tiene efecto.

| Variable | Default | Propósito |
|---|---|---|
| `BACKUP_SOURCE_DB` | `/resources/cache/sqlite/database.db` | Path a la base SQLite dentro del container `db-backup` |
| `BACKUP_DEST_DIR` | `/backups` | Dónde se escriben los backups fechados dentro del container |
| `BACKUP_INTERVAL_SECONDS` | `3600` | Segundos entre backups automáticos mientras el sidecar está corriendo (ver `make db-backup-up`); una corrida idéntica al último backup se saltea |
| `BACKUP_RETENTION` | `336` | Cuántos backups fechados conservar; `0` o negativo desactiva la poda. Con corridas horarias que solo escriben si hubo cambios, `336` cubre al menos 14 días de cambios ininterrumpidos y ~7 semanas de ediciones en horario laboral — ver [Respaldos automáticos](../database/README.md#respaldos-automáticos) |

## Inferencia

| Variable | Default | Propósito |
|---|---|---|
| `TORCH_NUM_THREADS` | `4` | Cantidad de threads intra-op de Torch |
| `MEMORY_CACHE_MAXSIZE` | `4` | Slots de cache en memoria de pipelines (hay 2 pipelines de producción) |
| `SENTENCE_ENCODER_TYPE` **(directa)** | `distiluse` | Encoder de oraciones: `distiluse` o `minilm`; un valor desconocido advierte y cae al default |
| `NO_DOWNLOAD_IF_EXISTS` **(directa)** | `True` | Evita volver a descargar artefactos de modelo ya presentes en disco |

> **No existe un setting `TORCH_DEVICE`.** `docker-compose.yml` setea una variable
> `TORCH_DEVICE` en los servicios de la API, pero ningún código la lee, y las dos
> configs de pipeline de producción tienen `"device": "cpu"` hardcodeado. Para
> correr un pipeline en GPU hay que editar los campos `device` en
> `resources/pipelines/production/*/pipeline.json`. Ver
> [el índice de pipelines](../pipelines/README.md).

## Anonimización

| Variable | Default | Propósito |
|---|---|---|
| `THRESHOLD` | `70` | Umbral de score de fuzzy matching para desambiguación de entidades |
| `DISAMBIGUATION_LABEL_POLICIES` | `aymurai/config/default_disambiguation_label_policies.yml` | Objeto JSON label -> `{anonymize, disambiguation, use_subclass_when_available}` |
| `RENDER_POLICY` | `{"suffix_mode": "auto", "suffix_threshold": 1}` | Objeto JSON que controla los sufijos de reemplazo |
| `LIBREOFFICE_BIN` | `libreoffice` | Binario usado para conversión de documentos |
| `PDF_WATERMARK_FONT_REGULAR` **(directa)** | `None` | Fuente regular de la marca de agua del PDF |
| `PDF_WATERMARK_FONT_BOLD` **(directa)** | `None` | Fuente bold de la marca de agua del PDF |
| `ANONYMIZATION_METADATA_CREATOR` | `AymurAI` | Metadato `creator` escrito en los PDF anonimizados |
| `ANONYMIZATION_METADATA_PRODUCER` | `AymurAI` | Metadato `producer` escrito en los PDF anonimizados |

Ambas variables de policy aceptan un string JSON y se parsean al cargar. Los
payloads de request pueden sobreescribirlas por llamada — ver
[`/api/anonymizer/disambiguate`](../api/README.md#post-apianonymizerdisambiguate).

## Sumarización con LLM

Las rutas `/api/llm/*` hablan con un `llama-server` vía la API compatible con
OpenAI. Sin `LLAMACPP_BASE_URL` responden `500 Configuration error`.

| Variable | Default | Propósito |
|---|---|---|
| `LLAMACPP_BASE_URL` | `None` | p. ej. `http://llamacpp:8080/v1`; requerida para sumarizar |
| `LLAMACPP_API_KEY` | `not-needed` | Se envía como bearer token; llama.cpp lo ignora por defecto |
| `LLM_DEFAULT_MAX_TOKENS` | `4096` | `max_tokens` por defecto cuando el request lo omite |
| `LLM_CHUNK_OVERLAP_TOKENS` | `128` | Solapamiento entre chunks en la sumarización rolling |
| `LLM_MAX_CONTEXT_TOKENS` | `None` | Tope opcional sobre la ventana de contexto del server. `None` usa el `n_ctx` del server tal cual |

`LLM_MAX_CONTEXT_TOKENS` solo puede bajar la ventana efectiva, nunca subirla:
`llama-server` fija `n_ctx` al iniciar con `-c`.

### Variables que consume Compose, no la API
Configuran el servicio `llamacpp` en sí y nunca llegan al proceso Python.

| Variable | Default | Propósito |
|---|---|---|
| `LLAMACPP_MODELS_DIR` | `~/.llama.cpp/models` | Directorio del host montado read-only en `/models` |
| `LLAMACPP_MODEL_FILE` | *(requerida)* | Nombre del GGUF dentro de ese directorio |
| `LLAMACPP_CTX_SIZE` | `16384` | Ventana de contexto del server (`-c`) |
| `LLM_REASONING` | `auto` | `on` / `off` / `auto`; se traduce a `LLAMA_ARG_REASONING` |
| `LLM_THINK_BUDGET` | `-1` | `-1` sin límite / `0` corte inmediato / `N` presupuesto de tokens; se traduce a `LLAMA_ARG_THINK_BUDGET` |

El razonamiento es un asunto **de arranque**: llama.cpp no tiene presupuesto de
thinking por request, y `enable_thinking` depende del modelo. Si los resúmenes
vuelven vacíos, el modelo está gastando todo su `max_tokens` en razonamiento —
subí `max_tokens` o poné `LLM_THINK_BUDGET=0`.

## Defensoría del Pueblo (extracción de datos)

Las rutas `/api/llm/data-extraction*`, `/api/organigram/*` y `/api/catalogs/*`
implementan la customización para la Defensoría del Pueblo (CABA) — ver la
[referencia de pipeline](../pipelines/defensoria/README.md). Comparten
`LLAMACPP_BASE_URL`/`LLAMACPP_API_KEY` con la sumarización con LLM.

| Variable | Default | Propósito |
|---|---|---|
| `DEFENSORIA_ENABLED` | `False` | Monta los tres routers de arriba cuando es `true`. Tablas/migraciones/seeds siempre corren, sin importar el valor |
| `DATA_EXTRACTION_MAX_TOKENS` | `1024` | `max_tokens` para el llamado de extracción |
| `DATA_EXTRACTION_MAX_RETRIES` | `2` | Intentos extra ante salida JSON/schema inválida (3 intentos en total) |
| `DATA_EXTRACTION_SEARCH_BACKEND` | `hybrid` | Scorer del matching de organigrama: `fuzzy`, `embeddings` o `hybrid` |
| `DATA_EXTRACTION_TOP_K` | `5` | Sectores alternativos rankeados devueltos por destinatario (`sector_candidates`) |
| `DATA_EXTRACTION_HYBRID_WEIGHT` | `0.25` | Peso del score de embeddings en modo `hybrid`; fuzzy se queda con el resto |
| `DATA_EXTRACTION_NAME_EVIDENCE_WEIGHT` | `1.0` | Descuento aplicado a un match por nombre de titular antes de compararlo con su umbral |
| `DATA_EXTRACTION_NAME_SCORE_THRESHOLD` | `90` | Score mínimo para que un match por nombre de titular resuelva un destinatario |
| `DATA_EXTRACTION_POSITION_SCORE_THRESHOLD` | `85` | Score mínimo para que un match de cargo/posición resuelva un destinatario |
| `EXPORT_TIMEZONE` | `America/Argentina/Buenos_Aires` | Zona horaria en la que el export `.xlsx`/`.csv` formatea timestamps naive-UTC |

El matching de organigrama solo corre para destinatarios cuyo macro-sector es
`GCBA`; cualquier otro macro-sector corta directo a "sin match" sin importar
estos umbrales. Ver
[matching de organigrama](../pipelines/defensoria/README.md#matching-de-organigrama)
para el orden de resolución completo.

## Transcripción ASR

Las rutas `/api/asr/*` hacen de proxy sobre un server
[`coro`](https://github.com/collectiveai-team/coro). Sin `TRANSCRIBE_BASE_URL`
responden `500 Configuration error`.

| Variable | Default | Propósito |
|---|---|---|
| `TRANSCRIBE_BASE_URL` | `None` | p. ej. `http://coro:8000/v1`; requerida para transcribir |
| `TRANSCRIBE_API_KEY` | `not-needed` | Se envía como bearer token |

### Variables que consume Compose, no la API

| Variable | Default | Propósito |
|---|---|---|
| `CORO_VERSION` | `1.0.5` | Tag de imagen de los servicios `coro` / `coro-gpu` |
| `CORO_BACKEND_ASR` | `onnx-asr` | Backend de ASR del servicio CPU |
| `CORO_MODEL_ASR` | `nemo-canary-1b-v2` | Modelo de ASR del servicio CPU |
| `CORO_BACKEND_ASR_GPU` | `faster-whisper` | Backend de ASR del servicio GPU |
| `CORO_MODEL_ASR_GPU` | `openai/whisper-medium` | Modelo de ASR del servicio GPU |
| `CORO_BACKEND_DIARIZATION` | `nemo` | Backend de diarización de ambos |

`coro` vive detrás del perfil `asr` de compose, así que no arranca con un
`docker compose up` pelado. Usá los targets del Makefile:

```bash
make coro-up      # o CORO_SERVICE=coro-gpu make coro-up
make coro-logs
```

## Variables de terceros
Definidas en `.env.common` y respetadas por las librerías mismas, no por AymurAI:

| Variable | Valor en `.env.common` | La lee |
|---|---|---|
| `HF_HOME` | `/resources/cache/huggingface` | `huggingface_hub` |
| `TOKENIZERS_PARALLELISM` | `1` | `tokenizers` |
| `CACHE_PATH` | `/resources/cache` | Nada en este repo — queda por conveniencia de compose/tooling |

## Elegir servicios desde el Makefile
El Makefile decide sobre qué servicio de compose actúan sus targets:

| Variable | Default | Alternativas |
|---|---|---|
| `API_SERVICE` | `aymurai-api` | `aymurai-api-gpu` |
| `API_FULL_SERVICE` | `aymurai-api-full` | `aymurai-api-full-gpu` |
| `CORO_SERVICE` | `coro` | `coro-gpu` |

```bash
API_SERVICE=aymurai-api-gpu make api-up
```

## Variables leídas fuera de `Settings`
Estas esquivan el módulo de settings y se leen con `os.getenv` donde se usan. Por
eso están ausentes de `Settings`, no se pueden sobreescribir por stage de la
manera habitual, y se evalúan al importar:

| Variable | Se lee en |
|---|---|
| `STAGE` | `aymurai/settings.py` |
| `LOG_LEVEL` | `aymurai/logger/logger.py` |
| `DISKCACHE_ROOT` | `aymurai/utils/cache.py` |
| `SENTENCE_ENCODER_TYPE` | `aymurai/models/sentence_encoder/factory.py` |
| `NO_DOWNLOAD_IF_EXISTS` | `aymurai/utils/download.py` |
| `PDF_WATERMARK_FONT_REGULAR`, `PDF_WATERMARK_FONT_BOLD` | `aymurai/text/anonymization/pdf/watermark.py` (el env tiene precedencia sobre el campo homónimo de `Settings`) |

## Sobre `.env.schema`
El `.env.schema` de la raíz lo generó `varlock init`, que escaneó las dependencias
instaladas y emitió varios cientos de variables de PyTorch, Jupyter y
herramientas de build que AymurAI nunca lee. Todavía contiene el placeholder
`EXAMPLE_ITEM="delete me!"`. **No lo trates como el contrato de configuración** —
esta página lo es. Arrancá desde `.env.common` y agregá solo lo que necesites.

## Documentos relacionados
- Índice de documentación: [../README.md](../README.md)
- Referencia de API: [../api/README.md](../api/README.md)
- Base de datos interna: [../database/README.md](../database/README.md)
- Índice de pipelines: [../pipelines/README.md](../pipelines/README.md)
