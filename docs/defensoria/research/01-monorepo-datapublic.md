# 01 — Current monorepo: the "Set de datos" (datapublic) backend

Repo `aymurai` @ `dev` = `8365a68`. SQLModel 0.0.22, FastAPI, Alembic, SQLite.

## Live surface — only three endpoints

Mounted at `/api/datapublic` (`aymurai/api/core.py:28-32`), from
`aymurai/api/endpoints/routers/datapublic/datapublic.py` (172 lines):

- `POST /api/datapublic/predict/{document_id}` — body `{text}`, query `use_cache=true`,
  returns `DocumentInformation{document, labels}`. Side effect: upserts paragraph + document + link row.
- `GET  /api/datapublic/validation/document/{document_id}` — 404 if no row; `null` if unvalidated.
- `POST /api/datapublic/validation/document/{document_id}` — body is `RootModel[dict]`, i.e.
  **completely unvalidated free-form JSON**. Full overwrite, no merge, no history, no concurrency control.

Module state: `pipeline_lock = threading.Lock()` — a process-global lock serialising **all** datapublic inference.

### Dead / broken
- `routers/datapublic/dataset.py` and `routers/database/datapublic.py` both import `DataPublicDataset*`
  from `aymurai/database/schema.py`, **which has never existed in this repo**. Importing either raises
  `ImportError`. Neither is mounted. They do show the house export pattern
  (pandas → `NamedTemporaryFile` → `FileResponse` + `BackgroundTask(os.remove, ...)`, `ExportFormat = CSV|JSON`).
- `aymurai/database/crud/datapublic/*` is imported by **nothing**; the router does raw
  `session.add_all/commit/refresh`. Two functions are outright broken
  (`datapublic_document_update` → `TypeError`; `paragraph_create(override=True)` deletes a transient object),
  and `DataPublicDocument(name=...)` silently drops `name` (no such column) because SQLModel 0.0.22's
  `sqlmodel_table_construct` ignores non-field kwargs.
- **The frontend never calls the datapublic validation endpoints.** Document-level persistence is
  implemented, tested, documented — and unused.

## Tables

`datapublic_document` — `prediction JSON`, `validation JSON`, `id CHAR(32) PK`, `created_at`, `updated_at`.
No `name` column (unlike `anonymization_document`).

`datapublic_paragraph` — `text VARCHAR NOT NULL`, `prediction JSON`, `validation JSON`, `id CHAR(32) PK`,
`created_at`, `updated_at`.

`datapublic_document_paragraph` — `id`, `document_id FK`, `paragraph_id FK`, `"order" INTEGER`.
Composite PK `(id, document_id, paragraph_id)`; the surrogate `id` exists so a (document, paragraph) pair can repeat.

**Zero non-PK indexes exist in the entire database.** No index on `document_paragraph.document_id`; the
composite PK leads with a random `uuid4`, so it is useless for document lookups. Every document→paragraph
query is a full scan.

Never written by any code: `datapublic_document.prediction`, `datapublic_paragraph.validation`,
`document_paragraph.order`.

`aymurai/database/meta/datapublic/categories.py` is **not a table** — unused `str, Enum` classes
(`Materia`, `Violencia`, `ModalidadViolencia`, `Genero`, `FrecuenciaEpisodios`, `TipoResolucion`, `OralEscrita`),
imported by nothing, and whose values conflict with the frontend's `options.json` (accents, spaces, membership).

## Identity — content-addressed, and that is the whole model

`aymurai/database/utils.py`:
- `data_to_uuid(bytes)` = `uuid5(NAMESPACE_DNS, blake2b(digest_size=16).hexdigest())`
- `text_to_uuid(text)` = `data_to_uuid(text.encode())`

`document_id` = `data_to_uuid(file_bytes)` from `/misc/document-extract`. `paragraph_id` = `text_to_uuid(text)`.

## ⚠️ Ownership / isolation — DEFINITIVE: there is none

Searched for `user_id|client_id|tenant|workspace|owner|session_id|auth|jwt|login|current_user`,
`HTTPBearer|OAuth2|fastapi.security|APIKeyHeader`. Results:

- Zero authentication, zero authorization. No `fastapi.security` import anywhere.
- The **complete** set of FastAPI dependencies in the backend is `Depends(get_session)` and
  `Depends(get_transcribe_base_url)`.
- **No table has a user/owner/tenant column.**
- No middleware does auth (only an `X-Process-Time` header). CORS is `allow_origins=settings.CORS_ORIGINS`,
  `allow_credentials=True`, `allow_methods=["*"]`.

Consequences:
1. Anyone reaching the API can read **and overwrite** any document's validation by knowing its UUID5.
2. `document_id` is **derivable offline from the file bytes** — content addressing *is* the identity model.
3. Paragraph rows are **globally shared**: two users processing documents sharing a paragraph share the row,
   and the second predict overwrites the first's `prediction`.

Adding isolation means adding columns, a dependency, and a scoping layer **from scratch**.

## Engine / session / migrations

`aymurai/database/session.py` — `get_session()` creates **a brand-new `Engine` per request** and disposes it
in `finally`. No pooling, no `busy_timeout`, no WAL. Expect `database is locked` under concurrency.

`aymurai/database/env.py` overrides `script_location` and `sqlalchemy.url` from settings at runtime.
No `render_as_batch=True`, so SQLite ALTER-heavy migrations cannot be autogenerated correctly.

Migrations run **in-process in the FastAPI lifespan** (`aymurai/api/main.py:51-53`,
`command.upgrade(alembic_cfg, "head")`), racing across workers. Chain is linear, three revisions:
`13f78d08e925` (creates all six anonymization+datapublic tables) → `49b3f24f7ad0` (audio) →
`8f2c6a10b7d3` (llm summarization, current head).

`make alembic-regenerate` is **destructive** — `rm -rvf resources/cache/sqlite/*` and
`rm -rvf aymurai/database/versions/*`. That is why there are only three revisions.

DB URL: `settings.SQLALCHEMY_DATABASE_URI`, default `sqlite:////resources/cache/sqlite/database.db`.
Config trap: Docker sets `RESOURCES_BASEPATH=resources` (relative) while the DB URI default is absolute.

## The NER pipeline

Config `resources/pipelines/production/datapublic/pipeline.json`, loaded by `AymurAIPipeline.load` which
`importlib`-resolves dotted strings — **executable configuration**. Chain:

1. `FlairTextNormalize`
2. `FlairModel("aymurai/flair-ner-spanish-judicial", split_doc=true, cpu)` — BETO + BiLSTM-CRF from the HF Hub
3. `DecisionEmbeddingBagBinRegex(threshold=0.5, return_only_with_detalle=true)`
4. `RegexSubcategorizer` → `DatetimeFormatter` → 4× `SentenceTransformerSubcategorizer`
   (CONDUCTA, CONDUCTA_DESCRIPCION, DETALLE, OBJETO_DE_LA_RESOLUCION) → `ArticleSubcategorizer`

Subcategorizers run in **priority order** — each skips entities that already carry
`aymurai_label_subclass`, so regex wins over embeddings.

`split_doc=True` re-bases offsets with `np.cumsum`, which is the origin of the `numpy.int64`
JSON-serialisation bug fixed in `9c0b0cc` and regression-tested.

`DocLabel` (`aymurai/meta/api_interfaces.py:42-55`) drops `label`, `start`, `end`, `context_pre/post`
on the way out — stored predictions lose token offsets and context; the entity type survives only
inside `attrs.aymurai_label`.

## Semantic retrieval that already exists

`aymurai/transforms/entity_subcategories/`:
- `subcategories.py` — `SUBCATEGORIES: dict[str, list[str]]`, **Python source, not the DB**:
  `conducta` 224, `conducta_descripcion` 82, `detalle` 287, `objeto_de_la_resolucion` 35.
- `sentence_transformer.py` — "index" is a single `np.ndarray` persisted as `.npz` under
  `{CACHE_BASEPATH}/SentenceTransformerSubcategorizer/`. Search is brute-force
  `np.inner(query, corpus)` + `argsort` (raw dot product, **not** cosine — nothing is L2-normalised,
  despite the docstring). Hybridised with BM25 at `bm25_weight=0.5`, each max-normalised per query.
  Writes the **top-5** list.
- `bm25.py` — `BM25Scorer`, a pure-Python double loop over tokens × documents on every call.

Cache validated **only by subcategory count**, loaded with `allow_pickle=True`.
Four subcategorizer instances each build their **own** `SentenceTransformer` and each embed **every**
entity, not just their own category → 4× redundant model memory and encoding per paragraph.

## Excel on the backend — NONE

No `openpyxl`, no `xlsxwriter`, no `to_excel` anywhere under `aymurai/`. Backend export is CSV/JSON only,
via the two dead routers. **The 65-column "Set de datos" schema exists only in TypeScript**
(`frontend/src/renderer/src/utils/file/excelStructure.ts`).

## Tests

- `tests/api/routers/datapublic/test_datapublic.py` — 10 tests: predict, cache hit (asserts pipeline
  **not** called), persistence incl. the link row, numpy-dtype regression, 422 on non-UUID, multi-paragraph
  linking, validation 404/null/upsert round-trip.
- `tests/api/routers/test_pipeline_flows.py:117-166` — extract→predict→validate e2e, mocked.
- `tests/integration/pipelines/test_datapublic.py` — 5 `@slow` tests against the real pipeline.

Fixtures worth reusing: `tests/api/conftest.py` (`app` builds a **fresh** FastAPI mounting selected routers —
it does *not* use `aymurai.api.main:api`, so lifespan/alembic never runs; `db_engine` is in-memory SQLite
with `StaticPool` + `SQLModel.metadata.create_all`; `client` overrides `get_session`),
`tests/api/routers/conftest.py::build_mock_pipeline`.

**Untested:** the whole CRUD layer, both dead routers, Alembic (schema comes from `create_all`, so
migration drift is invisible), session/concurrency, and every subcategorizer/BM25/datetime transform.

## Fragilities to know

| # | Finding |
|---|---|
| F1 | No auth/ownership/tenancy anywhere — critical for any shared deployment |
| F2 | `dataset.py` + `database/datapublic.py` import a nonexistent model → `ImportError` |
| F3 | `paragraph_id` hashes the **raw** text but the row stores the **normalized** text |
| F4 | `use_cache=False` on already-stored text → duplicate PK → `IntegrityError` → 500 |
| F5 | A new SQLAlchemy `Engine` per request |
| F6 | Zero non-PK indexes in the entire DB |
| F7 | `alembic upgrade head` in the FastAPI lifespan, racing across workers |
| F10 | `cache_load/cache_save` called with a `logger=` kwarg they don't accept — flipping any pipeline's `use_cache` to `true` crashes |
| F20 | `pipeline.json` is executable config (importlib on dotted paths) |
| F21 | Global `threading.Lock` serialises all datapublic inference; `FlairModel` sets `flair.device` globally |
| F23 | No xlsx on the backend; the dataset schema has no server-side representation |
| F24 | The frontend never calls the datapublic validation endpoints |
