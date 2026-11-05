# 02 — Current monorepo: LLM and configuration infrastructure

Repo `aymurai` @ `dev` = `8365a68`.

## ⚠️ The provider abstraction was deliberately deleted

**There is no `LLMProvider` ABC, no `get_llm_provider` factory, and no `LLM_PROVIDER` setting.**
Verified: zero hits for `get_llm_provider|class LLMProvider|ollama` under `aymurai/`.

Removed by `docs/superpowers/specs/2026-08-18-llamacpp-only-llm-provider-design.md`:
> "Standardizing on llama.cpp lets us replace estimation with exact, server-authoritative token
> accounting; delete the ABC, the factory, the tiktoken dependency…"

**llama.cpp is the only backend.** Any port that reaches for `get_llm_provider` is targeting a
deleted API. The historical Defensoría branch uses `OllamaLLMProvider` — that construction must be
replaced, not merely re-pointed.

## `aymurai/llm_providers/` — four files, 776 lines

`__all__ = ["UNRESOLVED_MODEL", "LLMResponse", "LlamaCppLLMProvider", "OpenAICompatibleLLMProvider", "ServedModel"]`

```python
class LLMResponse(BaseModel):
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: Any | None = None
```

`OpenAICompatibleLLMProvider` (398 L) — `__init__(model, *, base_url=None, api_key="not-needed", system_prompt=None)`;
`generate` / `async_generate` / `stream` / `async_stream`; `close` / `aclose`.
**Only `async_stream` accepts a per-call `system_prompt=` override.**

**No option translation.** `_build_request_kwargs` (line 314) forwards every kwarg verbatim to
`chat.completions.create`; the sole guard rejects `model`.

`LlamaCppLLMProvider` (347 L) extends it with exact token accounting against llama-server:
`tokenize` / `tokenize_pieces` (`POST /tokenize`), `render_prompt` (`POST /apply-template`),
`count_prompt_tokens` (render → tokenize), `resolve_served_model` (`GET /v1/models` → `ServedModel(id, n_ctx, n_ctx_train, capabilities)`).
`aresolve_served_model` is memoized per instance.

**Fail-closed guard:** missing `LLAMACPP_BASE_URL` raises `ValueError` rather than letting the OpenAI SDK
default to `api.openai.com` — the rationale being that it would leak judicial document bodies to a third
party. Tested (expects HTTP 500).

`render_prompt` deliberately sends no `chat_template_kwargs`, which is what keeps preflight counts equal
to `usage.prompt_tokens`.

**Missing:** no explicit timeouts (SDK default 600 s).

> **Corrected by ticket 04 (verified against real code):** the SDK *does* retry transport failures
> (`DEFAULT_MAX_RETRIES = 2`), and **`extra_body` passes through `_build_request_kwargs` verbatim** — it
> needs no provider change. What is genuinely absent is *application-level* retry on invalid output.

## ⚠️ Structured output — definitive answer

**Nothing in the provider or API layer uses structured output today.** Zero hits for
`response_format`, `json_schema`, `grammar`, `guided_*` in first-party LLM code — and a test
explicitly asserts `response_format` is **not** sent
(`tests/llm_providers/test_openai_compatible_provider.py:86-95`).

But it is **one line away for Python callers**: `_build_request_kwargs` is a pass-through, so
`await provider.async_generate(prompt=..., response_format={"type": "json_schema", "json_schema": {...}})`
already works, and llama-server supports OpenAI-style `response_format` (`json_object`, `json_schema`) natively.

What it cannot do:
1. ~~**llama.cpp-native `grammar` / GBNF** needs `extra_body=`, which the provider never sets and does not expose.~~
   **WRONG — corrected by ticket 04.** `extra_body` is forwarded verbatim, so a Python caller can send a
   top-level `grammar` today with zero provider changes (proved with `httpx.MockTransport`). All four
   mechanisms work already; what is missing is the HTTP surface, parsing/validation, and retry.
2. **No HTTP surface** — `GenerationOptions` (`summarization.py:45-64`) is `ConfigDict(extra="forbid")` with
   only `max_tokens|temperature|top_p|seed|stop`. A client sending `response_format` gets 422.
3. **No parsing/validation helper.** No `LLMResponse.parsed`, no `TypeAdapter` round-trip, no repair loop.
4. **Streaming and structured output are entangled** — the engine is built entirely on `async_stream`;
   `async_generate` is never called by the API.
5. `max_tokens` must also cover reasoning tokens; with reasoning on, structured output can truncate mid-JSON
   and surface as `EmptyCompletionError`.

## Prompts

One file: `resources/llm/summarization.yml` (92 lines). Path resolved at import:
`PROMPT_TEMPLATE_PATH = Path(settings.RESOURCES_BASEPATH) / "llm" / "summarization.yml"`.

Keys `system-prompts.{template, rolling}` are used; `baseline` and `task-specific` are **dead**.
`_load_prompt_defaults` runs **at import** and raises `RuntimeError` if defaults are blank — an import-time
crash if the YAML is missing.

Both loaders **re-read and re-parse the YAML from disk on every request** (no caching). Formatting is plain
`str.format`, so **any literal `{`/`}` in user-supplied text raises inside `.format`** and is caught by a
broad `except Exception` → 500. That is a real hazard for a JSON-schema-carrying prompt.

**No prompt versioning.** The only provenance is the fully-rendered prompt string stored in
`Summarization.config["system_prompt"]`, documented as informational only:
> "It is informational only: the cache key is the source text alone, so a differing config never triggers regeneration."

**Cache key is `text_to_uuid(text)` alone.** Changing the prompt does not invalidate cached rows;
`use_cache=false` is the only regeneration path (and it clears human validation).

## Output validation and retries — essentially absent

The entirety of output validation (`summarization_engine.py:448-455`):
```python
if not generated.strip():
    raise EmptyCompletionError(...)
```
The markdown structure the prompt demands is **never checked**. No JSON parse, no schema, no field assertion.

**Zero *application-level* retries in the LLM path** — nothing re-prompts on invalid output. `tenacity` is
installed but used only for DB connect. (The `openai` SDK does retry transport-level failures twice.)

`summary_validation.py` is **human** validation (TipTap `JSONContent` stored verbatim), not model-output validation.

## Reusable machinery worth keeping

`ContextBudget` / `build_context_budget` / `prepare_run` (`summarization_engine.py:136-326`) — genuinely good:
sentinel-measured scaffolds (`SENTINEL = "X"`, because an empty slot lets surrounding newlines collapse into
a differently-tokenizing run), `effective_ctx = min(server n_ctx, settings.LLM_MAX_CONTEXT_TOKENS)`,
per-window exact preflight, adaptive rolling budget from the *measured* carried summary.

`chunking.py` — `take_window`, boundary snapping (paragraph → newline → word), overlap, forward-progress
guarantee. Pure, dependency-free, fully unit-tested. **Reusable as-is.**

## Persistence house pattern (follow this)

1. `aymurai/database/meta/<feature>.py` with `<X>Base` / `<X>(table=True)` / `Create` / `Update` / `Read`
2. Re-export from `aymurai/database/schema.py` (a `# ruff: noqa: F401` barrel — **anything not re-exported
   here is invisible to Alembic autogenerate**)
3. Hand-written Alembic revision under `aymurai/database/versions/`
4. `crud/<x>.py` with `<x>_get` and `<x>_create_or_update` (which resets `validation = None` on regeneration)

## Settings — `aymurai/settings.py`, ~24 fields, instantiated at import

LLM-relevant: `LLAMACPP_BASE_URL=None`, `LLAMACPP_API_KEY="not-needed"`, `LLM_DEFAULT_MAX_TOKENS=4096`,
`LLM_CHUNK_OVERLAP_TOKENS=128`, `LLM_MAX_CONTEXT_TOKENS=None`. **No model-name setting** — the model is
discovered from `/v1/models`.

Also: `SQLALCHEMY_DATABASE_URI`, `RESOURCES_BASEPATH="/resources"`, `CACHE_BASEPATH`, `ALEMBIC_INI_PATH`,
`CORS_ORIGINS`, `TRANSCRIBE_BASE_URL`, `MEMORY_CACHE_MAXSIZE=4`, `TORCH_NUM_THREADS=4`.

Note `model_config = ConfigDict(case_sensitive=False)` uses pydantic's `ConfigDict`, not pydantic-settings'
`SettingsConfigDict`; there is **no `env_file=`** — env loading is manual via `python-dotenv`.

Six env vars are read **outside** the settings module (pre-existing CES-76 violations):
`SENTENCE_ENCODER_TYPE`, `LOG_LEVEL`, `DISKCACHE_ROOT`, `NO_DOWNLOAD_IF_EXISTS`, `STAGE`, `PDF_WATERMARK_FONT_*`.

## Deployment

`docker-compose.yml` services: `llamacpp`, `llamacpp-gpu`, `aymurai-api{,-gpu}`, `aymurai-api-full{,-gpu}`,
`coro{,-gpu}` (profile `asr`). **No ollama service.**

```yaml
command: >
    -m /models/${LLAMACPP_MODEL_FILE}
    --host 0.0.0.0 --port 8080
    -c ${LLAMACPP_CTX_SIZE:-16384}
environment:
    LLAMA_ARG_REASONING: ${LLM_REASONING:-auto}
    LLAMA_ARG_THINK_BUDGET: ${LLM_THINK_BUDGET:--1}
```
Reasoning is a **server-launch** concern — it cannot be set per request.
Default context is **16384**, not 32768. `LLAMACPP_MODEL_FILE` has no default and no `.env.schema` entry.

**`.env.schema` is stale varlock scan output** (~400 torch/HF/pytest vars, `EXAMPLE_ITEM="delete me!"` still
present) and documents **none** of the LLM settings. It is not the config contract; compose is.

## Embeddings / vector search — definitive

**There is no vector store.** No FAISS, chroma, sqlite-vec, pgvector, hnswlib, qdrant, annoy — zero hits
across `aymurai/`, `tests/`, `pyproject.toml`. Retrieval is 100% in-memory NumPy.

`aymurai/models/sentence_encoder/` — `create_encoder(encoder_type=None, device=None)`, `EncoderType = DISTILUSE | MINILM`.
Production uses **distiluse-base-multilingual-cased-v2** (512-dim); alt is
**paraphrase-multilingual-MiniLM-L12-v2** (384-dim). Env-switchable via `SENTENCE_ENCODER_TYPE`.
This is the only surviving factory pattern in the repo — the same shape the deleted `get_llm_provider` had.

Any RAG/retrieval component starts from a working brute-force-cosine-over-npz pattern and nothing else:
nothing indexes documents, nothing is incremental, nothing is persisted to SQL.

## Exceptions and routing

`aymurai/api/exceptions.py` — `AymuraiAPIException(HTTPException)` with class-level `status_code`/`title`.
Subclasses: `UnsupportedFileType(400)`, `NotFoundError(404)`, `ConfigurationError(500)`, `UpstreamServiceError(502)`.
No handlers registered — they work as `HTTPException` subclasses. Adding one is a 4-line class.

**The LLM routers mostly don't use them** (raw `HTTPException` throughout); `asr/transcribe.py` does. Follow ASR.

`core.py` is a flat list of `include_router`; `main.py` mounts it at `/api`, so real paths are
`/api/llm/summarize` etc. **Two routers may share one prefix** — that is exactly how `summarization` +
`summary_validation` split (CES-71 file-size compliance).

Middleware: CORS + one `X-Process-Time` header. Lifespan: DB connect retry (tenacity, 5 min) →
`alembic upgrade head`. **No auth, no global exception handler, no request-id.**

Starlette's multipart limit is monkey-patched to 10 MB in `main.py:28-42`.

## ASR router — the house pattern for a newer router

- Schemas live **outside** the router (`aymurai/meta/api_interfaces.py`); upstream wire types in
  `aymurai/api/meta/asr/coro.py`. The LLM router defines schemas inline; ASR (newer) externalizes.
- Config via a `Depends` that raises `ConfigurationError` (`get_transcribe_base_url`).
- Error-mapping wrapper: `RuntimeError` → `UpstreamServiceError(502)`, else `AymuraiAPIException(500)`.
- `use_cache: bool = True` query param; cache-then-generate.
- SSE with `Cache-Control: no-cache` and `X-Accel-Buffering: no` headers — **which the LLM stream is missing**.
- `GET`/`POST /validation/document/{document_id}` storing `model_dump(mode="json")` into a JSON column.

## Dependencies

`requires-python = "==3.13.*"`. pydantic **2.13.4**, sqlmodel **0.0.22** (pinned), alembic 1.18.5,
openai 2.50.0, httpx 0.28.1, sentence-transformers 5.6.0, pandas 2.3.3, numpy 2.5.1 (pinned),
tenacity, torch, flair 0.15.1 (pinned), pymupdf4llm, python-docx, pypandoc.

- **`rapidfuzz` is used directly** (`aymurai/utils/entity_disambiguation/fuzzy.py`) but is **not declared**
  in `pyproject.toml` — transitive only (locked 3.14.3). Undeclared direct dependency; fix if relied upon.
- **`openpyxl` is absent**, as is `xlsxwriter`. Excel export needs a new dependency.
- Also absent: `tiktoken` (deliberately removed), `ollama`, `outlines`, `instructor`, `jsonschema`.

## Test mocking playbook — `tests/api/routers/llm/conftest.py`

Two strategies:
- **(a) Router-level doubles** — `patched_generation(events, ...)` patches `summarization.prepare_run`
  and `summarization.summarize_events` *by name in the router module*, with call-recording lists.
- **(b) Network-level double** — `fake_llamacpp_network(n_ctx=..., n_ctx_train=...)` fakes `/tokenize`,
  `/apply-template` and `models.list()` so the **real** engine path runs end to end.

Test app is a bare `FastAPI()` with only the relevant routers, in-memory SQLite via `StaticPool` +
`SQLModel.metadata.create_all`, `dependency_overrides[get_session]`, `TestClient(raise_server_exceptions=False)`.

**Nothing in the suite asserts anything about LLM output *shape* beyond non-emptiness** — a strict
extraction flow needs an entirely new class of test, with no existing example to copy.

## Gaps vs. what strict structured extraction needs

| # | Need | Status | Cost |
|---|---|---|---|
| 1 | `response_format` / `json_schema` on the wire | plumbing exists, nothing uses it, one test pins its absence | small |
| 2 | llama.cpp-native `grammar` / GBNF | **already works** via `extra_body` pass-through (ticket 04) | none in the provider |
| 3 | Parse + pydantic-validate the completion | nothing | new module |
| 4 | Retry / repair on invalid output | no application-level retry anywhere | new |
| 5 | Request timeouts | none; SDK default 600 s | small |
| 6 | Non-streaming path in the engine | engine is stream-only | small |
| 8 | Cache invalidation on prompt change | none — cache key is text alone | design decision |
| 9 | Multiple prompt files / registry | one YAML, re-read per request, `str.format` brace hazard | small refactor |
| 14 | Structured results in SQL | only markdown + opaque JSON blobs | new table + revision |
| 15 | Vector search over documents | nothing | full build if needed |
| 16 | Excel export | `openpyxl` absent; only CSV/JSON, via a dead router | new dep |
