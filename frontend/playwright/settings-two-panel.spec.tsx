import { expect, test } from "@playwright/experimental-ct-react";
import {
  OrganigramScreenFixture,
  TaxonomyScreenFixture,
} from "@/test/playwright-fixtures/settings-screens-fixture";

/**
 * Regression guard for the master/detail two-panel layout shared by
 * TaxonomyScreen and OrganigramScreen (both `gridTemplateColumns:
 * "[token(sizes.panel.side) minmax(0, 1fr)]"`, see taxonomy-screen.tsx /
 * organigram-screen.tsx) - a fixed-width master column beside a flexible
 * detail column. This is the first CT spec in this repo that needs to mock
 * a backend call: `file-annotator.spec.tsx`/`transcription-editor.spec.tsx`
 * (checked before writing this) mount FileAnnotator/TranscriptionEditor,
 * neither of which reads from `services/aymurai` - they're pure-layout
 * regression guards fed via `FileContext`, per their own docblocks.
 *
 * Mocking mechanism: `page.route()` on the CT `mount` fixture's enclosing
 * `page` - the standard `@playwright/test`/`@playwright/experimental-ct-react`
 * network-interception mechanism. `vi.mock` (used by
 * taxonomy-screen.test.tsx/organigram-screen.test.tsx to replace
 * `catalogsService`/`organigramService` wholesale) does not apply here:
 * Playwright CT specs execute in a real Chromium tab via a Vite dev build,
 * not vitest's Node/jsdom environment, so there is no module registry for
 * `vi.mock` to intercept.
 *
 * This works in this harness because `api.defaults.baseURL` (services/
 * api.ts) resolves to the CT dev server's own origin here rather than
 * `undefined`: `isElectronApp()` is false (no `VITE_APP_MODE=electron` in
 * this build), and `window.location.origin` is a real, usable
 * `http://127.0.0.1:<ctPort>` in the Playwright-hosted page - so
 * `resolveInitialBaseUrl()` falls through to its "web app's own origin"
 * branch instead of throwing or staying unset. The two screens' initial
 * `useQuery` calls (`catalogsService.listTopics()` /
 * `organigramService.listUnits()`) therefore issue real (same-origin)
 * axios GETs that `page.route()` intercepts by path glob, which matches
 * regardless of host per Playwright's routing semantics - the
 * `VITE_USE_MOCK_CATALOGS`/`VITE_USE_MOCK_ORGANIGRAM` fallback the task
 * brief flagged as a fallback was not needed.
 *
 * Both screens' second-tier queries (`catalogsService.listSubtopics`/
 * `topicUsage`, `organigramService.unitHolders`) are gated by
 * `enabled: <nothing selected yet> !== null` (see subtopics-panel.tsx /
 * organigram-detail-panel.tsx) and so never fire before any row is
 * clicked - neither test below selects a row, so only the two top-level
 * "list" endpoints need a route handler. The `/catalogs/subtopics` route is
 * still registered as a defensive no-op (returns `[]`) in case that
 * assumption ever changes.
 *
 * Viewport note (final-review Fix 2): both screens' `Grid` now stacks to a
 * single column below `lg` (1024px, see taxonomy-screen.tsx /
 * organigram-screen.tsx) so `SidePanelColumn`'s below-`lg` styles can engage,
 * per its own docblock. `playwright-ct.config.ts` runs this file against six
 * viewport projects and only one of them ("768x1024") is narrower than
 * `lg` - the master/detail panels are stacked there by design, not a bug, so
 * the side-by-side geometry assertion below is skipped for that project only
 * (chosen over restricting which projects this file's tests run under,
 * since `playwright-ct.config.ts`'s project list is shared by every CT spec
 * in this repo - skipping one assertion in one file is the smaller, more
 * localized change). Both panels are still asserted visible at every
 * viewport, including "768x1024".
 */

test("Nomenclador: master and detail panels render side by side", async ({
  mount,
  page,
}, testInfo) => {
  // Trailing `*`: both list factories send query params
  // (`include_inactive`, and `flat` for units), and a glob without it stops
  // matching the moment a `?` appears — which is exactly how this spec went
  // quietly red. Playwright's `*` does not cross `/`, so this still does not
  // swallow `/catalogs/topics/{id}/usage`.
  await page.route("**/catalogs/topics*", (route) =>
    route.fulfill({
      json: [
        {
          id: "t1",
          code: "ACC",
          name: "Acceso a la justicia",
          active: true,
          order: 1,
          created_at: "x",
          updated_at: "x",
        },
      ],
    }),
  );
  // Defensive no-op: disabled (`enabled: topicId !== null`) until a topic
  // row is clicked, which this test never does - see docblock above.
  await page.route("**/catalogs/subtopics*", (route) =>
    route.fulfill({ json: [] }),
  );

  const component = await mount(<TaxonomyScreenFixture />);

  // Master panel: heading + the mocked topic's name.
  const masterHeading = component.getByText("Temas", { exact: true });
  await expect(masterHeading).toBeVisible();
  await expect(component.getByText("Acceso a la justicia")).toBeVisible();

  // Detail panel: unselected empty-state copy (taxonomy.subtopics.empty).
  const detailEmpty = component.getByText(
    "Selecciona un tema para ver sus subtemas",
  );
  await expect(detailEmpty).toBeVisible();

  // Side-by-side, not stacked/overlapping: the master column is a fixed
  // `sizes.panel.side` width followed by a flexible detail column
  // (`gridTemplateColumns: "[token(sizes.panel.side) minmax(0, 1fr)]"`), so
  // the master heading's right edge must land at or before the detail
  // panel's left edge. Only applies at/above `lg` (1024px) - below that the
  // Grid stacks to a single column by design (see the docblock's "Viewport
  // note" above), so this geometric check is skipped there.
  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;
  if (viewportWidth < 1024) {
    return;
  }
  const masterBox = await masterHeading.boundingBox();
  const detailBox = await detailEmpty.boundingBox();
  if (masterBox === null || detailBox === null) {
    throw new Error(
      "[settings-two-panel] boundingBox() was null - a panel failed to render.",
    );
  }
  expect(masterBox.x + masterBox.width).toBeLessThanOrEqual(detailBox.x);
});

test("Organigrama: tree and detail panel render side by side", async ({
  mount,
  page,
}, testInfo) => {
  // See the note on the topics route above.
  await page.route("**/organigram/units*", (route) =>
    route.fulfill({
      json: [
        {
          id: "jg",
          parent_id: null,
          name: "Jefatura de Gabinete",
          acronym: null,
          short_name: null,
          is_sector: false,
          active: true,
          order: 1,
          created_at: "x",
          updated_at: "x",
        },
      ],
    }),
  );

  const component = await mount(<OrganigramScreenFixture />);

  // Master panel: tree heading + the mocked unit's name.
  const masterHeading = component.getByText("Organigrama", { exact: true });
  await expect(masterHeading).toBeVisible();
  await expect(component.getByText("Jefatura de Gabinete")).toBeVisible();

  // Detail panel: unselected empty-state copy (organigram.detail.empty).
  const detailEmpty = component.getByText(
    "Selecciona una unidad del organigrama",
  );
  await expect(detailEmpty).toBeVisible();

  // Same side-by-side check as the Nomenclador test above, same `lg` gating.
  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;
  if (viewportWidth < 1024) {
    return;
  }
  const masterBox = await masterHeading.boundingBox();
  const detailBox = await detailEmpty.boundingBox();
  if (masterBox === null || detailBox === null) {
    throw new Error(
      "[settings-two-panel] boundingBox() was null - a panel failed to render.",
    );
  }
  expect(masterBox.x + masterBox.width).toBeLessThanOrEqual(detailBox.x);
});
