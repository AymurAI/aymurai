# 04 — Historical frontend: `desktop-app @ origin/feat/recomendaciones-defensoria`

Base is `origin/develop` (merge-base `fe3103c`), **not** `main`. 30 commits, 69 files, +8538/−326.
**Never merged.** The last commit deletes a feature at product-owner request.

## Key documents on the branch

- `docs/superpowers/plans/2026-07-31-recomendaciones-defensoria.md` (1845 lines) — full design with resolved decisions
- `docs/superpowers/plans/2026-07-31-recomendaciones-backend-contract.md` (393 lines) — copy-paste-ready backend issue, includes a SQLModel sketch

## User journey

No new routes. A 5th `FeatureFlowEnum.Recomendaciones` slots into the existing 4-step
`/app/$feature/{onboarding,preview,process,validation,finish}` shell via one-line switches.

1. **Feature grid** — card "Recomendaciones" / *"Registra las recomendaciones de la Defensoría en una base estructurada"*, `Megaphone` icon.
2. **Onboarding** — `.docx`/`.pdf`, **single document only** (`addFiles(files.slice(0, 1))`).
3. **Preview** — unchanged.
4. **Processing** — two sequential stages: `POST /misc/document-extract`, then a GET-stored-or-POST-extract decision.
   Progress is **faked** (`isReady ? 1 : 0.5`) because a local LLM reports no ratio, plus an mm:ss elapsed
   ticker added specifically because a healthy slow extraction was indistinguishable from a hang.
   Stop/Reintentar; a distinct terminal "scanned PDF, no text" error with no retry.
5. **Validation** — two-pane: document left with extracted values highlighted as `<mark>`; form right.
   Origin banners: `stored-inference` → *"Se recuperó una extracción previa"*; `validation` → *"Este documento ya fue validado"*.
6. **"Validar documento"** — saves, writes corrections back to the reducer, navigates. **Navigation is never
   blocked by a save failure** (the endpoint didn't exist, so failure was the expected path).
7. **Finish** — writes the row to the local `.xlsx`; "Ver recomendaciones" opens it in the OS default app.

## API contract

| Call | Status |
|---|---|
| `POST /misc/document-extract` | existed |
| `POST /llm/data-extraction`, body `{document: {document_id, document: string[]}}` | existed |
| `GET /llm/recomendaciones/validation/document/{id}` | **never existed on the backend** |
| `POST /llm/recomendaciones/validation/document/{id}` | **never existed on the backend** |

Note the path mismatch: the frontend expected `/llm/recomendaciones/validation/...`; the backend
actually shipped `PUT /llm/data-extraction/{document_id}/validate`. **These two were never reconciled.**

GET envelope the client requires: `{document_id, prediction, validation, updated_at}`.

`loadRecomendacion` **fails open to `null`** on 404/405/501/network/schema errors → caller runs a fresh
extraction. The backend contract doc flags this as a data-loss risk once the endpoint ships: a transient GET
failure silently overwrites a stored human validation with a fresh LLM inference, with no audit trail.

Three-state decision table:

| GET result | Behaviour |
|---|---|
| 404 / null | `POST /llm/data-extraction`; `origin="inference"` |
| `prediction != null && validation == null` | no LLM call; `origin="stored-inference"`; info Callout |
| `validation != null` | no LLM call; `origin="validation"`; values from validation, suggestions still from prediction |

**⚠️ Destinatarios are re-paired between stored `validation` and `prediction` by array index.** The contract
doc calls this *"lo más importante de este contrato"*: deleting a destinatario before saving shifts indices
and misattributes both suggestion marks and document highlights. Proposed fixes: persist a stable
per-destinatario `id`, or document a content-based matching rule.

## Form

`useRecomendacionForm` — local `useState`, **not** the app's legacy uncontrolled `useForm`.

Two parallel objects: **`suggestions`** (the original inference, **frozen at first render** via `useRef`,
never mutated — so "what the model said" vs "what the human typed" is always diffable) and **`values`**.

| Field | Control | Notes |
|---|---|---|
| `numero_recomendacion` | TextField | free text |
| `fecha_recomendacion` | TextField | **free text, not a date picker** — the LLM returns prose |
| destinatarios | `DecisionTabs` + `+` / `×` | never below one |
| `.nombre`, `.cargo` | TextField | free text |
| `.destinatario_principal` | RadioGroup Sí/No | **per-destinatario — multiple principals allowed** |
| `.sector` | Select | 4 hardcoded options |
| `tema` | Select | 25 hardcoded temas |
| `subtema` | Select | `subtemaOptions(values.tema)` |
| `datos_personales` | RadioGroup | **tri-state: `null` = neither radio checked**, exports as empty |
| `contenido_para_publicar` | Textarea | new local Panda component |

Nothing read-only. No blocking validation, no required-field gate.

**tema→subtema cascade:** changing tema clears subtema **unless** the current subtema is still valid.

**Out-of-taxonomy handling (the pattern to keep):** a value the model returned that isn't in the local list
is **never silently discarded** — it is kept, injected as an extra `SelectOption`, and flagged with an inline
error: *"Tema fuera de la taxonomía definida"*, *"Subtema fuera de la taxonomía del tema seleccionado"*,
*"Sector fuera de la lista definida"*.

## ⚠️ The organigram picker was built, then deleted before merge

Commit `fdabef8`:
> "Remove the organigram-candidates feature entirely (candidatos_nombre/candidatos_cargo, OrganigramPicker,
> and all wiring/tests/docs) — **it added no value in the validation form**."

What it was, before removal:
- A plain `Select` beneath the `nombre` TextField, and a **second, fully independent** one beneath `cargo`.
  Never linked — "a person may no longer hold the cargo the organigram lists for them".
- An **action selector, not a state selector**: picking wrote the text into the sibling TextField and reset
  the picker to empty; it never reflected a "current" value.
- **`score` was never displayed and never thresholded** — only array order was meaningful:
  ```
  /** Escala dependiente del backend de búsqueda (0-100 fuzzy, ~0-1 embeddings/hybrid).
   *  NO comparar contra umbrales fijos ni mostrar crudo: sólo respetar el orden. */
  ```
- **`ruta_cargos` was the disambiguating affordance**, rendered as each option's `description`.
- Rendered nothing when empty — which was the norm, since the backend only populated candidates for `sector == "GCBA"`.

Note the whiplash: the plan (2026-08-02) recorded *"Persistencia de los candidatos de organigrama.
RESUELTO: se persisten… Es un requisito explícito del issue de backend"*; three days later the backend
contract doc rewrote that section to **"(ELIMINADO)"**.

**Design lesson for the new work:** the *nombre/cargo* candidate UX failed. The backend independently moved
to `candidatos_sector` — a single ranked list of *sectors*, which is a much smaller and more meaningful
choice. That is the shape to build on, not the deleted one.

## State

- `FileProvider` reducer + one action `SET_RECOMENDACION` and one optional `DocFile.recomendacion` field,
  whose presence is the extraction idempotency guard. **In memory only; dies with the session.**
- TanStack Query for the GET (`staleTime: Infinity`, `retry: false`); the extraction is a `useMutation`.
  Heavy StrictMode hardening: a synchronous latch keyed by `documentId`, an `AbortController` ref, and a
  `manualStop` flag because `cancelQueries` on a query with no prior data produces no error state.
- **Nothing recomendaciones-related is persisted client-side.** No electron-store, no new IPC.
  The only thing surviving a session is the `.xlsx`.

## Excel

`exceljs`, into the **existing shared** `~/Documents/AymurAI/set_de_datos.xlsx` as a second worksheet
`recomendaciones` (amber tab, frozen header). Zero main-process changes.
Forced a fix in `offline.ts`: `worksheets[0]` → `getWorksheet("set_de_datos")`.

```ts
export const RECOMENDACIONES_COLUMNS = [
  "NUMERO_RECOMENDACION", "FECHA_RECOMENDACION", "TEMA", "SUBTEMA",
  "DATOS_PERSONALES",              // "si" | "no" | "" (sin responder)
  "CONTENIDO_PARA_PUBLICAR",
  "DESTINATARIO_PRINCIPAL_NOMBRE", "DESTINATARIO_PRINCIPAL_CARGO", "DESTINATARIO_PRINCIPAL_SECTOR",
  "DESTINATARIOS",                 // "nombre — cargo (sector) [principal]" joined by " | "
  "CANTIDAD_DESTINATARIOS",
  "DOCUMENTO",                     // file name
  "DOCUMENT_ID",                   // UUID5, dedup key
  "FECHA_VALIDACION",              // ISO date, LOCAL timezone
] as const;
```

- **Upsert keyed by `DOCUMENT_ID`**, not a blind append.
- A relational `destinatarios` sheet was considered and **rejected** for MVP because *"es lo que se copia a
  defensoria.org.ar, que publica una entrada por recomendación"* — one row per recomendación is the
  publication unit.
- `FECHA_VALIDACION` uses a hand-rolled local-timezone formatter; `toISOString()` would misdate anything
  validated after 21:00 in UTC-3. Tests pin `TZ=America/Argentina/Buenos_Aires`.
- exceljs gotcha with its own commit: column `key`s are **not serialised** into the `.xlsx`, so a reloaded
  sheet has headers but no keys and `getCell(key)` silently writes blanks. Keys must be re-attached on every load.

## ⚠️ Duplicated catalogs in the frontend

`constants/recomendaciones/taxonomy.ts` — **313 lines**, `Record<string, string[]>`,
**25 temas / 232 subtemas hand-ported from the backend YAML @ commit `013e86ea`**:
```ts
// Generado desde backend resources/llm/defensoria_extractor.yml (commit 013e86ea).
// Si el backend cambia la taxonomía, este archivo queda desincronizado.
```
Upstream typos are preserved verbatim (`domicialiarios`, `Geriatricos`, `protesis`, `Líneas áereas`,
`PAMI.Traslados`, a double space) and **must be matched byte-for-byte** by any re-derivation, or the
out-of-taxonomy error path fires on legitimate LLM output.

Note the count discrepancy worth resolving: the frontend copy has **232** subtemas; the backend
`defensoria_taxonomy.json` has **242**. They had already drifted.

`constants/recomendaciones/sectores.ts` — 4 values (`GCBA`, `Organismos Nacionales`, `Obra Social / Prepaga`,
`Empresa`), **no provenance comment at all**.

A `GET /llm/data-extraction/taxonomy` endpoint was listed as a post-MVP nice-to-have and never built.

**No organigram data ever lived in the frontend** — candidates were always server-supplied per request.

## Tests

18 files, ~2700 lines. Highlights: `locate-value.test.ts` (20 cases — diacritic folding, index mapping,
combining marks, overlapping matches, fuzzy window refinement, empty-needle hang guard);
`submit-recomendacion.test.ts` (insert, upsert, two **real workbook read/write round-trips**);
`validation-to-excel.test.tsx` (the key integration test: validation → reducer → finish → Excel, asserting
the *typed* value lands in the row, not the inferred one); `useDataExtraction.test.tsx` (all four branches
of the decision table, StrictMode dedup, mid-GET abort).

## Answers

**(a) Source of truth.** *Intended:* the backend table — *"el frontend no mantiene una base propia"*.
*Actual:* because the validation endpoints were never implemented, every save silently failed and the
operational source of truth was **the local `~/Documents/AymurAI/set_de_datos.xlsx`, worksheet
`recomendaciones`** — single-machine, single-operator, no backup, shared with the unrelated Set de Datos
flow. The plan names the migration target: `GET /llm/recomendaciones/export?format=xlsx`,
*"porque la base tiene que sobrevivir a un cambio de máquina y consolidar validaciones de varios operadores"*.

**(b) Duplicated catalogs.** Two, both hardcoded TypeScript — a 313-line taxonomy fork with an explicit
"this will desync" comment, and a 4-value sector list with no provenance.

**(c) Organigram candidate selection.** Built, then deleted before merge as adding no value. Independent
`nombre`/`cargo` dropdowns, action-not-state, score never shown, `ruta_cargos` as the disambiguator.
