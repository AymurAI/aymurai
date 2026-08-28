# Defensoría — diseño consolidado y plan de implementación

**Fecha:** 2026-08-27 · **Secciones D–L** del entregable obligatorio.
Las secciones A (estado actual), B (funcionalidad histórica) y C (divergencias) están en
[`ANALYSIS.md`](ANALYSIS.md). Las decisiones de fondo, con su evidencia y las alternativas descartadas, están en
[`docs/adr/`](../adr/).

**Nombres:** todo en inglés — rutas, tablas, columnas, endpoints, settings y **las claves del JSON del
LLM**. En castellano queda sólo lo que ve una persona: el **texto** del prompt, la copy de UI y el workbook
exportado. Ver el **apéndice M**.

---

## D. Modelo de dominio

### D.1 Catálogos

```
topic
  id       UUID  PK
  code     str   UNIQUE NULL-able      -- `area` del JSON: ACC, AMB, SM…
  name     str   NOT NULL
  active   bool  NOT NULL DEFAULT true
  order    int   NOT NULL
  created_at, updated_at

subtopic
  id        UUID  PK
  topic_id  UUID  FK topic  NOT NULL
  code      str   UNIQUE NULL-able     -- `codigo` del JSON: ACC20221, SMCA20226…
  name      str   NOT NULL
  active    bool  NOT NULL DEFAULT true
  order     int   NOT NULL
  created_at, updated_at
  UNIQUE (topic_id, name)

macro_sector
  id      UUID  PK
  code    str   UNIQUE NOT NULL        -- GCBA | ORGANISMOS_NACIONALES | OBRA_SOCIAL_PREPAGA | EMPRESA
  name    str   NOT NULL               -- etiqueta editable
  active  bool, order int
  created_at, updated_at
```

`code` nulable en `topic`/`subtopic`: una categoría creada desde la app todavía no tiene código oficial.
`macro_sector.code` **no** es nulable, porque **gobierna comportamiento**: sólo `GCBA` dispara el cruce con
el organigrama, y esa lógica se apoya en el código, nunca en la etiqueta.

### D.2 Organigrama

```
organigram_unit
  id          UUID  PK               -- uuid5(NS, "<ruta_cargos>#<idx>"), computado SÓLO en el seed
  parent_id   UUID  FK self NULL     -- NULL sólo en la raíz
  name        str   NOT NULL         -- el "cargo". NO único (463/489)
  acronym     str   NULL             -- la "sigla". NO única (6 duplicadas legítimas)
  short_name  str   NULL             -- display cuando `name` es largo (AGC, AGIP, Jefatura de Gabinete)
  is_sector   bool  NOT NULL         -- reemplaza las 5 reglas hardcodeadas
  active      bool  NOT NULL
  order       int   NULL
  created_at, updated_at

organigram_holder
  id          UUID  PK
  unit_id     UUID  FK organigram_unit NOT NULL
  name        str   NOT NULL         -- el titular; string, NO una entidad `person`
  is_current  bool  NOT NULL DEFAULT false
  created_at, updated_at
  UNIQUE INDEX (unit_id) WHERE is_current = true
```

- **`sector(unit)` = el ancestro-o-sí-mismo más profundo con `is_sector = true`.** Verificado equivalente a
  las 5 reglas históricas en **489/489** nodos.
- **`ruta_cargos` se computa, no se materializa** — 520 nodos entran en memoria.
- El UUID se deriva del path **una sola vez, en el seed, y nunca se recomputa**: recalcularlo tras un
  renombre rompería todas las referencias.

### D.3 Dataset

```
dataset
  id    UUID PK
  code  str UNIQUE NOT NULL          -- "defensoria-recommendations"
  name  str NOT NULL
  created_at, updated_at

extraction                            -- caché de inferencia, por documento
  id           UUID  PK               -- == document_id (content-addressed)
  file_name    str   NULL             -- necesario para el export
  source_text  JSON  NOT NULL         -- texto fuente; alimenta la vista de corrección
  prediction   JSON  NOT NULL         -- lo que devolvió el modelo, VERBATIM (labels como strings)
  config       JSON  NOT NULL         -- parámetros resueltos + hash de catálogos
  created_at, updated_at

recommendation                        -- la fila del dataset
  id                        UUID  PK
  dataset_id                UUID  FK dataset  NOT NULL
  document_id               UUID  NOT NULL          -- == extraction.id
  recommendation_number     str   NULL
  recommendation_date_text  str   NULL              -- prosa verbatim del modelo
  recommendation_date       date  NULL              -- normalizada cuando parsea
  topic_id                  UUID  FK topic     NULL
  subtopic_id               UUID  FK subtopic  NULL
  personal_data             bool  NULL              -- TRI-ESTADO: null = sin responder
  publishable_content       str   NOT NULL
  created_at, updated_at
  UNIQUE (dataset_id, document_id)

recipient
  id                  UUID  PK
  recommendation_id   UUID  FK recommendation NOT NULL
  order               int   NOT NULL
  raw_name            str   NULL              -- verbatim del LLM
  raw_position        str   NULL              -- verbatim del LLM
  normalized_name     str   NULL  INDEX       -- para el índice aprendido
  normalized_position str   NULL  INDEX
  is_primary          bool  NOT NULL
  macro_sector_id     UUID  FK macro_sector    NULL
  unit_id             UUID  FK organigram_unit NULL
  sector_id           UUID  FK organigram_unit NULL   -- desnormalizado
  created_at, updated_at
```

**Invariante central:** *una fila de `recommendation` existe únicamente después de la validación humana.*
La inferencia cruda vive en `extraction`. De ahí que todo `recipient` sea, por construcción, revisado por
una persona — lo que hace correcto usar `recipient` como índice aprendido sin flag "confirmado".

**El texto verbatim del modelo se conserva siempre** (`raw_name`, `raw_position`,
`recommendation_date_text`) junto a la referencia resuelta. Nunca se reemplaza.

`sector_id` desnormalizado a propósito: si mañana se reorganiza el árbol por encima de la unidad, el sector
con el que se publicó la recomendación **no cambia retroactivamente**.

### D.4 Índices

El repo tiene hoy **cero índices no-PK**. Este diseño los necesita en la migración:
`recommendation(dataset_id)`, `recommendation(document_id)`, `recipient(recommendation_id)`,
`recipient(normalized_name)`, `recipient(normalized_position)`, `organigram_unit(parent_id)`,
`organigram_holder(unit_id)`, `subtopic(topic_id)`, y el índice único parcial de `is_current`.

---

## E. Flujo de datos

```
documento (.pdf/.docx)
   │
   ├─► POST /misc/document-extract           → párrafos + document_id (hash de contenido)
   │
   ├─► POST /llm/data-extraction?use_cache=true
   │      │
   │      ├─ ¿hay `recommendation` para este document_id? → devolverla, fin
   │      ├─ ¿hay `extraction`?                           → devolver su `prediction`, fin
   │      │
   │      ├─ [CONFIG DINÁMICA] leer topic/subtopic/macro_sector de la base
   │      ├─ componer prompt: texto en castellano (YAML) + taxonomía (DB) + schema con claves EN
   │      ├─ preflight de contexto exacto → 422 si no entra
   │      ├─ inferencia con `response_format: json_schema`
   │      ├─ validar en pydantic (par topic/subtopic) → reintento ACOTADO
   │      │     └─ agotado: topic/subtopic en null, no 502
   │      └─ persistir `extraction` (prediction + config + hash de catálogos)
   │
   ├─► resolución de destinatarios (por cada uno con macro_sector.code == "GCBA")
   │      ├─ [CONFIG DINÁMICA] índice aprendido: query sobre `recipient` por normalized_name/position
   │      ├─ [CONFIG DINÁMICA] evidencia por nombre → organigram_holder (vigentes, fallback a anteriores)
   │      ├─ [CONFIG DINÁMICA] evidencia por cargo → organigram_unit + cadena padre por match exacto
   │      ├─ agregar evidencia por unidad, aplicar umbral de score crudo
   │      └─ derivar sector: ancestro más profundo con is_sector
   │
   ├─► VALIDACIÓN HUMANA (pantalla de dos paneles)
   │      └─► PUT /llm/data-extraction/{document_id}/validate
   │             ├─ crear/actualizar `recommendation` + `recipient` (resuelve labels → IDs)
   │             └─ el índice aprendido se alimenta solo: los recipients SON el índice
   │
   ├─► CONSULTA: GET /llm/data-extraction/recommendations (paginado, filtros)
   ├─► CORRECCIÓN: misma pantalla, alimentada desde `extraction.source_text` + `recommendation`
   └─► EXPORT:   GET /llm/data-extraction/export?format=xlsx
```

**Dónde entra la configuración dinámica:** al componer el prompt (taxonomía), al resolver destinatarios
(organigrama y sus titulares), y al resolver labels → IDs en la validación. En los tres casos se lee la
**foto vigente de la base**, nunca un archivo.

---

## F. Estrategia de prompts

- **Estático** (recurso YAML versionado): persona, guidelines, descripción de campos, instrucciones de formato.
- **Dinámico** (base, por request): el mapa tema→subtema y el catálogo de sectores macro.
- **`topic` como enum en el JSON Schema** (345 tokens). Los 242 subtemas **no** van al schema: el schema no
  puede expresar la dependencia tema→subtema de todos modos, así que esa relación va en el texto y se valida
  en pydantic con reintento acotado.
- **Todo campo nullable usa `enum` con `null` explícito.** `type: ["string","null"] + enum` **descarta el
  null en silencio** — verificado.
- **Nada de `str.format`**: un prompt con JSON Schema tiene llaves por todos lados y hoy eso revienta en 500.
- **Trazabilidad:** `extraction.config` guarda un hash de los catálogos. Si no coincide con el actual, la UI
  avisa y ofrece re-extraer. **No se re-infiere automáticamente.**
- **Reintentos acotados:** prompt original sin modificar + bloque de corrección que **no se acumula** entre
  intentos (el histórico anidaba el prompt entero en cada reintento).

**Presupuesto medido** (gemma-4-12B, tokens exactos): prompt 4.929 tok; documentos mediana 5.615, máx 30.707.

| | Entran |
|---|---|
| `-c 32768`, salida 2048 | 111/113 |
| **`-c 65536`, salida 2048** | **113/113** |

**Despliegue:** `-c 65536` mínimo · `max_tokens` **1024** (salida real máx 523) · reasoning off **por
request** vía `reasoning_effort: "none"`, no vía `LLAMA_ARG_REASONING=off`, que rompería summarization.

---

## G. API

### Reutilizables sin cambios
- `POST /api/misc/document-extract`
- `GET /api/server/healthcheck`

### Nuevos

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/llm/data-extraction?use_cache=` | Extracción. 422 si el documento no entra en contexto. |
| PUT | `/api/llm/data-extraction/{document_id}/validate` | Guarda la validación humana → crea/actualiza `recommendation` + `recipient`. |
| GET | `/api/llm/data-extraction/recommendations` | Lista paginada con filtros (`topic`, `sector`, `from`, `to`, `q`). |
| GET | `/api/llm/data-extraction/recommendations/{id}` | Una recomendación + su `source_text` + su `prediction`. |
| GET | `/api/llm/data-extraction/export?format=xlsx\|csv` | Export desde la fuente de verdad. |
| GET/POST/PATCH/DELETE | `/api/catalogs/topics[/{id}]` | ABM de temas. |
| GET/POST/PATCH/DELETE | `/api/catalogs/subtopics[/{id}]` | ABM de subtemas. |
| GET | `/api/catalogs/topics/{id}/usage` | **Conteo de registros que usan la categoría** (para avisar antes de la baja). |
| POST | `/api/catalogs/subtopics/{id}/reassign` | Reasignación masiva. |
| GET/POST/PATCH/DELETE | `/api/organigram/units[/{id}]` | ABM del organigrama. |
| GET | `/api/organigram/units/{id}/holders` | Historial de titulares. |
| POST | `/api/organigram/units/{id}/holders` | Nuevo titular vigente (baja el anterior). |

**Contratos:** todos los request/response son pydantic con `model_config = ConfigDict(extra="forbid")`
(CES-4), en `api/<v>/schemas/{requests,responses}` (CES-17). Excepciones tipadas de
`aymurai.api.exceptions` (`NotFoundError`, `ConfigurationError`, `UpstreamServiceError`), siguiendo el
patrón de `asr/transcribe.py` y **no** el `HTTPException` crudo de los routers LLM actuales.

**Path a reconciliar:** el frontend histórico esperaba `/llm/recomendaciones/validation/document/{id}` y el
backend expuso `PUT /llm/data-extraction/{document_id}/validate`. **Nunca se reconciliaron.** Vale la
segunda: es la que existe y sigue la convención del repo.

---

## H. Frontend

**Sección "Configuración" rediseñada** — el `Gear` del features-menu ya existe y hoy va a `/home/host`:

```
/home/settings/server        ← el ConnectToHost actual (alcanzable SIN conexión)
/home/settings/taxonomy      ← ABM maestro-detalle de 2 niveles
/home/settings/organigram    ← árbol expandible + panel de detalle
/home/settings/dataset       ← tabla paginada + corrección
/home/host                   ← redirect a /home/settings/server
```

Verificado: **no requiere cambios en el backend** (`FEATURE_ROUTE_SLUGS` sólo enumera features) y
`HomeLayout` se reutiliza con una variante de contenido ancho.

**Flujo de extracción:** quinta `FeatureFlowEnum` dentro del wizard existente.

**Se conserva del histórico lo que funcionaba:** `suggestions` congeladas vs `values`; keep-and-flag para
valores fuera de catálogo; resaltado en el documento sólo de campos citables; tri-estado de
`datos_personales`.

**Cambia:** un único selector de unidad por destinatario, con `ruta_cargos` como descriptor, devolviendo
**referencia canónica** (`unit_id` → `sector_id`). No es el picker borrado, que eran dos desplegables
devolviendo texto. El score no se muestra.

**Nuevo:** aviso de "inferido con una taxonomía anterior" cuando el hash de catálogos no coincide.

Todo acceso al backend por las factories de `services/aymurai/queries.ts` y toda la copy en
`constants/i18n/locales/es/` — ambas obligatorias por `CONVENTIONS.md`.

---

## I. Migraciones

Revisiones de Alembic, en orden:

1. `catalogs` — `topic`, `subtopic`, `macro_sector` + índices.
2. `organigram` — `organigram_unit`, `organigram_holder` + índices + índice único parcial de `is_current`.
3. `dataset` — `dataset`, `extraction`, `recommendation`, `recipient` + índices.

**Seeds** (comandos one-shot, no migraciones de datos):
- Taxonomía desde `defensoria_taxonomy.json`, **verbatim, erratas incluidas**.
- `macro_sector` con los 4 valores que hoy viven en el prompt.
- Organigrama desde `organigram_GCBA.json`: arma el árbol, **corre las 5 reglas históricas una única vez
  para setear `is_sector`**, y toma `short_name` del CSV donde difiera. **Después, las 5 reglas se borran
  del código.**

**Sin migración de datos históricos** — no hay `.xlsx` acumulado que importar (fuera de alcance).

**⚠️ Deuda que este trabajo toca de refilón.** Los tests construyen el esquema con
`SQLModel.metadata.create_all`, así que **las migraciones nunca se ejercitan** y la deriva es invisible. Con
tres revisiones nuevas y un seed no trivial, conviene agregar **un test que corra `alembic upgrade head`
sobre una base vacía** y compare contra `metadata`. Es barato y ataca un riesgo real.

---

## J. Testing

**Unitarios**
- Derivación de sector: `is_sector` sobre árboles sintéticos, incluidos organismos autónomos anidados bajo
  un ministerio y una Subsecretaría sin Secretaría por encima.
- Limpieza de cargo: `CARGO_ROLE_PREFIXES` **en su orden** (`"secretario general"` antes que `"secretario"`),
  `CARGO_PARENT_MARKERS` con su lookahead, boilerplate del GCBA.
- Desambiguación por cadena padre: **match exacto por segmento**, con el caso de las DGTAL homónimas.
- Umbral de score: positivos y negativos conocidos.
- Composición del prompt: que la taxonomía salga de la base, y que **llaves literales no revienten**.
- Validación tema/subtema y **reintento que no crece**.
- Aplanado del export, tri-estado y **fecha en zona local** (fijar `TZ`).

**Integración**
- **Integridad jerárquica:** no se puede crear un ciclo; baja lógica preserva referencias; el conteo de uso
  es correcto; desactivar un tema oculta sus subtemas.
- **`is_current`:** el índice único parcial impide dos titulares vigentes; cambiar el titular **inserta** y
  no pisa.
- **Persistencia multi-cliente:** dos clientes validando documentos distintos ven ambos registros en la
  consulta y en el export. Es el requisito "instance-wide", y hay que probarlo explícitamente.
- **Ciclo completo:** extract → validate → query → correct → export, verificando que el valor corregido
  llega al Excel (el histórico tenía justo este test y atrapó un bug real).
- **Export:** dos hojas, columnas y orden, dataset vacío devuelve encabezados.
- **Alembic:** `upgrade head` desde vacío coincide con `metadata`.

**LLM siempre mockeado.** El playbook está en `tests/api/routers/llm/conftest.py`: doubles a nivel router
(`patched_generation`) y a nivel red (`fake_llamacpp_network`), que permite ejercitar el camino real de
`prepare_run`/preflight sin servidor.

**Fixtures:** organigrama sintético **chico y curado** para los unitarios — no acoplar asserts a las 489
filas reales, que van a cambiar. El archivo real sirve para un test de integración del seed.

**Frontend:** vitest para el formulario (suggestions vs values, keep-and-flag, cascada tema→subtema) y para
el ABM del árbol; Playwright CT para el layout de dos paneles.

---

## K. Riesgos y decisiones abiertas

| # | Riesgo / incógnita | Estado |
|---|---|---|
| R1 | ~~Tokenizador de E4B ≠ 12B~~ | **CERRADO (2026-08-27).** El technical report de Gemma 4 dice explícitamente *"All models share the same tokenizer, with some control tokens dedicated to IT formatting"*, SentencePiece de Gemini con **262k entradas**, y el model card lo corrobora en las 5 variantes. **El presupuesto de contexto medido con 12B se traslada a E4B.** |
| R2 | **Calidad de extracción no medida.** 4 documentos alcanzan para descartar fallos groseros, no para medir acierto. | **Mitigación en curso:** el equipo va a construir un **dataset anotado extenso** para medir. Hasta entonces, ninguna afirmación sobre tasa de acierto está respaldada. |
| R3 | **Umbrales 85/90 son un punto de partida optimista** — los positivos del test eran cadenas exactas. | **Mitigación en curso:** se calibran contra el dataset anotado de R2. Deben quedar **configurables**, no hardcodeados, para poder ajustarlos sin redeploy. |
| R4 | **Imagen de llama.cpp sin pinear** (`:server` rodante). Las garantías de salida estructurada valen para un build. | Pinear por digest o `bNNNNN`. |
| R5 | **Degradación silenciosa de JSON Schema**: `nullable`, `if/then/else`, `uniqueItems`, `oneOf` con properties hermanas se ignoran **sin warning**. | Mitigado por convención (`enum` con null explícito) + test que lo verifique contra el servidor. |
| R6 | **SQLite + `Engine` por request** bajo servidor compartido. | Bajo: carga humana. Mitigación barata si aparece: WAL + `busy_timeout`. |
| R7 | **UUIDs distintos entre despliegues** si se sembrara con UUID4. | Mitigado: UUID5 sobre `ruta#idx`. Queda el guardarraíl de **no recomputar jamás**. |
| R8 | **`rapidfuzz` es dependencia directa no declarada.** | Declararla en `pyproject.toml`. |
| R9 | **Dos nodos `Dirección` homónimos bajo `EAIT`** — el PDF probablemente aplanó denominaciones distintas. | Consultar a la Defensoría; corregible por ABM sin tocar ids. |
| R10 | **`.env.schema` no documenta ninguna variable LLM** y sigue con `EXAMPLE_ITEM="delete me!"`. | Actualizar al agregar config. |

**Residuo de R1, menor:** la frase *"some control tokens dedicated to IT formatting"* deja abierto que la
plantilla de chat difiera entre variantes. Medido, ese overhead es de **16 tokens** sobre un prompt de 4.929,
así que es inmaterial para el presupuesto.

**Supuestos declarados:** servidor compartido en red; sin auth; build/perfil separado para la Defensoría;
el organigrama se cura a mano en la app; no hay `.xlsx` histórico que importar.

---

## L. Plan incremental

Cada fase es entregable y comprobable por separado.

### Fase 1 — Catálogos
**Objetivo:** taxonomía y sectores macro en la base, editables por API.
**Cambios:** `database/meta/catalogs/`, CRUD, revisión Alembic, seed desde el JSON, routers ABM + `usage` + `reassign`.
**Dependencias:** ninguna.
**Tests:** integridad jerárquica, baja lógica, conteo de uso, seed idempotente.
**Aceptación:** se puede crear, editar y dar de baja un subtema por API; el seed reproduce 25/242.

### Fase 2 — Organigrama
**Objetivo:** el árbol en la base, con `is_sector` y titulares con historial.
**Cambios:** `database/meta/organigram/`, CRUD, revisión Alembic, seed (corre las 5 reglas una vez), routers ABM.
**Dependencias:** ninguna (paralelizable con la 1).
**Tests:** derivación de sector sobre árbol sintético; `is_current` único; seed con el archivo real produce 520 nodos, 489 titulares, 33 sectores.
**Aceptación:** `sector(unit)` coincide con las 5 reglas en el 100% de los nodos reales; el seed no se puede correr dos veces con ids distintos.

### Fase 3 — Extracción estructurada
**Objetivo:** `POST /llm/data-extraction` con salida estructurada, validación y preflight.
**Cambios:** router + servicio, composición de prompt desde la base, schema con enums nullables, reintento acotado, preflight, tabla `extraction`.
**Dependencias:** fase 1.
**Tests:** LLM mockeado; enum con null; par tema/subtema inválido → null tras reintentos; documento que no entra → 422; llaves literales no revientan.
**Aceptación:** un documento real produce una `extraction` válida con `config` que incluye el hash de catálogos.

### Fase 4 — Resolución de destinatarios
**Objetivo:** cruce con el organigrama y derivación de sector.
**Cambios:** `organigram_matching` reescrito contra la base; **eliminar `sector_matching.py` y el CSV**; escala fija en vez de normalización por máximo; umbrales; match exacto de cadena padre.
**Dependencias:** fases 2 y 3.
**Tests:** DGTAL homónimas desambiguadas; umbral rechaza negativos; sector gating por `code`.
**Aceptación:** los destinatarios GCBA de un documento real resuelven a `unit_id` y `sector_id` correctos.

### Fase 5 — Dataset y validación
**Objetivo:** persistir la validación humana como dataset consultable.
**Cambios:** tablas `dataset`/`recommendation`/`recipient`, revisión Alembic, `PUT .../validate`, `GET .../recommendations`.
**Dependencias:** fases 3 y 4.
**Tests:** resolución label→ID; `recipient.id` estable; índice aprendido; multi-cliente; unicidad por documento.
**Aceptación:** validar dos documentos desde clientes distintos y verlos ambos en la consulta.

### Fase 6 — Export
**Objetivo:** Excel desde la fuente de verdad.
**Cambios:** dependencia `openpyxl`, endpoint de export, dos hojas.
**Dependencias:** fase 5.
**Tests:** columnas y orden; tri-estado; fecha local; dataset vacío.
**Aceptación:** el `.xlsx` descargado abre con las dos hojas y refleja una corrección hecha por API.

### Fase 7 — Frontend: Configuración y catálogos
**Objetivo:** ABM de taxonomía y organigrama.
**Cambios:** rutas `/home/settings/*`, redirect de `/home/host`, ABM maestro-detalle, árbol + panel.
**Dependencias:** fases 1 y 2.
**Tests:** vitest del ABM; aviso de uso antes de la baja; Playwright del layout.
**Aceptación:** se cambia un titular y se marca un nodo como sector desde la UI.

### Fase 8 — Frontend: flujo de extracción
**Objetivo:** la feature de recomendaciones end-to-end.
**Cambios:** quinta `FeatureFlowEnum`, pantalla de proceso, formulario de validación, selector de unidad.
**Dependencias:** fases 3, 4, 5 y 7.
**Tests:** suggestions vs values; keep-and-flag; cascada tema→subtema; el valor corregido llega al servidor.
**Aceptación:** un documento recorre carga → extracción → validación → guardado.

### Fase 9 — Frontend: dataset
**Objetivo:** consulta y corrección in-app.
**Cambios:** `/home/settings/dataset`, tabla paginada, pantalla de corrección reusando el formulario.
**Dependencias:** fases 5, 6 y 8.
**Tests:** filtros y paginación; corregir actualiza y se ve en el export.
**Aceptación:** se corrige un registro sin volver a cargar el documento.

### Fase 10 — Despliegue y documentación
**Objetivo:** que el sistema arranque bien configurado.
**Cambios:** compose con `-c 65536` y `reasoning_effort`, pinear la imagen de llama.cpp, `.env.schema`, declarar `rapidfuzz`, documentación de operación y del seed.
**Dependencias:** todas.
**Tests:** smoke de arranque.
**Aceptación:** un despliegue limpio siembra catálogos y organigrama y procesa un documento.

### Fuera de este plan
Motor de extracción configurable y reconciliación NER/LLM; auth y roles; arreglar el flujo NER existente;
chunking de documentos; importar un `.xlsx` histórico.

**Dónde este plan podría generar deuda**, para tenerlo a la vista: `organigram_matching` reescrito queda
específico de este dominio; si mañana otro flujo necesita resolver entidades contra un catálogo jerárquico,
ahí habrá evidencia suficiente para extraer la abstracción — hoy no la hay.


---

## M. Apéndice — mapa de nombres

**Regla:** todo en inglés salvo lo que ve una persona. El **texto** del prompt sigue en castellano; sus
**claves**, no.

### M.1 Schema de entrada/salida del LLM

| Antes (histórico) | Ahora |
|---|---|
| `numero_recomendacion` | `recommendation_number` |
| `fecha_recomendacion` | `recommendation_date` |
| `destinatarios` | `recipients` |
| `destinatarios[].nombre` | `recipients[].name` |
| `destinatarios[].cargo` | `recipients[].position` |
| `destinatarios[].destinatario_principal` | `recipients[].is_primary` |
| `destinatarios[].sector` | `recipients[].macro_sector` |
| `tema` / `subtema` | `topic` / `subtopic` |
| `datos_personales` | `personal_data` |
| `contenido_para_publicar` | `publishable_content` |
| `sector_confirmado` | `confirmed_sector` |
| `candidatos_sector` | `sector_candidates` |
| `origen_campo` / `origen_nombre` / `origen_cargo` / `origen_score` | `source_field` / `source_name` / `source_position` / `source_score` |
| `ruta_cargos` | `unit_path` |

El bloque `output-format` del YAML —que muestra la forma del JSON dentro del prompt— usa **estas** claves,
para no contradecir al schema. Las descripciones de campo que lo rodean siguen en castellano.

### M.2 Settings

| Antes | Ahora |
|---|---|
| `DATA_EXTRACTION_NOMBRE_ORIGEN_WEIGHT` | `DATA_EXTRACTION_NAME_EVIDENCE_WEIGHT` |
| *(nuevo)* | `DATA_EXTRACTION_NAME_SCORE_THRESHOLD` (default 90) |
| *(nuevo)* | `DATA_EXTRACTION_POSITION_SCORE_THRESHOLD` (default 85) |

Los umbrales van como settings, **no hardcodeados**: se calibran contra el dataset anotado (R3) y ajustarlos
no debe requerir redeploy.

`DATA_EXTRACTION_SECTOR_MODE` y `DATA_EXTRACTION_SECTOR_TOP_K` **se eliminan** junto con el modo CSV.

### M.3 El workbook queda en castellano

Es un producto para leer, así que **nombres de hoja y encabezados** van en castellano:
hojas `recomendaciones` y `destinatarios`; columnas `NUMERO_RECOMENDACION`, `FECHA_RECOMENDACION`, `TEMA`,
`SUBTEMA`, `DATOS_PERSONALES`, `CONTENIDO_PARA_PUBLICAR`, `RUTA_ORGANIGRAMA`, etc. La traducción ocurre en
el exportador, que es el único lugar que la conoce.

### M.4 Una incógnita menor, barata de resolver

Cambiar las claves del schema de castellano a inglés **podría** afectar marginalmente la adherencia del
modelo, que ve un prompt en castellano y un schema en inglés. Con decodificación restringida la *forma* está
garantizada igual; lo que podría moverse es el *contenido*.

No es motivo para no hacerlo, y el arnés del spike (`spike/spike_extraccion.py`) ya permite comparar ambas
variantes sobre los mismos documentos. **Vale medirlo junto con la evaluación de R2**, no antes.
