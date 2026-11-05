import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import OrganigramScreen from "@/components/settings/organigram-screen";
import TaxonomyScreen from "@/components/settings/taxonomy-screen";

/**
 * Mounted only by the Playwright CT screen spec (playwright/
 * settings-two-panel.spec.tsx), never imported from the app itself - same
 * RSP-02b-style convention as every other fixture in this directory. Not
 * reachable from any knip entry point on purpose, though unlike
 * `playwright/mocks/**` (an alias target, never a real import) this file
 * doesn't need a knip.json ignore entry: it's imported by the spec, and
 * `playwright/**\/*.spec.tsx` is already a knip entry point.
 *
 * Neither `TaxonomyScreen` nor `OrganigramScreen` imports
 * `@tanstack/react-router` directly (only `SettingsNav` does, which these
 * fixtures deliberately don't mount - confirmed by grepping both screen
 * files before writing this), so no change to `playwright/mocks/
 * tanstack-router-stub.ts` was needed here.
 *
 * Both screens DO read from `@tanstack/react-query` (`useQuery`/
 * `useMutation` via `catalogsService`/`organigramService`), and this CT
 * harness has no `QueryClientProvider` set up anywhere else (`playwright/
 * index.tsx` only wires global CSS + i18n, per its own contents) - so each
 * fixture wraps its screen in a local, minimal client, matching how
 * `ValidateDatasetFixture` locally wraps its mount in whatever context it
 * needs rather than relying on a shared app-wide provider tree.
 *
 * The actual `/catalogs/topics` and `/organigram/units` HTTP calls are
 * intercepted at the network layer by the spec itself via Playwright's
 * `page.route()` (the CT `mount` fixture's enclosing `page`) - `vi.mock`
 * (used by taxonomy-screen.test.tsx/organigram-screen.test.tsx) does not
 * apply here, since Playwright CT specs run in a real browser, not
 * vitest's Node/jsdom environment. One `QueryClient` per fixture function
 * (not module-level shared) keeps the two screens' caches independent,
 * mirroring `retry: false` from those same vitest tests so a mocked 404
 * (an unmatched route) fails fast instead of retrying for several seconds.
 */
function createTestQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function TaxonomyScreenFixture() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <QueryClientProvider client={createTestQueryClient()}>
        <TaxonomyScreen />
      </QueryClientProvider>
    </div>
  );
}

export function OrganigramScreenFixture() {
  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <QueryClientProvider client={createTestQueryClient()}>
        <OrganigramScreen />
      </QueryClientProvider>
    </div>
  );
}
