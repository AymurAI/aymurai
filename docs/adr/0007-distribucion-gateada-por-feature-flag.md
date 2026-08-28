# ADR-0007 — La customización se distribuye gateada por feature flag

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

La Defensoría necesita un build propio a corto plazo, pero el objetivo declarado es que el flujo de
extracción sea **parte del producto general** más adelante.

El desarrollo ocurre en la branch larga `feature/defensoria` y se integrará a `dev` en un solo merge.

Hay un precedente que pesa: las dos branches largas anteriores de Defensoría —`backend@feature/defensoria`
(94 commits) y `desktop-app@feat/recomendaciones-defensoria` (30 commits)— **murieron sin mergear jamás**.

## Decisión

La feature se **gatea por configuración desde la primera fase**, no al final.

- Backend: el router se registra **condicionalmente**; las tablas y migraciones se crean siempre (son
  inertes si nadie las usa).
- Frontend: la `FeatureFlowEnum` y la sección de Configuración se gatean por el mismo flag.

**Separación de conceptos:** el build separado es una decisión de **empaquetado**, no de control de
versiones. Un mismo tronco produce ambos builds cambiando el flag.

## Consecuencias

- El merge final a `dev` es **un cambio de configuración, no una integración**: el código llega apagado.
- Pasar a "parte del producto para todos" queda a un flag de distancia, sin reconciliación.
- **El gate hay que construirlo desde la fase 1.** Retrofitearlo al final convierte el merge en una carrera,
  que es plausiblemente parte de lo que mató a los dos intentos anteriores.
- Las migraciones corren en todos los despliegues aunque la feature esté apagada. Es deliberado: tablas
  vacías no molestan, y evita que el flag tenga que gobernar el esquema.
- Requiere un setting nuevo (p. ej. `DEFENSORIA_ENABLED`), en el módulo de settings por CES-76.

## Alternativas consideradas

- **Fork del repositorio.** Rechazada: el código específico son ~2.000 líneas contra ~87.000 del monorepo —
  duplicaría el 97% para ser dueño del 3% — y el mantenimiento de dependencias y seguridad se volvería
  permanente. Además encarece mes a mes la convergencia que es el objetivo declarado.
- **Fases directo a `dev` sin branch larga.** Descartada por el equipo: en las próximas semanas no habrá
  cambios troncales, así que el riesgo de deriva que motivaba esta opción es bajo.
