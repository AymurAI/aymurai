import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import RecommendationValidation from "@/components/recommendations/recommendation-validation";
import { FileContext } from "@/context/File";
import RecommendationProvider, {
  loaded,
  useRecommendationDispatch,
} from "@/context/Recommendation";
import type { DataExtractionPrediction } from "@/types/dataExtraction";
import { buildDocFileFixture } from "./document-file";

/**
 * Mounted only by the Playwright CT screen specs (playwright/*.spec.tsx),
 * never imported from the app itself -- same RSP-02b-style convention as
 * every other fixture in this directory (see `validate-dataset-fixture.tsx`).
 * Not reachable from any knip entry point on purpose; `playwright/**\/*.spec.tsx`
 * is already a knip entry point, same reasoning as `settings-screens-fixture.tsx`.
 *
 * `RecommendationValidation` reads its file from `FileContext` (`useFiles`,
 * same mechanism `ValidateDataset` uses) and its extraction result from the
 * `Recommendation` context (`useRecommendation`/`useRecommendationDispatch`,
 * `context/Recommendation.tsx`). That context's own `RecommendationProvider`
 * always starts at `initialState` (status "idle", no prediction) with no way
 * to seed it from outside -- the raw context objects are module-private,
 * only the hooks/provider/action-creators are exported. `<SeedPrediction>`
 * dispatches a `loaded` action on mount -- the same action
 * `RecommendationProcess` dispatches once a real extraction resolves -- so
 * the screen renders its two-pane layout on the next tick instead of staying
 * on the "missingPrediction" empty state.
 *
 * The outer wrapper matches `ValidateDatasetFixture`'s `100vh`/`100vw` flex
 * column (G1/T6 in tasks/responsive/plan.md): `RecommendationValidation`'s
 * own `Grid` uses `flex="1"`, which is inert under a `display: block` parent
 * -- see that fixture's docblock for the measured failure mode this avoids.
 *
 * No separate `<Header>` mount here (unlike `ValidateDatasetFixture`):
 * `RecommendationValidation` renders its own `<Header>` internally
 * (recommendation-validation.tsx), matching `routes/$feature/validation.tsx`'s
 * Recomendaciones branch, which wraps the screen with no extra `<Header>` of
 * its own.
 *
 * `RecommendationForm` (mounted inside `RecommendationValidation`) drives
 * `useRecommendationForm`, which fetches `/catalogs/topics`,
 * `/catalogs/macro_sectors` and (per topic) `/catalogs/subtopics` via
 * `@tanstack/react-query` -- there is no app-wide `QueryClientProvider` in
 * this CT harness (`playwright/index.tsx` only wires global CSS + i18n), so
 * this fixture wraps its own, one per mount, matching
 * `settings-screens-fixture.tsx`'s `createTestQueryClient()` (`retry: false`
 * so an unmocked route fails fast instead of retrying for several seconds).
 * The actual HTTP calls are intercepted by the spec via `page.route()`, not
 * `vi.mock` -- Playwright CT mounts in a real Chromium tab against a Vite
 * dev build, not vitest's Node/jsdom environment.
 */
function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function buildPredictionFixture(): DataExtractionPrediction {
  return {
    document_id: "doc-fixture",
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre de 2026",
    recipients: [
      {
        name: "María Gómez",
        position: "Directora General",
        is_primary: true,
        macro_sector: "Salud",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
        match_method: null,
        // Empty on purpose: `RecipientUnitCombobox` only renders for a GCBA
        // recipient (this one's `macro_sector` is "Salud"), and candidates
        // never come from a network call anyway -- they're embedded in the
        // prediction itself (Task 6's OrganigramCandidate[]).
        sector_candidates: [],
      },
    ],
    topic: "Salud",
    subtopic: null,
    personal_data: false,
    publishable_content:
      "Contenido publicable de prueba para el panel de validación.",
    config: { model: "fixture", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
  };
}

function SeedPrediction({ children }: { children: ReactNode }) {
  const dispatch = useRecommendationDispatch();

  useEffect(() => {
    dispatch(
      loaded({
        origin: "inference",
        prediction: buildPredictionFixture(),
        validation: null,
        catalogsStale: false,
      }),
    );
    // Seeds exactly once on mount, matching a real extraction resolving
    // exactly once -- `dispatch` (from `useReducer`) is a stable reference,
    // so it's still safe to list here.
  }, [dispatch]);

  return children;
}

export function RecommendationValidationFixture() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <QueryClientProvider client={createTestQueryClient()}>
        <FileContext.Provider value={[buildDocFileFixture()]}>
          <RecommendationProvider>
            <SeedPrediction>
              <RecommendationValidation />
            </SeedPrediction>
          </RecommendationProvider>
        </FileContext.Provider>
      </QueryClientProvider>
    </div>
  );
}
