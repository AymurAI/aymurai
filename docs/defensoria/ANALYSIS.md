# Defensoría — análisis del estado actual y divergencias

**Fecha:** 2026-08-25 · **Autor:** sesión de charting `/wayfinder`
**Alcance de este documento:** secciones **A, B y C** del entregable obligatorio — la *reconstrucción*.
Las secciones D–L (modelo de dominio, flujo, prompts, API, frontend, migraciones, testing, riesgos, plan)
son **decisiones**, no hallazgos, y se resuelven ticket a ticket sobre `map.md`.

Fuentes: [`research/`](research/) — la reconstrucción completa, con los paths y símbolos concretos.

---

## ⚠️ Correcciones a la documentación previa

Antes de nada, tres hechos que invalidan material existente:

1. **El clon local de `backend` estaba desactualizado.** `feature/defensoria` apuntaba a `f37716f8`
   (2026-06-25); el endpoint **no existe en ningún ref de ese commit**. El tip real es `66109cbf`
   (2026-08-23). Se hizo `git fetch` (sólo refs de seguimiento remoto; no se tocó ninguna branch ni el
   working tree). Los paths del plan previo que apuntan a `collective-ai/aymurai-projects/backend` también
   son incorrectos: los repos están en `collective-ai/{backend,desktop-app}`.

2. **`docs/superpowers/specs/2026-08-05-defensoria-data-extraction-design.md` está obsoleto por dos vías
   independientes:**
   - Fue escrito contra `013e86ea` (2026-07-21), el **primero de cinco** commits del endpoint. Los cuatro
     posteriores agregaron `sector_matching.py` (+443 líneas) y **toda la capa de persistencia**.
   - Planifica ramificar de `feat/openai-compatible-llm-providers` (PR #33) y usar `get_llm_provider`. Esa
     factory y la ABC `LLMProvider` **fueron eliminadas después**, por
     `docs/superpowers/specs/2026-08-18-llamacpp-only-llm-provider-design.md`. Verificado: cero
     coincidencias de `get_llm_provider`, `class LLMProvider` u `ollama` bajo `aymurai/`.

   Ese spec y su plan quedan como **antecedente histórico**. El plan no debe ejecutarse tal como está.

3. **Sobre `llama.cpp` vs `ollama`:** el brief dice que "no está contemplada la integración de `llama.cpp`
   … en detrimento de `ollama`". Leído como descripción de **las branches históricas**, es correcto: el
   backend histórico usa `OllamaLLMProvider`. El monorepo, en cambio, es **llama.cpp exclusivamente**, por
   decisión de diseño aprobada. El port debe reemplazar la construcción del provider, no re-apuntarla.

---

## A. Estado actual del monorepo

### A.1 Forma general

Monorepo con backend Python (`aymurai/`) y frontend Electron+React (`frontend/`, migrado en `84d23b9`).
No hay paquetes compartidos: **no existe ningún artefacto de tipos o catálogos común entre backend y
frontend.** Todo contrato cruzado es convención documentada, y en varios casos ya divergió (§C).

### A.2 Persistencia

`aymurai/database/` con el patrón: `meta/<feature>.py` (SQLModel `Base`/`table=True`/`Create`/`Update`/`Read`)
→ re-export en `schema.py` (barrel `# ruff: noqa: F401`; **lo que no se re-exporta es invisible para
Alembic**) → revisión Alembic escrita a mano → `crud/<x>.py` con `<x>_get` y `<x>_create_or_update`.

Tablas actuales: `anonymization_{document,paragraph,document_paragraph}`,
`datapublic_{document,paragraph,document_paragraph}`, `audio_transcription`, `llm_summarization`.

Puntos críticos:
- **Identidad content-addressed en todo el sistema**: `document_id = uuid5(blake2b16(file_bytes))`,
  `paragraph_id = uuid5(blake2b16(text))` (`aymurai/database/utils.py`). No hay ids opacos.
- **Cero índices no-PK en toda la base.** Ninguna consulta documento→párrafo usa índice.
- `get_session()` crea y destruye **un `Engine` nuevo por request**. Sin pool, sin `busy_timeout`, sin WAL.
  Con SQLite y varios clientes concurrentes esto produce `database is locked`.
- Las migraciones corren **in-process en el lifespan de FastAPI** (`aymurai/api/main.py:51-53`),
  compitiendo entre workers.
- `make alembic-regenerate` es **destructivo** (borra la DB y todas las revisiones). Por eso sólo hay tres.
- Los tests construyen el esquema con `SQLModel.metadata.create_all`, así que **las migraciones nunca se
  ejercitan** y la deriva esquema/migración es invisible.

### A.3 Aislamiento de datos — **no existe**

Búsqueda exhaustiva de `user|client|tenant|workspace|owner|session|auth|jwt|login`, `fastapi.security`,
`HTTPBearer`, `OAuth2`, `APIKeyHeader`:

- Cero autenticación, cero autorización.
- El conjunto **completo** de dependencias FastAPI del backend es `Depends(get_session)` y
  `Depends(get_transcribe_base_url)`.
- **Ninguna tabla tiene columna de usuario/owner/tenant.**
- Sin middleware de auth; sólo CORS y un header `X-Process-Time`.

Consecuencias: cualquiera que alcance la API puede leer **y sobrescribir** la validación de cualquier
documento conociendo su UUID5 — que además es **derivable offline de los bytes del archivo**. Los párrafos
son **filas globalmente compartidas**: dos usuarios que procesen documentos con un párrafo en común
comparten la fila, y la segunda predicción sobrescribe la primera.

> **Implicación de diseño.** El requisito "todos los clientes ven el dataset íntegro" no requiere *romper*
> aislamiento, porque **no hay aislamiento que romper**. El trabajo real es el inverso: introducir un
> concepto explícito de alcance para no cerrarnos la puerta a multi-tenancy futura. Ver ticket 03.

### A.4 Flujo actual del "Set de datos"

`POST /api/datapublic/predict/{document_id}` por párrafo → pipeline NER
(`resources/pipelines/production/datapublic/pipeline.json`, **configuración ejecutable**: resuelve strings
dotted vía `importlib`):

`FlairTextNormalize` → `FlairModel` (BETO + BiLSTM-CRF, HF Hub) → `DecisionEmbeddingBagBinRegex` →
`RegexSubcategorizer` → `DatetimeFormatter` → 4× `SentenceTransformerSubcategorizer` → `ArticleSubcategorizer`.

Los subcategorizadores corren **en orden de prioridad** — cada uno saltea entidades que ya tienen
`aymurai_label_subclass`, así que regex gana sobre embeddings.

El *semantic retrieval* que ya existe: `SentenceTransformerSubcategorizer` indexa un catálogo fijo de
`subcategories.py` (Python, no DB) en un `.npz`, busca por producto interno bruto (**no coseno** — nada se
normaliza L2, pese al docstring) e hibrida con BM25 puro-Python al 50%. Devuelve top-5.

**El "Set de datos" en sí no tiene representación en el servidor.** Sus 65 columnas viven sólo en
`frontend/src/renderer/src/utils/file/excelStructure.ts`. La tabla `datapublic_document.validation` es un
`RootModel[dict]` sin validación alguna, y **el frontend nunca la llama**.

### A.5 Dónde vive hoy el dataset

En memoria durante una corrida del wizard (`DocFile[].validationObject`, en un contexto que se desmonta al
salir de `/$feature/*`), y luego **anexado a un único `.xlsx` local** en
`~/Documents/AymurAI/set_de_datos.xlsx` vía ExcelJS read→`addRows`→write.

**Ese archivo es la base de datos de facto**: único almacén durable, único acumulador entre documentos, sin
versionado, sin ids, sin dedup, sin control de concurrencia, irrecuperable si el usuario lo edita o borra.
En modo web no hay acumulación en absoluto. Además, 21 de sus 65 columnas **nunca pueden llenarse** (20 no
tienen campo de formulario; 1 falla por un mismatch de nombre con/sin `/A`), y nada de esto está cubierto
por tests.

### A.6 Infraestructura LLM

**No hay abstracción de providers.** `LlamaCppLLMProvider` (subclase de `OpenAICompatibleLLMProvider`) es
el único backend. Aporta contabilidad exacta de tokens contra llama-server (`/tokenize`, `/apply-template`,
`/v1/models`), y un guard *fail-closed*: sin `LLAMACPP_BASE_URL` lanza `ValueError` en vez de dejar que el
SDK de OpenAI apunte a `api.openai.com` — explícitamente para no filtrar cuerpos de documentos judiciales.

**Salida estructurada: hoy no se usa en ningún lado.** Cero `response_format`, `json_schema`, `grammar`,
`guided_*`; y hay un test que **afirma que `response_format` no se envía**. Pero `_build_request_kwargs` es
un pass-through, así que para un llamador Python está a una línea de distancia. Lo que **no** se puede hoy:
`grammar`/GBNF nativos de llama.cpp (requieren `extra_body=`, no expuesto), y exponerlo por HTTP
(`GenerationOptions` es `extra="forbid"`).

**Validación de salida y reintentos: prácticamente inexistentes.** La totalidad de la validación es
`if not generated.strip(): raise EmptyCompletionError`. Cero reintentos en todo el camino LLM.

Prompts: un solo YAML, releído del disco en cada request, formateado con `str.format` — **cualquier `{`
o `}` literal en el texto rompe con 500**, lo cual es un riesgo directo para un prompt que lleve un JSON
Schema. Sin versionado; la clave de caché es sólo el texto fuente, así que **editar el prompt no invalida
nada**.

Reutilizable tal cual: `chunking.py` (puro, testeado) y toda la maquinaria de `ContextBudget` /
`prepare_run` (medición con centinela, preflight exacto por ventana).

**No hay vector store de ningún tipo.** Ni FAISS, ni chroma, ni sqlite-vec, ni pgvector. Todo es NumPy en
memoria sobre un `.npz`.

`docker-compose.yml`: servicios `llamacpp{,-gpu}`, `aymurai-api{,-gpu}`, `aymurai-api-full{,-gpu}`,
`coro{,-gpu}`. **Sin servicio ollama.** Contexto por defecto `-c 16384` (no 32768). El *reasoning* es una
decisión de arranque del servidor (`LLAMA_ARG_REASONING`, `LLAMA_ARG_THINK_BUDGET`), no per-request.

### A.7 Frontend

Un único wizard de 4 pasos `/$feature/{onboarding,preview,process,validation,finish}`; cada paso hace
`if`-branch al componente de la feature. **No hay subtree de rutas por feature, ni ninguna superficie de
administración.**

Estado: zustand+persist sólo para preferencias (`serverHost`, `tutorialsSeen`, …); el estado de documentos
es `useReducer`+Context y **muere al salir de la ruta**. `hooks/useForm` es un registro de refs
no-controlado hecho a mano.

**No existe identidad de cliente.** Ni usuario, ni login, ni tenant, ni device id, ni header de auth.
`/home/host` es un selector de dirección de servidor. El único valor con forma de identificador que llega
al servidor es `document_id`, **idéntico entre usuarios para el mismo archivo**.

Patrón de casa para una feature persistida en servidor (summarizer/ASR, lo más nuevo): schema zod →
cliente `{save, load}` detrás de un módulo switch de una línea → provider `useReducer` → factories en
`services/aymurai/queries.ts` (**obligatorio** por `CONVENTIONS.md`) → restore-on-mount con guards
`hasValidation`/`hasUserEdited`. **El Set de datos no sigue nada de esto.**

---

## B. Funcionalidad histórica de la Defensoría

### B.1 Backend (`backend@feature/defensoria` = `66109cbf`)

~2.526 líneas: 6 archivos de endpoint (~2.019) + capa de persistencia completa (~507) con 3 migraciones.
**El spec previo describe menos de la mitad de esto.**

Dos endpoints:
- `POST /llm/data-extraction?use_cache=<bool>`
- `PUT /llm/data-extraction/{document_id}/validate`

**Flujo:** cache read por `document_id` → si hay fila, devuelve `validation or prediction` **sin llamar al
LLM ni al organigrama** → si no, prompt de ~15-16 KB (persona + 9 guidelines + campos + taxonomía completa
+ JSON schema) con el documento entero como user message, **sin chunking** → parseo tolerante
(`_parse_json_object` saltea fences y prosa) → validación pydantic + taxonomía → reintentos → inferencia de
sector por destinatario → persistencia.

**Validación de taxonomía:** `tema` es `Literal[tuple(_TAXONOMY)]`; `subtema` es `str` policiado por un
validador que, al fallar, le devuelve al modelo **la lista de subtemas válidos para el tema que eligió**.
Match por igualdad exacta de string, sin normalización ni fuzzy.

**⚠️ El prompt de reintento crece monotónicamente:** cada fallo reconstruye el system prompt como el prompt
original *entero* más el error y la salida anterior — el intento 3 anida al 2. Peor caso: 3 llamadas con el
documento completo.

**Inferencia de sector** — la parte con más lógica propia:
1. Lookup exacto en `llm_validated_destinatario` (por nombre normalizado, fallback por cargo), tomando la
   fila más reciente. Se **antepone** como candidato `origen_campo="validado"`, `score=1.0`.
2. `organigram_matching.search_candidates` → dos listas independientes (nombre / cargo), **nunca
   fusionadas**, porque "la persona X puede ya no ocupar el cargo Y que el organigrama le asigna".
3. `sector_matching` resuelve el sector específico, en uno de dos modos.

**`sector_mode="hierarchy"` (default)** no toca ningún CSV: lee `ruta_cargos` y aplica 5 reglas
estructurales en orden — organismos autónomos (AGC, AGIP, IVC, COPIDIS) que **anulan a su padre
administrativo**; luego Ministerio; luego Secretaría (excluyendo Subsecretaría por el `startswith`);
luego Jefatura de Gabinete; luego el primer nivel real.

**Defaults afinados, con justificación registrada:**
- `sector_mode="hierarchy"` — el CSV cubre 16 sectores contra ~33 del organigrama: *"si el sector real no
  está en esas 16 filas, el modo csv no puede acertar nunca … tiene un techo de cobertura estructural"*.
- `nombre_origen_weight=0.0` — *"una decisión deliberada, no sólo un ajuste fino"*: un nombre puede matchear
  altísimo por casualidad textual aunque la persona ya no ocupe el cargo, y esa evidencia le gana a la de
  cargo, que es la señal durable.
- `hybrid_weight=0.25` — favorece fuzzy sobre embeddings.

**Persistencia:** `llm_data_extraction` (una fila por documento: `document`, `prediction`, `validation`,
`config` con todos los parámetros resueltos) y `llm_validated_destinatario` (índice aprendido
cross-documento nombre/cargo→sector, con historial por documento). Dos cachés independientes y explícitamente
no solapados. **Nunca hubo export a Excel en el servidor.**

**Tests: ninguno.** Cero tests tocan `data_extraction`, `organigram_matching`, `sector_matching` o las tablas.

### B.2 Frontend (`desktop-app@feat/recomendaciones-defensoria`)

30 commits, 69 archivos, +8538/−326, sobre `origin/develop`. **Nunca mergeado.**

Quinta `FeatureFlowEnum` dentro del wizard existente. Un documento por corrida. Pantalla de validación a dos
paneles: documento con los valores extraídos resaltados (localizador exacto+fuzzy propio con
`fastest-levenshtein`) y formulario a la derecha.

**Patrón valioso a conservar:** `suggestions` (la inferencia original, **congelada en el primer render** vía
`useRef`, nunca mutada) vs `values` (lo que el humano edita) — así "lo que dijo el modelo" vs "lo que tipeó
la persona" siempre es diffeable. Y el manejo *keep-and-flag* de valores fuera de catálogo: nunca se
descartan, se inyectan como opción extra y se marcan con un error inline.

**Excel:** hoja `recomendaciones` dentro del **mismo** `set_de_datos.xlsx`, 14 columnas, **upsert por
`DOCUMENT_ID`**. Se descartó explícitamente una hoja relacional de destinatarios porque *"es lo que se copia
a defensoria.org.ar, que publica una entrada por recomendación"* — **una fila por recomendación es la unidad
de publicación**. Fecha en zona horaria local (UTC la correría un día).

**Dos bugs latentes documentados y no arreglados:** los destinatarios se re-emparejan entre `validation` y
`prediction` **por índice de array** (se rompe apenas alguien borra uno antes de guardar), y un fallo
transitorio del GET sobrescribiría silenciosamente una validación humana con una inferencia fresca.

### B.3 El resultado negativo más importante

**El picker de candidatos de organigrama se construyó, se probó y se borró antes del merge** (`fdabef8`):
*"it added no value in the validation form"*. Eran dos dropdowns independientes (nombre / cargo), acción y
no estado, con el score **nunca mostrado ni umbralado** y `ruta_cargos` como único desambiguador.

En paralelo, el backend migró de `candidatos_nombre`/`candidatos_cargo` a un único
**`candidatos_sector`** — una lista rankeada de *sectores*, que es una elección mucho más chica y
significativa. **Esa es la forma sobre la que hay que construir, no la que se borró.**

---

## C. Divergencias y clasificación

### C.1 Divergencias estructurales

| Eje | Histórico | Monorepo actual | Impacto |
|---|---|---|---|
| Provider LLM | `OllamaLLMProvider` directo | llama.cpp exclusivo, sin ABC ni factory | El port debe reescribir la construcción |
| Contexto | `num_ctx: 32768` per-request | Fijado al arrancar el servidor, default **16384** | `num_ctx` se descarta; riesgo de truncado silencioso |
| Reasoning | n/a | `LLAMA_ARG_*` al arranque; consume `max_tokens` | Puede truncar JSON a mitad |
| Taxonomía | String YAML anidado en YAML, en disco | — | Debe pasar a la DB (requisito nuevo) |
| Catálogos | Hardcodeados en 2 lugares (backend YAML + 313 líneas TS) | 3 copias en conflicto ya existen para datapublic | Fuente única obligatoria |
| Organigrama | JSON en disco, **no versionado, inexistente** | — | Debe pasar a la DB y ser editable (requisito nuevo) |
| Persistencia | 2 tablas, por documento | Mismo patrón disponible | Reutilizable conceptualmente |
| Dataset | No existe como entidad | No existe como entidad | **Faltante en ambos** |
| Export | Ninguno server-side | Ninguno server-side (`openpyxl` ausente) | **Faltante en ambos** |
| Identidad/alcance | Ninguna | Ninguna | **Faltante en ambos** |
| Contrato validación | `PUT /llm/data-extraction/{id}/validate` | — | El frontend histórico esperaba **otro path** (`/llm/recomendaciones/validation/...`); nunca se reconciliaron |
| Tests | Ninguno | Playbook de mocking maduro | Se escriben desde cero |

### C.2 Clasificación de los elementos históricos

#### Reutilizable casi directamente

- **`organigram_matching.py`: las regexes de limpieza de cargo** (`CARGO_ROLE_PREFIXES` con su orden
  load-bearing, `CARGO_PARENT_MARKERS` con lookahead, `CARGO_NOISE_PATTERNS`) y `normalize_text`. Es
  conocimiento de dominio destilado, difícil de reconstruir. Conservar el orden de la tupla textualmente.
- **`sector_matching.resolve_sector_from_hierarchy`**: las 5 reglas estructurales, incluidos los organismos
  autónomos y la exclusión de Subsecretaría. Es lógica de dominio pura sobre una ruta; se adapta al nuevo
  modelo cambiando de dónde sale la ruta.
- **`_parse_json_object`**: parseo tolerante de la salida del modelo. Sigue siendo útil como *fallback*
  incluso con salida estructurada.
- **El validador de taxonomía que devuelve los subtemas válidos al reintentar.** Excelente patrón.
- **Frontend: `suggestions` congeladas vs `values`**, y el *keep-and-flag* de valores fuera de catálogo.
- **Frontend: el localizador exacto+fuzzy y el resaltado en el documento**, con su decisión de resaltar
  sólo campos citables (`numero`, `fecha`, `nombre`, `cargo`) y no las clasificaciones.
- **`chunking.py` y `ContextBudget` del monorepo** (no del histórico) — reutilizables tal cual.

#### Reutilizable conceptualmente, requiere adaptación

- **Las dos tablas de persistencia.** El patrón (fila por documento con `prediction`/`validation`/`config`;
  índice aprendido de validaciones) es correcto y hay que conservarlo — pero `llm_validated_destinatario`
  guarda `sector` como **string**, y el requisito nuevo exige referencias por **ID canónico** a un
  organigrama persistido.
- **El caché por `document_id` con `use_cache`.** Correcto, pero la clave debe considerar que ahora la
  taxonomía y el organigrama **cambian**: una extracción cacheada contra una taxonomía vieja necesita ser
  al menos trazable.
- **La estrategia de reintento con feedback del error.** El concepto es bueno; el crecimiento monotónico
  del prompt no. Debe acotarse.
- **`candidatos_sector` como forma de la respuesta.** Sobrevive, pero `sector: str` debe pasar a
  `sector_id` canónico con label denormalizado.
- **El export a Excel del frontend histórico** (14 columnas, upsert por `DOCUMENT_ID`, una fila por
  recomendación): las **columnas y la semántica** se conservan como contrato; la **generación** se mueve al
  servidor.

#### Obsoleto

- **`OllamaLLMProvider` y todo lo que dependa de `get_llm_provider`.**
- **`DEFAULT_OPTIONS = {"num_ctx": 32768, ...}`** como control de contexto: bajo llama.cpp es decisión de
  arranque del servidor.
- **`sector_mode="csv"` y `destinatario_por_sector.csv`.** El propio upstream lo declaró con techo de
  cobertura estructural y lo desactivó por default. Con un organigrama en DB y editable, deja de tener
  sentido mantener un segundo catálogo paralelo — que es exactamente lo que el brief prohíbe.
- **`temas_disponibles`/`subtemas_disponibles` como "no lo hace el backend".** Esta decisión se **revierte
  deliberadamente**: el backend pasa a ser la fuente de verdad de la taxonomía.
- **La taxonomía hardcodeada del frontend** (313 líneas) y `sectores.ts`.
- **El `OrganigramPicker` de dos dropdowns nombre/cargo.** Evaluado y descartado por el product owner.
- **El `.xlsx` local mutable como fuente de verdad.**
- **`aymurai/api/endpoints/routers/datapublic/dataset.py` y `routers/database/datapublic.py`**: código
  muerto que ni siquiera importa. No portar, no revivir; a lo sumo tomar el patrón de export
  (pandas → tempfile → `FileResponse` + `BackgroundTask(os.remove, ...)`).
- **`aymurai/database/meta/datapublic/categories.py`**: enums sin usar, en conflicto con el frontend.
- **`aymurai/utils/openai_httpx_compat.py`**: no portar.

#### Faltante (no existe en ninguno de los dos mundos)

1. **Taxonomía persistida y editable**, con IDs estables y jerarquía.
2. **Organigrama persistido y editable**, jerarquía de profundidad arbitraria, con IDs estables que
   sobrevivan renombres y reorganizaciones.
3. **El dataset como entidad de primera clase** en el servidor, tipado por campo, con nulos y categorías.
4. **Semántica explícita de alcance** ("instance-wide") que no sea "no hay control alguno".
5. **Export a Excel server-side** desde la fuente de verdad persistida. `openpyxl` ni siquiera es dependencia.
6. **Salida estructurada del LLM** (JSON Schema / grammar) y su validación estricta con reintento acotado.
7. **Estrategia de contexto para el organigrama** que no meta el árbol entero en cada prompt.
8. **Cualquier superficie de administración en el frontend.** No existe ni el concepto de una pantalla de
   configuración.
9. **Tests de todo lo anterior.** El histórico no tiene ninguno.
10. **Invalidación/trazabilidad de caché ante cambios de configuración dinámica.**

### C.3 Los tres problemas de fondo

Por debajo de la lista, hay tres tensiones que ordenan todo el diseño posterior:

1. **Catálogos duplicados.** Ya existen tres copias en conflicto del vocabulario de datapublic
   (`options.json`, `subcategories.py`, `categories.py`) y dos de la taxonomía de Defensoría. Cualquier
   diseño que no establezca una fuente única y un mecanismo de propagación agrega la cuarta.

2. **El `.xlsx` como base de datos.** No es un detalle de export: es el modelo operativo actual, y el
   requisito de "servidor como fuente de verdad" lo reemplaza de raíz. Mantener ambos sería mantener dos
   fuentes de verdad divergentes.

3. **Strings como claves relacionales.** El histórico guarda `sector` como texto, la taxonomía como texto,
   y el frontend compara por igualdad exacta de string incluyendo erratas del upstream. Con catálogos
   editables esto se rompe en el primer renombre. La entrada de IDs canónicos es la decisión estructural
   central del trabajo.
