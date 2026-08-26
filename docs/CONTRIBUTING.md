# Contributing to AymurAI

We are happy to accept contributions that help make `AymurAI` more useful, more robust, and easier to maintain.
To avoid unnecessary work on either side, please use the following flow.

## Contribution flow
1. Check whether there is already an issue for your topic: <https://github.com/AymurAI/aymurai/issues>
2. If not, open a new issue with context, motivation, and expected outcome.
3. Once the scope is clear, submit a pull request tied to that issue.

If you want to help and do not know where to start, small documentation fixes, test coverage improvements, and cleanup PRs are all welcome.

> AI agents working in this repository follow a different convention: issues and
> PRDs are local markdown files under `.scratch/`, never GitHub issues. See
> [agents/issue-tracker.md](agents/issue-tracker.md). That policy applies to
> agent workflows only — human contributors use GitHub issues as above.

## Commit and PR titles
Commit subjects and PR titles follow [Conventional Commits](https://www.conventionalcommits.org/):
`type(scope): description`, where `type` is one of `feat`, `fix`, `docs`, `style`,
`refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

This is enforced twice: a `commit-msg` hook checks every commit locally, and the
`Conventional Commits` workflow checks the PR title in CI.

## Local development
If you want to get deeper into the API, we recommend cloning the repository and running the stack locally.
The codebase is fairly navigable, and most of the important modules are documented or organized by workflow.

### Option A: Docker (recommended)
You can use the provided compose services directly:

```bash
make api-up
# or make api-full-up
```

Bundled frontend: `http://localhost:8899/`

Swagger UI: `http://localhost:8899/api/docs`

If you prefer working from VS Code, the repository also includes a `.devcontainer/` setup.

### Option B: Local Python environment
The project requires Python `3.13` (`requires-python = "==3.13.*"`), and CI tests
against 3.13 on Ubuntu and Windows.

```bash
# if using uv (recommended — uv.lock is the source of truth)
uv sync --all-groups

# fallback with pip
pip install -e .
```

Dependency groups: `tests`, `loadtest`, `notebooks`, `dev`.

For most contributors, Docker is the easiest way to get a working API with the expected runtime dependencies.

### Frontend development
The frontend supports browser and Electron development. Install its dependencies and run the desired target:

```bash
cd frontend
pnpm install
pnpm run dev:web  # browser
pnpm run dev      # Electron
```

Before submitting frontend changes, run:

```bash
pnpm run validate  # lint + typecheck
pnpm test
```

See [the frontend README](../frontend/README.md) for build and packaging commands.

## Tests
The suite is `pytest`, configured in `pyproject.toml` with `testpaths = ["tests"]`.

```bash
uv run pytest                        # everything
uv run pytest tests/api              # API routes, no model loading
uv run pytest -m "not slow"          # skip model-loading tests
```

Registered markers:

| Marker | Meaning |
|---|---|
| `integration` | integration tests |
| `slow` | model loading, over 30s |
| `external` | depends on optional external binaries or services |

CI runs `tests/api` first, then downloads pipeline artifacts with
`uv run pipeline-download` and runs `tests/integration/pipelines`. Some tests
need an `es_AR.UTF-8` locale, which the workflow generates on Linux runners.

## Git hooks
Hooks run through [`prek`](https://github.com/j178/prek), not `pre-commit`:

```bash
uvx prek install -t pre-commit -t commit-msg   # both shims
uvx prek run --all-files                      # run everything once
```

Configured in `prek.toml`:

| Hook | Scope |
|---|---|
| `uv-lock` | keeps `uv.lock` in sync with `pyproject.toml` |
| `check-merge-conflict`, `check-added-large-files` (750 KB), `check-toml`, `check-yaml`, `end-of-file-fixer`, `trailing-whitespace` | general hygiene |
| `betterleaks` | secret scanning on staged changes |
| `agents-conventional-commits` | commit-msg subject format (CES-75) |
| `validate-pyproject` | `pyproject.toml` schema |
| `ruff-format`, `ruff` | Python formatting and linting |
| `pyrefly` | Python type checking |
| `ast-grep` | the CES rules in `ast-grep/` |
| `file-size-guard` | warns at 400 lines, fails at 700 (CES-71) |
| `no-utils` | rejects catch-all module names (CES-63) |
| `biome` | frontend formatting and linting, scoped to `frontend/` |

> CI currently skips `pyrefly`, `ast-grep`, `file-size-guard`, `no-utils` and
> `biome` in its repo-wide `prek` run, because the codebase predates those checks
> and they fail on pre-existing code. They still run locally on the files you
> touch, so expect them to have opinions about new code.

Do not reintroduce `black`, `isort`, `flake8` or `pylint`; the lint stack is
ruff + pyrefly + ast-grep (CES-58).

## Formatting
If needed, you can run the formatter manually before committing:

```bash
uv run ruff format aymurai/
```

## Other CI checks
Beyond lint and tests, pull requests also run `pip-audit` (dependency
vulnerabilities) and `zizmor` (GitHub Actions static analysis). Both are
deliberately CI-only and not wired into `prek`.

## Engineering standards
This repository follows a set of Collective Engineering Standards (`CES-<n>`).
They are summarized in [`AGENTS.md`](../AGENTS.md) at the repository root, with
one detail file per rule in `.agents/rules/` and drop-in reference code in
`.agents/snippets/`. Read the relevant rule before writing code that touches it.

## Documentation policy
When behavior changes in the frontend, API, pipelines, configuration or DB
persistence, update the corresponding docs in the same PR.

**This repository is bilingual.** Every page under `docs/` has a Spanish
counterpart under `docs/es/`, and `README.md` is mirrored by `README.es.md`.
Update both, or the translations drift.

| English | Spanish |
|---|---|
| `README.md` | `README.es.md` |
| `docs/README.md` | `docs/es/README.md` |
| `docs/api/README.md` | `docs/es/api/README.md` |
| `docs/configuration/README.md` | `docs/es/configuration/README.md` |
| `docs/database/README.md` | `docs/es/database/README.md` |
| `docs/pipelines/**` | `docs/es/pipelines/**` |
| `docs/entities/**` | `docs/es/entities/**` |
| `docs/models/**` | `docs/es/models/**` |
| `docs/anonymization/README.md` | `docs/es/anonymization/README.md` |

English-only by design: `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
`docs/agents/**`. Spanish-only by design:
`docs/metrics/entity-disambiguation-metric.md`.

`frontend/README.md` is English-only and not mirrored.

If the change is user-facing, documentation should land together with the code.

### Diagrams
- Mermaid diagrams are written inline in the markdown; GitHub renders them
  natively and they diff as text. Prefer these.
- The two Excalidraw diagrams under `docs/` are committed as both the `.excalidraw`
  diagram and a rendered `.png`. After editing a diagram, regenerate its PNG:

  ```bash
  node scripts/render-excalidraw.mjs
  ```

  Note that `.gitignore` blanket-ignores `*.png` to keep dataset imagery out of
  the repo, with an explicit un-ignore for `docs/**` and `frontend/**`. Put
  documentation images in those trees, and never work around the rule with
  `git add -f`.

## Community and security
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Security and ethics: [SECURITY.md](SECURITY.md)
