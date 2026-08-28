# Defensoría del Pueblo (CABA) — extracción estructurada

Customización de AymurAI para la Defensoría del Pueblo de la Ciudad Autónoma de Buenos Aires: reemplaza el
flujo NER del "Set de datos" por uno basado en un LLM local, con catálogos editables y un dataset persistido
en el servidor.

| Documento | Contenido |
|---|---|
| [`ANALYSIS.md`](ANALYSIS.md) | **A–C**: estado actual del monorepo, qué implementan las branches históricas, y las divergencias clasificadas (reutilizable / adaptable / obsoleto / faltante). |
| [`PLAN.md`](PLAN.md) | **D–L**: modelo de dominio, flujo end-to-end, prompts, API, frontend, migraciones, testing, riesgos y **10 fases** de implementación. Apéndice **M**: mapa de nombres. |
| [`research/`](research/) | La reconstrucción que respalda todo lo anterior: estado del monorepo, las dos branches históricas, y una copia del único documento en prosa que describe la implementación histórica. Referencia, no especificación. |
| [`../adr/`](../adr/) | Las decisiones arquitectónicas de fondo, con su contexto y sus alternativas. |

## Procedencia

Reconstruido a partir de tres fuentes, con las mediciones hechas sobre datos reales:

- El monorepo `aymurai` @ `dev` — **fuente de verdad arquitectónica**.
- `AymurAI/backend @ feature/defensoria` (`66109cbf`) — referencia funcional.
- `AymurAI/desktop-app @ feat/recomendaciones-defensoria` — referencia de UX. **Nunca se mergeó.**

> ⚠️ `docs/superpowers/specs/2026-08-05-defensoria-data-extraction-design.md` y su plan están **obsoletos**:
> se escribieron contra el primero de cinco commits del endpoint y dependen de `get_llm_provider`, que fue
> eliminado por el trabajo llamacpp-only. Ver `ANALYSIS.md`, "Correcciones a la documentación previa".

## Integración

El desarrollo ocurre en la branch larga **`feature/defensoria`**; las fases mergean ahí y el conjunto va a
`dev` en un solo merge, **con la feature apagada por flag** (ver [ADR-0007](../adr/0007-distribucion-gateada-por-feature-flag.md)).

Dos consecuencias operativas:

- **El gate se construye desde la fase 1, no al final.** El router se registra condicionalmente y la
  `FeatureFlowEnum` se gatea desde el primer día. Retrofitearlo convertiría el merge final en una carrera —
  que es plausiblemente parte de lo que mató a los dos intentos anteriores (`backend@feature/defensoria`,
  94 commits; `desktop-app@feat/recomendaciones-defensoria`, 30 commits; **ninguno mergeado**).
- **Sincronizar `dev` → `feature/defensoria` con merge, no rebase** — es una branch compartida. La cadena de
  Alembic es lineal por `down_revision`: si core agregara una revisión, hay que re-apuntar. ⚠️ **Nadie en
  este track debe correr `make alembic-regenerate`**: borra la base *y todas las revisiones*, incluidas las
  de core.

## Estado

Diseño cerrado; implementación no comenzada. Las **fases 1 y 2** (catálogos y organigrama) no dependen de
nada y son paralelizables.
