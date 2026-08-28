# 03 — Historical backend: `AymurAI/backend @ feature/defensoria` = `66109cbf` (2026-08-23)

> Read via `git -C /home/jansaldo/Documents/collective-ai/backend show 66109cbf:<path>`.
> The local clone was stale at `f37716f8`; fetched 2026-08-25.

## Commit history of the feature

```
967afc1a 2026-08-23  id key for validated recipients; use_cache mirroring the anonymizer
82c20e4e 2026-08-21  updated inference when the document was already inferenced
22472ec0 2026-08-10  search for documents previously inferred
2d045fc8 2026-08-10  data_extraction database creation after frontend validation
013e86ea 2026-07-21  data_extraction endpoint born   <-- what the 2026-08-05 spec was written against
3874b32d 2026-06-25  defensoria taxonomy JSON + information extraction prompt template
```

## Real footprint (~2,526 lines, not the ~1,140 the old spec assumes)

```
+573  aymurai/api/endpoints/routers/llm/data_extraction/extraction_service.py
+619  aymurai/api/endpoints/routers/llm/data_extraction/organigram_matching.py
+443  aymurai/api/endpoints/routers/llm/data_extraction/sector_matching.py      <-- ABSENT from the old spec
+232  aymurai/api/endpoints/routers/llm/data_extraction/schemas.py
+149  aymurai/api/endpoints/routers/llm/data_extraction/router.py
  +3  aymurai/api/endpoints/routers/llm/data_extraction/__init__.py
+105  aymurai/database/crud/data_extraction/data_extraction.py
+114  aymurai/database/crud/data_extraction/validated_destinatario.py
 +55  aymurai/database/meta/data_extraction/data_extraction.py
 +62  aymurai/database/meta/data_extraction/validated_destinatario.py
 +41  .../versions/data_extraction/672b617e1980_add_llm_data_extraction_table.py
 +43  .../versions/data_extraction/7e93b6df5d3c_add_llm_validated_destinatario_table.py
 +87  .../versions/data_extraction/55bc582662cb_redo_llm_validated_destinatario_table.py
 +39/-1  aymurai/settings.py
  +6/-1  aymurai/api/core.py     (ADDS the router; does NOT delete ASR — that claim was about an older diff)
```

Also tracked: `notebooks/experiments/defensoria/README.md` (11,908 B) — **the only prose spec of the feature**,
explicitly un-gitignored for that reason. Copy saved at `research/README-defensoria-upstream.md`.

## Reversals — decisions that were made and then undone

1. **`temas_disponibles` / `subtemas_disponibles` removed** (`967afc1a`). Added at `2d045fc8` as
   backend-generated dropdown options, deleted three days later:
   > "el endpoint no genera ninguna lista de opciones para el dropdown — eso lo maneja el front, con su
   > propia fuente de la taxonomía."

   **This is the decision our new work explicitly reverses.** The upstream reason was expedience, and the
   consequence is the frontend's 313-line hand-ported taxonomy copy.
   Vestige to clean on port: `_TAXONOMY` still keeps subtemas as an *ordered tuple, not a set*, with a stale
   comment referencing the deleted consumer.
2. **`force_reextract` → `use_cache` query param** (`967afc1a`), inverted polarity, moved body → query,
   mirroring `anonymizer_paragraph_predict`.
3. **`llm_validated_destinatario` dropped and recreated** (`55bc582662cb`) with an autoincrement integer PK
   instead of `nombre_normalizado`. Migration comment: *"This table is a derived lookup index (rebuilt from
   human validations, not a source of truth), so dropping it is safe even with pre-existing rows."*
4. **`search_fields` removed** and **`candidatos_nombre`/`candidatos_cargo` replaced by
   `candidatos_sector`** (`2d045fc8`). `OrganigramCandidate` is now internal-only and never crosses the wire.

## The contract

### `POST /llm/data-extraction?use_cache=<bool>` → `200 DataExtractionResult`

Request `DataExtractionRequest`:
```python
document             : Document          # {document: list[str], document_id: UUID5, header?, footer?}
model                : str | None        = None   -> settings.MODEL ("gemma4:latest")
search_backend       : Literal["fuzzy","embeddings","hybrid"] | None = None
hybrid_weight        : float | None (0..1) = None
top_k                : int | None        = None
sector_mode          : Literal["csv","hierarchy"] | None = None
sector_top_k         : int | None        = None
nombre_origen_weight : float | None (0..1) = None
max_retries          : int | None        = None   -> DEFAULT_MAX_RETRIES = 2
options              : dict | None       = None   -> merged over DEFAULT_OPTIONS
```
Resolution idiom differs by type: `top_k or settings...` (falsy-coalescing — `top_k=0` silently falls back)
vs `x if x is not None else settings...` for the floats (correct, since `0.0` is the default for
`nombre_origen_weight`).

Response `DataExtractionResult`:
```python
numero_recomendacion   : str | None
fecha_recomendacion    : str | None            # prose, e.g. "30 de Mayo de 2022"
destinatarios          : list[DestinatarioExtraction]
tema                   : str | None            # plain str on the wire, not the Literal
subtema                : str | None
datos_personales       : bool                  # REQUIRED
contenido_para_publicar: str                   # REQUIRED

DestinatarioExtraction:
    nombre                 : str | None        # LLM verbatim, free text in the UI
    cargo                  : str | None        # LLM verbatim, free text in the UI
    destinatario_principal : bool
    sector                 : str | None        # LLM MACRO class, never overwritten
    sector_confirmado      : str | None        # human-picked specific GCBA sector; None until validated
    candidatos_sector      : list[SectorCandidate]

SectorCandidate:
    sector: str; score: float
    origen_campo: Literal["nombre","cargo","validado"]
    origen_nombre: str; origen_cargo: str; origen_score: float
```

Errors: `400` empty document; `502 LLMValidationError`; `503 OrganigramNotAvailable`; `503 SectorDataNotAvailable`.

### `PUT /llm/data-extraction/{document_id}/validate` → `200 SuccessResponse`

Body is a full `DataExtractionResult`. 404 if the document was never extracted.

## The extraction flow

1. **Import time:** `_load_config()` reads `${RESOURCES_BASEPATH}/llm/defensoria_extractor.yml`.
   `_TAXONOMY = yaml.safe_load(_CONFIG["taxonomy"])` — the taxonomy is a **YAML string nested inside the
   YAML**, parsed a second time. `Tema = Literal[tuple(_TAXONOMY)]`. `SYSTEM_PROMPT` computed **once, globally**
   → a missing/malformed YAML crashes app import, not the request.
2. **Cache read** (`use_cache`): `data_extraction_get(document_id)` → return
   `validation or prediction`, **skipping the LLM and organigram entirely**.
3. Resolve params request → settings → constants.
4. `document_text = "\n".join(document.document)` — **no chunking, whole document in one prompt.**
5. `_extract_with_retry`, `range(max_retries + 1)`:
   - `provider = OllamaLLMProvider(model=model, system_prompt=system_prompt)` — **constructed inside the loop**
   - `options = {"num_ctx": 32_768, "num_predict": 8192} | request_options`
   - `_parse_json_object`: strip a ```json fence, then scan every `{` and try `JSONDecoder().raw_decode`;
     return the first `dict`. Tolerates prose around the JSON.
   - `_LLMExtraction.model_validate(parsed)` — pydantic + taxonomy validator
   - On any exception: `system_prompt = _build_validation_retry_prompt(error, last_output)` — the **whole**
     original prompt plus a `# Corrección obligatoria` block quoting the error and previous output.
     **⚠️ The retry prompt grows monotonically** — attempt 3 nests attempt 2. Worst case 3 full-document calls.
   - Exhausted → `LLMValidationError` (502).
6. **Per destinatario** (`_build_destinatario`):
   - a. `_validated_candidate`: if `normalize_text(sector) == "gcba"`, exact-match
     `llm_validated_destinatario` by normalized `nombre`, falling back to normalized `cargo`; both
     `ORDER BY id DESC LIMIT 1`. Yields `SectorCandidate(score=1.0, origen_campo="validado")`.
   - b. `organigram_matching.search_candidates(...)` → `{"nombre": [...], "cargo": [...]}`, independently ranked.
   - c. Flatten and dispatch on `sector_mode` to `sector_matching`.
   - d. Validated candidate is **prepended, not deduped** — the same sector can appear twice.
7. Assemble; `sector_confirmado` is always `None` on a fresh extraction.
8. **Persist** (`use_cache`): `data_extraction_create_or_update(id, document, prediction, config)`.

### Taxonomy validation

`tema` is `Literal[tuple(_TAXONOMY)]` — pydantic rejects any tema outside the 25.
`subtema` is bare `str | None`, policed by a `mode="after"` validator:

```python
if self.subtema is None: return self
if self.tema is None: raise ValueError("No se puede especificar un subtema sin un tema")
valid = self.taxonomy[self.tema]
if self.subtema not in valid:
    raise ValueError(f"El subtema {self.subtema!r} no pertenece al tema {self.tema!r}. "
                     f"Subtemas válidos: {sorted(valid)}")
```
Both failures feed the retry loop, so the model literally receives the valid subtemas for the tema it chose.
Matching is **exact string equality** — no normalisation, no fuzzy.

The public `DataExtractionResult.tema/subtema` are plain `str | None`, so validation is on ingest only.

## Resources

### `resources/llm/defensoria_extractor.yml` — 18,884 B

```
system-prompts:
  information-extraction:   # persona, 1 paragraph
  extraction-guidelines:    # block scalar, 9 numbered rules
fields:                     # 6-7 keys
taxonomy:                   # ONE STRING, 12,464 chars, 267 lines, 25 top-level "- TEMA:" entries
output-format:
  type: json
  schema: {...}             # rendered via json.dumps(indent=2)
```

Assembled prompt ≈ **15–16 KB** before the document is appended as the user message.

The `013e86ea` rewrite added `sector` per destinatario, deleted a top-level `destinatarios_por_sector` field,
and added few-shot discipline for the nombre/cargo split:
```
Ejemplo INCORRECTO: {"nombre": "Instituto de Vivienda de la Ciudad Autónoma de Buenos Aires",
                     "cargo": "Presidente", ...}
Ejemplo CORRECTO:   {"nombre": "Juan Francisco Loupias",
                     "cargo": "Presidente del Instituto de Vivienda de la Ciudad Autónoma de Buenos Aires", ...}
```

The `sector` enumeration (`GCBA`, `Organismos Nacionales`, `Obra Social / Prepaga`, `Empresa`) lives
**only in the prompt** and is never validated in code.

### `resources/llm/defensoria_taxonomy.json` — 30,764 B

Flat list of **25 objects**, each `{"area", "tema", "subtemas": [{"codigo", "descripcion"}]}`.
**242 subtemas.** `codigo` is `<AREA><YEAR><n>`, e.g. `ACC20221`.

**⚠️ This JSON is never read by the endpoint.** The taxonomy enters solely as the `taxonomy:` *string*
inside the YAML. `area` and `codigo` are invisible at runtime — but they are exactly the stable-ID material
a persisted taxonomy needs.

Distribution: SALUD 25, UPC 21, CYT 19, PTT 17, AMB 15, SP 14, TUR/VIV 13, DL 11, PMJ/UCA 9, ACC 8,
COM/JPD 7, DPE/DR/GDS/IS/VTS 6, NAJ/SM 5, OEXT/PMG 4, DPD/MCA 3.

## `organigram_matching.py` (619 lines)

```python
ORGANIGRAM_PATH = Path(settings.RESOURCES_BASEPATH) / "data" / "restricted" / "defensoria" / "organigram_GCBA.json"
EMBEDDING_ENCODER_NAME = "minilm"
EMBEDDINGS_BM25_WEIGHT = 0.5     # module constant, NOT configurable
```

**Tree shape** — recursive dicts, exactly four keys: `cargo`, `sigla`, `nombre`, `dependencias: list[node]`.
Root may be a list or a dict. A node yields a searchable row **only if `nombre` is non-empty**; nameless
nodes still contribute a segment to `ruta_cargos`.

Flattened by `_load_organigram_people()` (`@lru_cache(maxsize=1)`) to a `pd.DataFrame` with columns
`nombre, cargo, sigla, depende_de_cargo, depende_de_sigla, ruta_cargos` (`" > "`-joined root-to-node path).

**Cargo cleaning** — `clean_cargo = _strip_noise_and_trailing(_extract_cargo_role(normalize_text(v)))`.
`CARGO_ROLE_PREFIXES` (20 entries) is **order-sensitive**, with an in-code warning:
> "'General' here is part of the title ('Secretary General'), not the start of the topic clause — these must
> come before the bare 'secretario'/'secretaria' below, or the alternation matches the shorter prefix first."

`CARGO_PARENT_MARKERS` is lookahead-gated on `PARENT_INSTITUTION_KEYWORDS` so `"del"` inside a compound
office name (`"Registro del Estado Civil"`) isn't mistaken for the parent boundary.

**Three backends:**
- `fuzzy` — `process.cdist([q], choices, scorer=fuzz.token_set_ratio)` over the **entire** corpus. Scale 0–100.
- `embeddings` — actually embeddings **+ BM25 at a hardcoded 50/50**. Asymmetric encoding
  (`question_encoder` for the query, `response_encoder` for the corpus). Scale ~0–1.
  Docstring records an empirical finding: *"keeping the parent-institution chain in the compared text made
  this scorer drift toward the parent institution instead of the specific office."*
- `hybrid` — computes **both** over the whole corpus, normalises each, blends. Explicitly:
  *"so the two score vectors can be normalized and combined before ranking, instead of merging two already-truncated top-N lists."*

**⚠️ `_normalize_scores` divides by the max, so the top hit in `embeddings`/`hybrid` is always ≈1.0
regardless of true match quality.** These scores rank; they do not measure confidence.

**Sector gating is hard and exact:** `if normalize_text(sector) != "gcba": return {"nombre": [], "cargo": []}`,
returning *before* the organigram file is opened — so a missing organigram doesn't 503 non-GCBA documents.
But if the LLM emits `"G.C.B.A."`, matching silently disables.

`search_candidates` returns **two independently ranked lists, never merged**:
> "A nombre candidate is not necessarily tied to the cargo candidate from the same organigram row: the person
> named X may no longer hold the cargo Y the organigram lists for them."

## `sector_matching.py` (443 lines)

Second reference file `destinatario_por_sector.csv` (~140 rows, 16 sectors).

**`sector_mode="csv"`** — match each candidate's `cargo` against the CSV; up to `sector_top_k` matches.
```python
_ORIGEN_SCORE_SCALE = {"fuzzy": 100.0, "embeddings": 1.0, "hybrid": 1.0}
campo_weight   = nombre_origen_weight if origen_campo == "nombre" else 1.0
combined_score = sector_score * (origen_score / origen_scale) * campo_weight
```

**`sector_mode="hierarchy"`** — `resolve_sector_from_hierarchy(ruta_cargos)`, purely structural, five rules
in priority order:
1. **Autonomous bodies** (AGC, AGIP, Instituto de Vivienda de la Ciudad, COPIDIS) override their
   administrative parent — AGIP hangs off Ministerio de Hacienda but the sector is "AGIP".
2. Any segment `startswith("ministerio")`.
3. Else any segment `startswith("secretaria")` — subtly, this **excludes** `"subsecretaria"` (starts with
   "sub"), so a lone Subsecretaría with no Secretaría above it won't match here.
4. Else `"jefatura de gabinete de ministros"` in path → literal `"Jefatura de Gabinete"`.
5. Else the first non-generic segment (`GENERIC_ROOT_LABELS = {"Jefe de Gobierno", "Jefatura de Gabinete de Ministros"}`).

No sector-match term in hierarchy mode, since the lookup is exact.

## Settings — six, not four

```python
DATA_EXTRACTION_SEARCH_BACKEND       = "hybrid"
DATA_EXTRACTION_TOP_K                = 5
DATA_EXTRACTION_HYBRID_WEIGHT        = 0.25       # embeddings weight; fuzzy gets 0.75
DATA_EXTRACTION_SECTOR_TOP_K         = 3          # csv mode only
DATA_EXTRACTION_NOMBRE_ORIGEN_WEIGHT = 0.0        # discards nombre evidence entirely
DATA_EXTRACTION_SECTOR_MODE          = "hierarchy"
```

**These are the tuned, counter-intuitive defaults, with recorded rationale:**
- `sector_mode="hierarchy"` — the CSV covers 16 sectors vs the organigram's ~33. *"Si el sector real de un
  destinatario no está en esas 16 filas, el modo 'csv' no puede acertar nunca, sin importar qué tan bueno
  sea el matching — tiene un techo de cobertura estructural."* Plus name drift
  (`"Secretaría de Deporte"` vs `"Deportes"`).
- `nombre_origen_weight=0.0` — *"una decisión deliberada, no solo un ajuste fino"*: a name can match with a
  very high score by pure text coincidence even if the person no longer holds the post, and that evidence
  can beat the cargo evidence, which is the durable signal.
- `hybrid_weight=0.25` favours fuzzy over embeddings.

## Persistence — YES, definitively (and never to Excel)

**`llm_data_extraction`** — one row per document:
`id UUID PK` (= `Document.document_id`, **not** a text hash), `document JSON`, `prediction JSON`,
`validation JSON | None`, `config JSON` (every resolved param of the run), `created_at`, `updated_at`.

**`llm_validated_destinatario`** — cross-document learned lookup:
`id INT PK autoincrement`, `document_id UUID`, `nombre`, `nombre_normalizado` (indexed), `cargo`,
`cargo_normalizado` (indexed), `sector`, timestamps.
Upsert key `(document_id, nombre_normalizado)` — re-validating the same document updates its row, but the
same person validated in a *different* document gets a new row, deliberately preserving history.
Read back with `ORDER BY id DESC LIMIT 1` ("most recent validation wins").

Two independent caches, explicitly documented as non-overlapping: per-`document_id` (whole result) and
per-person/per-cargo (sector only).

**No Excel export server-side.** `openpyxl` appears 0 times in `uv.lock` at that tip; no `to_excel` in any
endpoint code; the router exposes exactly two operations with no download route. The `.xlsx` files under
`notebooks/experiments/defensoria/` are untracked local analysis artifacts.

## ⚠️ The organigram data file does not exist anywhere

- **Not tracked** at `66109cbf`. `.gitignore` blocks it twice (`resources`, `*restricted*`). The tree has no
  `resources/data/restricted/defensoria/` directory at all.
- **Not on disk.** `find /home/jansaldo -iname "*organigram*"` → zero results.
- Same for `destinatario_por_sector.csv`.

**Its size is not recoverable from anything in the repo** — all notebook outputs are stripped. The only
quantitative hints are about *breadth*: ~30–33 sectors. Depth is at least 4–5 levels
(`Jefe de Gobierno > Ministerio > Secretaría > Subsecretaría > Dirección General`).

**This must be obtained from whoever holds it** before sizing embedding/BM25 build cost or per-query
`cdist` cost — both scale linearly in row count and both run over the *entire* corpus on every query.

## Tests — confirmed none

Zero tests anywhere touch `data_extraction`, `organigram_matching`, `sector_matching`, or the new tables.
The only verification artifact is a manual HTTP smoke-test notebook.

## Vestiges to clean on port

- The `# Subtemas are kept as an ordered tuple ... so subtemas_disponibles can preserve the taxonomy's own
  order` comment — its consumer was deleted in `967afc1a`.
- `top_k or settings...` falsy-coalescing — `top_k=0` silently becomes 5.
- `EMBEDDINGS_BM25_WEIGHT = 0.5` is a module constant while everything else is configurable.
