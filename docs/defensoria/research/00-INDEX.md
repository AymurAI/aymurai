# Defensoría extraction — research index

Reconnaissance run 2026-08-25 against:

- **Monorepo (source of truth):** `/home/jansaldo/Documents/collective-ai/aymurai` @ `dev` = `8365a68`
- **Historical backend:** `/home/jansaldo/Documents/collective-ai/backend` @ `origin/feature/defensoria` = **`66109cbf`** (2026-08-23)
- **Historical frontend:** `/home/jansaldo/Documents/collective-ai/desktop-app` @ `origin/feat/recomendaciones-defensoria` (30 commits off `origin/develop`, merge-base `fe3103c`)

## ⚠️ Provenance warnings — read before trusting any prior doc

1. **The local `backend` clone was stale.** `feature/defensoria` sat at `f37716f8` (2026-06-25); the endpoint
   does not exist in any ref at that commit. Real tip is `66109cbf`. Fetched 2026-08-25 (remote-tracking refs
   only; no branch or worktree touched). Paths in the old plan pointing at
   `collective-ai/aymurai-projects/backend` are also wrong — the repos are at `collective-ai/{backend,desktop-app}`.

2. **`docs/superpowers/specs/2026-08-05-defensoria-data-extraction-design.md` is obsolete on two axes:**
   - It was written against `013e86ea` (2026-07-21), the **first of five** endpoint commits. Four commits
     landed after it, adding `sector_matching.py` (+443) and the entire persistence layer.
   - It plans to branch from `feat/openai-compatible-llm-providers` (PR #33) and call `get_llm_provider`.
     That factory and the `LLMProvider` ABC **were subsequently deleted** by
     `docs/superpowers/specs/2026-08-18-llamacpp-only-llm-provider-design.md`. Verified: zero hits for
     `get_llm_provider`, `class LLMProvider`, or `ollama` anywhere under `aymurai/`.

   Treat that spec and its plan as historical input only. Do not execute the plan as written.

## Files

| File | Scope |
|---|---|
| `01-monorepo-datapublic.md` | Current "Set de datos" backend: endpoints, DB schema, CRUD, migrations, NER pipeline, subcategorizers, ownership semantics |
| `02-monorepo-llm-infra.md` | Current LLM layer, prompts, settings, deployment, embeddings, exception/router house patterns, test mocking |
| `03-historical-backend.md` | `backend@feature/defensoria` @ `66109cbf` — the real, complete feature |
| `04-historical-frontend.md` | `desktop-app@feat/recomendaciones-defensoria` — the UX, the Excel contract, the duplicated catalogs |
| `05-monorepo-frontend.md` | Current frontend: routing, state, services, the 65-column Excel export, hardcoded catalogs |
| `README-defensoria-upstream.md` | Verbatim copy of the upstream `notebooks/experiments/defensoria/README.md` — the only prose spec of the feature |
