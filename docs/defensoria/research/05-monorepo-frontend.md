# 05 — Current monorepo frontend

`frontend/` (migrated in `84d23b9`). Electron 42 + React 19 + TS, electron-vite (desktop) / vite (web),
TanStack Router (file-based) + TanStack Query, zustand+persist for prefs, `useReducer`+Context for document
state, Panda CSS, `@aymurai/ui` (git dep), i18next (Spanish only), exceljs, zod, axios, vitest + Playwright CT.

## Routing

One shared 4-step wizard at `/$feature/{onboarding,preview,process,validation,finish}`; each step file
`if`-branches to a per-feature component. **There is no per-feature route subtree.**

`routes/$feature/route.tsx` mounts `APIProtected` → (`TranscriptionProvider` | `SummaryProvider` | nothing)
→ `FileProvider`. **All document state dies when you leave `/$feature/*`.**

Route slugs must stay in sync with `FEATURE_ROUTE_SLUGS` in
`aymurai/api/endpoints/routers/frontend/frontend.py`.

```ts
export enum FeatureFlowEnum {
  Dataset = "DATA_SET", Anonymizer = "ANONYMIZER",
  VoiceToText = "VOICE_TO_TEXT", Summarizer = "SUMMARIZER",
}
```

> Note: `frontend/src/renderer/src/features/` is **not** feature modules — it is 5 route guards
> (`APIProtected`, `RequireFile`, `RequireSummary`, `ReactQueryProvider`, `showToast`).
> Features are the enum + a `components/<feature>/` folder.

## Electron surface

Six IPC handlers: `EXPORT_FEEDBACK`, `EXCEL_READ`, `EXCEL_WRITE`, `EXCEL_OPEN`, `TASKBAR_NOTIFY`, `RUN_BATCH`.

Preload exposes exactly:
```ts
window.filesystem = { feedback: {export}, excel: {read, write, open} }
window.taskbar    = { notify }
window.electronAPI= { runBatch }
```
Renderer local file access is **only** `~/Documents/AymurAI/set_de_datos.xlsx` and
`~/Documents/AymurAI/feedback/*.json`. **No SQLite, no IndexedDB, no electron-store.**
Every call is guarded by `if (window.filesystem)` with a browser `downloadBlob` fallback.

## State

- **zustand only for prefs** — `store/useLocal.ts`, key `local-storage`, persisting `serverHost`,
  `tutorialsSeen`, `excludedTags`, `excludedWords`. **No Redux Toolkit. No dataset rows.**
- **Document state** is a Redux-*shaped* `useReducer` + Context: `State = DocFile[]`, 22 action types.
  ```ts
  type DocFile = {
    data: File; paragraphs?: Paragraph[]; pageCount?: number | null;
    selected: boolean; predictions?: PredictLabel[]; validated?: boolean;
    validationObject: FormData;      // <- the dataset row(s) for this document
  }
  ```
- `hooks/useForm` is a **hand-rolled uncontrolled ref registry** (`register`/`submit`/`addDecision`/
  `getDecisionValue`) — not `react-hook-form`, and not the `@tanstack/react-form` already in deps.
- `flatValidation()` cross-joins document-level fields × `DECISIONES[]` → one Excel row per decision.

## API client

One module-level axios instance. `baseURL = normalizeServerHost(host) + "/api"`, resolved **once at module
load**: `VITE_DEV_HOST` → persisted `serverHost` → `window.location.origin` (web) → undefined
(→ `APIProtected` bounces to `/home/host`).

Endpoints actually called: `/server/healthcheck`, `/misc/document-extract`,
`/datapublic/predict/{document_id}`, `/anonymizer/{predict,validation,disambiguate,anonymize-document}`,
`/convert/{odt/pdf,pdf/odt}`, `/llm/summarize[/stream]`, `/llm/summarize/validation/document/{id}`,
`/asr/transcribe/stream`, `/asr/validation/document/{id}`.

**`GET/POST /datapublic/validation/document/{id}` exists on the backend and is never called.**

## The Excel export

`exceljs`, **entirely client-side**; main only does `fs.readFile`/`fs.writeFile`. No SheetJS.

File name `set_de_datos.xlsx` — the constant is duplicated in `src/main/utils/excel.ts` and
`services/filesystem/excel/write.ts`. Directory `~/Documents/AymurAI/`. **No per-document naming, no
timestamping — one workbook, forever appended.**

`offline()` reads the existing workbook, `worksheet.addRows(rows)`, writes the whole file back —
a full read-modify-write per submission, with no dedup and no id column.

**65 columns**, fixed order (`utils/file/excelStructure.ts`), *"extracted from the original dataset spreadsheet"*:
```
N, NRO_REGISTRO, TOMO, FECHA_RESOLUCION, N_EXPTE_EJE, FIRMA, MATERIA, ART_INFRINGIDO, CODIGO_O_LEY,
CONDUCTA, CONDUCTA_DESCRIPCION, VIOLENCIA_DE_GENERO, V_FISICA, V_PSIC, V_ECON, V_SEX, V_SOC, V_AMB,
V_SIMB, V_POLIT, MODALIDAD_DE_LA_VIOLENCIA, FRASES_AGRESION, GENERO_ACUSADO,
PERSONA_ACUSADA_NO_DETERMINADA, NACIONALIDAD_ACUSADO, EDAD_ACUSADO, NIVEL_INSTRUCCION_ACUSADO,
GENERO_DENUNCIANTE, NACIONALIDAD_DENUNCIANTE, EDAD_DENUNCIANTE, NIVEL_INSTRUCCION_DENUNCIANTE,
FRECUENCIA_EPISODIOS, RELACION_Y_TIPO_ENTRE_ACUSADO_Y_DENUNCIANTE, HIJOS_HIJAS_EN_COMUN,
MEDIDAS_DE_PROTECCION_VIGENTES_AL_MOMENTO_DEL_HECHO, ZONA_DEL_HECHO, LUGAR_DEL_HECHO,
TIPO_DE_RESOLUCION, OBJETO_DE_LA_RESOLUCION, DETALLE, DECISION, ORAL_ESCRITA, HORA_DE_INICIO,
HORA_DE_CIERRE, DURACION, LINK, SI_NO_RECURRENTE, DECISION_CAMARA_DE_APELACIONES, ... LINK_CSJN
```

**Two live defects:**
1. Columns 46–65 (`LINK` … `LINK_CSJN`, the appeal/cassation chain) have **no form field** and are always blank.
2. Column 33 `RELACION_Y_TIPO_ENTRE_ACUSADO_Y_DENUNCIANTE` (no slash) never matches the enum value
   `RELACION_Y_TIPO_ENTRE_ACUSADO/A_Y_DENUNCIANTE` (with slash), so it is **also always blank** despite a
   working `<Select>`.

Neither is caught by tests: `excelStructure` ordering, `validationToArray`, `flatValidation`, and the
append-to-existing path have **no coverage**.

## Hardcoded catalogs

`components/validate-dataset/form-group/forms/options.json` — **74,764 bytes, 18 lists, ~985 options**:
`DETALLE` 299, `CONDUCTA` 225, `ART_INFRINGIDO` 177 (declared but the form uses free text — unused),
`CONDUCTA_DESCRIPCION` 84, `OBJETO_DE_LA_RESOLUCION` 35, `NACIONALIDAD` 28, `LUGAR_DEL_HECHO` 26,
`PERSONA_ACUSADA_NO_DETERMINADA` 21, `NIVEL_INSTRUCCION` 16, `CODIGO_O_LEY` 15, `RELACION…` 15,
`MODALIDAD` 9, `GENERO` 8, `ZONA` 8, `FRECUENCIA` 7, `MATERIA` 7, + three 2-item lists.

**Three conflicting copies of the same vocabulary exist:**
1. `options.json` (frontend) — what the UI offers
2. `aymurai/transforms/entity_subcategories/subcategories.py` (backend) — what the model returns in
   `aymurai_label_subclass`, matched against `options.json` ids by `Suggester.select()`
3. `aymurai/database/meta/datapublic/categories.py` (backend) — Python enums whose values **differ** in
   accents, spaces and membership (`"habeas corpus"` vs `habeas_corpus`; `NO_RESPONDE` vs `sd`;
   `"esporádico"` vs `esporadico`). Currently unenforced (attached to the dead model).

`constants/config.ts` also hardcodes `DATASET_URL` — a specific Google Sheets document used as the
web-mode "Ver set de datos" target.

## ⚠️ Client identity — there is none

No user, no login, no client/tenant/workspace id, no device id, no session id, no auth header, no cookie,
no API key. `/home/host` is a **server-address picker**, not authentication.

Google OAuth2 is fully dead — referenced only in stale docs, a stale comment, and unused
`types/spreadsheet.ts`. The one code path is
`if (isOnline) { console.warn("Online submissions were disabled."); } else { await offline(...) }`
with `isOnline` hardcoded `false`.

The only value resembling an identifier that reaches the server is the content-derived UUID5 `document_id`,
**identical across users for the same file**. A shared server cannot distinguish clients today.

## House pattern for a server-persisted feature (follow this)

From the summarizer (freshest) and ASR:
1. A zod schema in `schema/`
2. A `{save, load}` client behind a **one-line switch module** — `services/aymurai/summaryValidationClient.ts`:
   *"no other file in this codebase should import summaryValidation.ts's implementations directly — always
   go through this module."* A `noopSummaryValidation.ts` in-memory adapter exists for tests.
3. A `useReducer` context provider mounted in `routes/$feature/route.tsx`
4. Mutation factories in `services/aymurai/queries.ts` — `CONVENTIONS.md` makes this **mandatory**:
   *"Backend access goes through the query/mutation factories in `queries.ts`. Do not scatter ad-hoc
   `useQuery`/`useMutation` calls with inline keys"*
5. Restore-on-mount guarded by `hasValidation` / `hasUserEdited` / empty-document

**The Set de datos feature predates all of this and follows none of it.**

`CONVENTIONS.md` also forbids hardcoded Spanish strings outside `constants/i18n/locales/es/`, and forbids
renderer imports of Node/Electron APIs.

## Tests

~98 vitest files + 6 Playwright CT specs (responsive layout only, six viewports). Coverage is heaviest on
the newest code (VTT 14, summarizer 7). **Dataset export logic has no coverage** — which is why the two
blank-column defects survive.

Gates: `pnpm validate` (biome + `tsc --noEmit` × 2 projects) and `pnpm test` must both exit 0.

## `frontend/docs/`

- `excel/filesystem.md` — accurate description of today's persistence
- `excel/spreadsheet-api.md` — **obsolete** (Google Sheets/OAuth)
- `aymurai.md` — **obsolete**, still claims a Sheets connection per validated document
- `validator/README.md` — encodes a real requirement: the per-section "Datos correctos" button
  validates that group only; the footer button is what advances
- `superpowers/` — 11 plans + 2 specs, all VTT/summarizer/UI. **No prior art for Set de datos.**
  Useful as format templates: `specs/2026-07-22-resumen-de-documento-design.md`,
  `plans/2026-08-04-home-host-unification.md`
- `features.md` — **not** a product feature list; stale lint-debt spec

## Answers

**(a) Where Set de datos rows live today.** In-memory only during one wizard run
(`DocFile[].validationObject` in a context that unmounts on route exit), then appended as flat rows to a
single on-disk workbook via ExcelJS read→`addRows`→write. Nothing in localStorage, nothing in a database,
nothing sent to the backend. **In web mode there is no accumulation at all.**

**(b) Is Excel the source of truth?** Yes. `set_de_datos.xlsx` is the de-facto persistent database:
the only durable store of validated rows, the only cross-document accumulator, the only thing
"Ver set de datos" opens. No schema versioning, no ids, no dedup, no concurrency control, unrecoverable if
the user edits or deletes it, and 21 of its 65 columns can never be populated.

**(c) Client identity?** None. See above.
