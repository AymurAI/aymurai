# Configuration
Language: **English** | [Español](../es/configuration/README.md)

Every runtime knob the backend reads, in one place. Names are case-insensitive.

## Where settings come from
Most settings are fields on the `Settings` model in `aymurai/settings.py`
(`pydantic-settings`). At import time `load_env()` reads `.env`, then — when
`STAGE` is set — `.env.<STAGE>` on top of it. Environment variables already
present in the process always win over both files.

Under Docker Compose the API services additionally load `.env` and `.env.common`
through `env_file`, and set a few variables inline per service.

A handful of variables are read directly with `os.getenv` outside the settings
module rather than through `Settings`; they are marked **(direct)** below and
listed separately in [Variables read outside `Settings`](#variables-read-outside-settings).

## Server

| Variable | Default | Purpose |
|---|---|---|
| `API_HOST` | `0.0.0.0` | Bind address for the `aymurai-api` console entrypoint |
| `API_PORT` | `8899` | Bind port for the same |
| `CORS_ORIGINS` | see below | Comma-separated list of allowed origins |
| `ENV` | `None` | Free-form environment marker; not branched on by the backend |
| `STAGE` | unset | When set, `.env.<STAGE>` is loaded on top of `.env` |
| `LOG_LEVEL` **(direct)** | `info` | One of `debug`, `info`, `warning`, `error` |

`CORS_ORIGINS` defaults to
`http://localhost,https://localhost,http://localhost:8080,http://localhost:3000,0.0.0.0:8899,0.0.0.0:3000`
and is split on commas.

> `CORS_ORIGINS` must also permit the desktop app's origin: Chromium sends
> `Origin: null` when the Electron renderer loads a page via `file://`. Without
> `null` in the allow-list, the API answers without (or, for a preflight,
> rejects with 400 instead of granting) `Access-Control-Allow-Origin`, and the
> browser blocks the **whole** cross-origin response — the desktop client's
> request fails as a network error and it never sees the status, the body or
> any header (including `Content-Disposition` for the export filename). With `null` allowed, the
> headers listed in `expose_headers` (today only `Content-Disposition`) are
> readable too.
>
> **Security trade-off.** `null` is not a private origin: every sandboxed
> iframe, `data:` URL and local file page sends `Origin: null` too. Because the
> API is configured with `allow_credentials=True`
> (`aymurai/api/main.py`, `CORSMiddleware`), allowing `null` lets *any* web
> page the user visits embed a sandboxed iframe that calls the local API and
> reads its responses — and the local API has no authentication. It is
> allowed today only because the Electron app loads its UI via `file://`; the
> planned fix is to serve the renderer from a custom protocol (e.g. `app://`)
> and allow that specific origin instead of `null`. Leave `null` out of
> `CORS_ORIGINS` on any deployment that is not the desktop app.

> `LOG_LEVEL` is looked up once at import time and indexes a fixed map. A value
> outside the four listed keys raises `KeyError` on the first `get_logger` call
> rather than falling back.

## Paths and storage

| Variable | Default | Purpose |
|---|---|---|
| `SQLALCHEMY_DATABASE_URI` | `sqlite:////resources/cache/sqlite/database.db` | Database URI; Alembic migrates it to head on startup |
| `SQLITE_BUSY_TIMEOUT_MS` | `5000` | How long a write waits for another writer before "database is locked" |
| `RESOURCES_BASEPATH` | `/resources` | Root for bundled resources (pipelines, prompts, samples) |
| `CACHE_BASEPATH` | `/resources/cache` | Model/artifact cache root. Also accepts `AYMURAI_CACHE_BASEPATH` |
| `FRONTEND_DIST_DIR` | `frontend-dist` | Directory served at `GET /`. Also accepts `AYMURAI_FRONTEND_DIST_DIR` |
| `ALEMBIC_INI_PATH` | `<package>/alembic.ini` | Alembic config used by the startup migration |
| `DISKCACHE_ROOT` **(direct)** | `/resources/cache/diskcache` | On-disk cache for pipeline results |

Mount a host volume at `/resources/cache` to keep the database and caches across
container restarts.

## Backups

### Variables consumed by Compose, not by the API
These configure the `db-backup` sidecar service and never reach the API process. Compose substitutes them into `docker-compose.yml` (`${BACKUP_RETENTION:-336}` etc.) from the shell environment first, then from the `.env` file in the project directory; `env_file` entries play no part in that substitution. Where you set them therefore depends on how you invoke Compose:
- **Through `make`** (`make db-backup-up`, `make db-restore`, …): the Makefile does `include .env` and `include .env.common` and `export`s every variable named in them, so values from **either** file reach Compose interpolation (a variable in both takes the `.env.common` value, which is included last).
- **Plain `docker compose …`**: only the shell environment and the project `.env` are read — a value set only in `.env.common` has no effect.

| Variable | Default | Purpose |
|---|---|---|
| `BACKUP_SOURCE_DB` | `/resources/cache/sqlite/database.db` | Path to the SQLite database inside the `db-backup` container |
| `BACKUP_DEST_DIR` | `/backups` | Where dated backup files are written inside the container |
| `BACKUP_INTERVAL_SECONDS` | `3600` | Seconds between automatic backups when the sidecar is running (see `make db-backup-up`); a run identical to the latest backup is skipped |
| `BACKUP_RETENTION` | `336` | How many dated backups to keep; `0` or negative disables pruning. With hourly runs that only write on change, `336` spans at least 14 days of non-stop changes and ~7 weeks of working-hours edits — see [Automatic backups](../database/README.md#automatic-backups) |

## Inference

| Variable | Default | Purpose |
|---|---|---|
| `TORCH_NUM_THREADS` | `4` | Torch intra-op thread count |
| `MEMORY_CACHE_MAXSIZE` | `4` | In-memory pipeline cache slots (there are 2 production pipelines) |
| `SENTENCE_ENCODER_TYPE` **(direct)** | `distiluse` | Sentence encoder: `distiluse` or `minilm`; an unknown value warns and falls back |
| `NO_DOWNLOAD_IF_EXISTS` **(direct)** | `True` | Skip re-downloading model artifacts that are already on disk |

> **There is no `TORCH_DEVICE` setting.** `docker-compose.yml` sets a
> `TORCH_DEVICE` variable on the API services, but no code reads it, and both
> production pipeline configs hardcode `"device": "cpu"`. To run a pipeline on
> GPU you must edit the `device` fields in
> `resources/pipelines/production/*/pipeline.json`. See
> [the pipelines index](../pipelines/README.md).

## Anonymization

| Variable | Default | Purpose |
|---|---|---|
| `THRESHOLD` | `70` | Fuzzy-matching score threshold for entity disambiguation |
| `DISAMBIGUATION_LABEL_POLICIES` | `aymurai/config/default_disambiguation_label_policies.yml` | JSON object mapping label -> `{anonymize, disambiguation, use_subclass_when_available}` |
| `RENDER_POLICY` | `{"suffix_mode": "auto", "suffix_threshold": 1}` | JSON object controlling replacement suffixes |
| `LIBREOFFICE_BIN` | `libreoffice` | Binary used for document conversion |
| `PDF_WATERMARK_FONT_REGULAR` **(direct)** | `None` | Regular font for the PDF watermark |
| `PDF_WATERMARK_FONT_BOLD` **(direct)** | `None` | Bold font for the PDF watermark |
| `ANONYMIZATION_METADATA_CREATOR` | `AymurAI` | `creator` metadata written to anonymized PDFs |
| `ANONYMIZATION_METADATA_PRODUCER` | `AymurAI` | `producer` metadata written to anonymized PDFs |

Both policy variables accept a JSON string and are parsed at load time. Request
payloads may override them per call — see
[`/api/anonymizer/disambiguate`](../api/README.md#post-apianonymizerdisambiguate).

## LLM summarization

The `/api/llm/*` routes talk to a `llama-server` over the OpenAI-compatible API.
Without `LLAMACPP_BASE_URL` they answer `500 Configuration error`.

| Variable | Default | Purpose |
|---|---|---|
| `LLAMACPP_BASE_URL` | `None` | e.g. `http://llamacpp:8080/v1`; required for summarization |
| `LLAMACPP_API_KEY` | `not-needed` | Sent as the bearer token; llama.cpp ignores it by default |
| `LLM_DEFAULT_MAX_TOKENS` | `4096` | Default `max_tokens` when the request omits it |
| `LLM_CHUNK_OVERLAP_TOKENS` | `128` | Overlap between chunks during rolling summarization |
| `LLM_MAX_CONTEXT_TOKENS` | `None` | Optional cap on the server's context window. `None` uses the server's `n_ctx` as-is |

`LLM_MAX_CONTEXT_TOKENS` can only lower the effective window, never raise it:
`llama-server` fixes `n_ctx` at launch with `-c`.

### Variables consumed by Compose, not by the API
These configure the `llamacpp` service itself and never reach the Python process.

| Variable | Default | Purpose |
|---|---|---|
| `LLAMACPP_MODELS_DIR` | `~/.llama.cpp/models` | Host directory mounted read-only at `/models` |
| `LLAMACPP_MODEL_FILE` | *(required)* | GGUF filename inside that directory |
| `LLAMACPP_CTX_SIZE` | `16384` | Server context window (`-c`) |
| `LLM_REASONING` | `auto` | `on` / `off` / `auto`; becomes `LLAMA_ARG_REASONING` |
| `LLM_THINK_BUDGET` | `-1` | `-1` unrestricted / `0` immediate end / `N` token budget; becomes `LLAMA_ARG_THINK_BUDGET` |

Reasoning is a **launch-time** concern: llama.cpp has no per-request thinking
budget, and `enable_thinking` is model-dependent. If summaries come back empty,
the model is spending its whole `max_tokens` on reasoning — raise `max_tokens`
or set `LLM_THINK_BUDGET=0`.

## Defensoría del Pueblo (data extraction)

The `/api/llm/data-extraction*`, `/api/organigram/*`, and `/api/catalogs/*`
routes implement the Defensoría del Pueblo (CABA) customization — see the
[pipeline reference](../pipelines/defensoria/README.md). They share
`LLAMACPP_BASE_URL`/`LLAMACPP_API_KEY` with LLM summarization.

| Variable | Default | Purpose |
|---|---|---|
| `DEFENSORIA_ENABLED` | `False` | Mounts the three routers above when `true`. Tables/migrations/seeds always run regardless |
| `DATA_EXTRACTION_MAX_TOKENS` | `1024` | `max_tokens` for the extraction call |
| `DATA_EXTRACTION_MAX_RETRIES` | `2` | Extra attempts on invalid JSON/schema output (so 3 attempts total) |
| `DATA_EXTRACTION_SEARCH_BACKEND` | `hybrid` | Organigram matching scorer: `fuzzy`, `embeddings`, or `hybrid` |
| `DATA_EXTRACTION_TOP_K` | `5` | Ranked alternative sectors returned per recipient (`sector_candidates`) |
| `DATA_EXTRACTION_HYBRID_WEIGHT` | `0.25` | Weight on the embeddings score in `hybrid` mode; fuzzy gets the rest |
| `DATA_EXTRACTION_NAME_EVIDENCE_WEIGHT` | `1.0` | Discount applied to a holder-name match before comparing it to its threshold |
| `DATA_EXTRACTION_NAME_SCORE_THRESHOLD` | `90` | Minimum score for a holder-name match to resolve a recipient |
| `DATA_EXTRACTION_POSITION_SCORE_THRESHOLD` | `85` | Minimum score for a cargo/position match to resolve a recipient |
| `EXPORT_TIMEZONE` | `America/Argentina/Buenos_Aires` | Timezone the `.xlsx`/`.csv` export formats naive-UTC timestamps in |

Organigram matching only runs for recipients whose macro sector is `GCBA`;
every other macro sector short-circuits to no match regardless of these
thresholds. See
[organigram matching](../pipelines/defensoria/README.md#organigram-matching)
for the full resolution order.

## ASR transcription

The `/api/asr/*` routes proxy a [`coro`](https://github.com/collectiveai-team/coro)
server. Without `TRANSCRIBE_BASE_URL` they answer `500 Configuration error`.

| Variable | Default | Purpose |
|---|---|---|
| `TRANSCRIBE_BASE_URL` | `None` | e.g. `http://coro:8000/v1`; required for transcription |
| `TRANSCRIBE_API_KEY` | `not-needed` | Sent as the bearer token |

### Variables consumed by Compose, not by the API

| Variable | Default | Purpose |
|---|---|---|
| `CORO_VERSION` | `1.0.5` | Image tag for the `coro` / `coro-gpu` services |
| `CORO_BACKEND_ASR` | `onnx-asr` | ASR backend for the CPU service |
| `CORO_MODEL_ASR` | `nemo-canary-1b-v2` | ASR model for the CPU service |
| `CORO_BACKEND_ASR_GPU` | `faster-whisper` | ASR backend for the GPU service |
| `CORO_MODEL_ASR_GPU` | `openai/whisper-medium` | ASR model for the GPU service |
| `CORO_BACKEND_DIARIZATION` | `nemo` | Diarization backend for both |

`coro` sits behind the `asr` compose profile, so it does not start with a plain
`docker compose up`. Use the Makefile targets:

```bash
make coro-up      # or CORO_SERVICE=coro-gpu make coro-up
make coro-logs
```

## Third-party variables
Set in `.env.common` and honoured by the libraries themselves, not by AymurAI:

| Variable | Value in `.env.common` | Read by |
|---|---|---|
| `HF_HOME` | `/resources/cache/huggingface` | `huggingface_hub` |
| `TOKENIZERS_PARALLELISM` | `1` | `tokenizers` |
| `CACHE_PATH` | `/resources/cache` | Nothing in this repo — kept for compose/tooling convenience |

## Selecting services with the Makefile
The Makefile picks which compose service its targets act on:

| Variable | Default | Alternatives |
|---|---|---|
| `API_SERVICE` | `aymurai-api` | `aymurai-api-gpu` |
| `API_FULL_SERVICE` | `aymurai-api-full` | `aymurai-api-full-gpu` |
| `CORO_SERVICE` | `coro` | `coro-gpu` |

```bash
API_SERVICE=aymurai-api-gpu make api-up
```

## Variables read outside `Settings`
These bypass the settings module and are read with `os.getenv` where they are
used. They are therefore absent from `Settings`, cannot be overridden per stage
in the usual way, and are evaluated at import time:

| Variable | Read in |
|---|---|
| `STAGE` | `aymurai/settings.py` |
| `LOG_LEVEL` | `aymurai/logger/logger.py` |
| `DISKCACHE_ROOT` | `aymurai/utils/cache.py` |
| `SENTENCE_ENCODER_TYPE` | `aymurai/models/sentence_encoder/factory.py` |
| `NO_DOWNLOAD_IF_EXISTS` | `aymurai/utils/download.py` |
| `PDF_WATERMARK_FONT_REGULAR`, `PDF_WATERMARK_FONT_BOLD` | `aymurai/text/anonymization/pdf/watermark.py` (env takes precedence over the `Settings` field of the same name) |

## A note on `.env.schema`
The `.env.schema` in the repository root was produced by `varlock init`, which
scanned installed dependencies and emitted several hundred PyTorch, Jupyter and
build-tool variables that AymurAI never reads. It still contains the placeholder
`EXAMPLE_ITEM="delete me!"`. **Do not treat it as the configuration contract** —
this page is. Start from `.env.common` and add only what you need.

## Related docs
- Documentation index: [../README.md](../README.md)
- API reference: [../api/README.md](../api/README.md)
- Internal database: [../database/README.md](../database/README.md)
- Pipelines index: [../pipelines/README.md](../pipelines/README.md)
