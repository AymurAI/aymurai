# AymurAI Desktop App

## Technologies

### Main technologies

- ⚛️ **React** + 🆎 **TypeScript** as the _main framework_ with _type checking_
tools
- ⚡ **Electron** as the _deployment and packaging tool_. It also serves the
purpose of communicating the webapp with the _NodeJS_ process.
- 🐼 **Panda CSS** as the _styling library_ (migrating off legacy Stitches)
- 🛣️ **Tanstack React Router** as the _routing library_ to navigate across the webapp
- 📄 **Mammoth** + **ExcelJS** as the _libraries_ to read and write `.docx` and
datasheet files

### Other technologies

- **pnpm** as _package manager_
- **biome** as code _linter and formatter_
- **prek** for git hooks (pre-commit + pre-push gates)

##  Getting started

1. Clone the repository

1. Navigate to the repository folder and install dependencies with

    ```bash
    pnpm install
    ```

1. Run `prepare` to generate the Panda CSS runtime (also runs automatically
   after `pnpm install`, but re-run it after pulling changes that touch
   `panda.config.ts`):

    ```bash
    pnpm prepare
    ```

1. Start the app in development mode with

   ```bash
   pnpm run dev
   ```

## Run Aymurai API

The frontend talks to the API on `http://localhost:8899`. From the repository
root:

```sh
make api-up          # lightweight profile
# or make api-full-up  # includes production resources
```

Or run the published image directly:

```sh
docker run -d --name aymurai-backend -p 8899:8899 ghcr.io/aymurai/api:full
```

See the [repository README](../README.md) for GPU variants, cache volumes and
the optional LLM and ASR backends.

## Scripts

### Development

- `dev:web`: starts the frontend locally to be viewed in a conventional browser
- `dev`: starts the frontend locally and creates an _Electron_ instance to view it
- `start`: previews the production build with Electron
- `start:web`: previews the production web build in a browser

### Build

- `build:web`: builds the React Vite project
- `build`: builds both React and Electron projects (without packaging the application)

### Validation

- `lint`: runs the linter (_Biome_) across the entire project
- `lint:fix`: fixes linter errors automatically
- `format`: checks code formatting with _Biome_
- `format:fix`: fixes code formatting automatically
- `typecheck`: runs type checking on both _Node_ and _Web_ applications
- `typecheck:node`: runs type checking on the _Electron_ application
- `typecheck:web`: runs type checking on the _React_ application
- `validate`: runs linting and type checking on both React and renderer
- `prepare` / `panda:codegen`: runs `panda codegen` (`prepare` auto-runs after `pnpm install`)
- `knip`: reports unused exports and dependencies (informational only — every
  rule in `knip.json` is severity `warn`, so it never fails and is not gated
  anywhere)

### Testing

- `test`: runs the unit test suite once (_Vitest_)
- `test:watch`: runs the same suite in watch mode
- `test:responsive`: runs the _Playwright_ component tests
- `test:visual`: captures the visual-regression baselines

Playwright component tests are deliberately not part of the CI gate — they
download browsers and run in a separate, non-blocking job.

### Deployment

- `build:unpack`: builds and creates an unpacked distribution directory
- `build:[win|mac|linux]`: builds and packages the application for the desired target with _electron-builder_
- `postinstall`: installs native app dependencies for electron-builder

The Windows installer is built in CI from the same tag as the container image,
so the two never report different versions (`.github/workflows/desktop-release.yml`).

##  Colaborators

- Melina Gatto (_Project Manager_)
- Luciana Vega (_Project Manager_)
- Andy Orlandi (_Product Designer_)
- Luciano Lapenna (_Developer_)
- Ender Puentes (_Developer_)

## Special thanks

- Lucia Wainfeld
