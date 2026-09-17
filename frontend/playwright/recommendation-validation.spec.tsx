import { expect, test } from "@playwright/experimental-ct-react";
import { RecommendationValidationFixture } from "@/test/playwright-fixtures/recommendation-validation-fixture";

/**
 * Task 15 (2026-09-04-defensoria-extraction-flow): regression guard for
 * `<RecommendationValidation>`'s two-pane layout (document + validation
 * form, `recommendation-validation.tsx`) across the six viewport projects
 * `playwright-ct.config.ts` runs every CT spec under. Written after finding
 * this screen's outer `Grid` used a bare `columns={2}` -- which maps to a
 * single fixed `repeat(2, minmax(0, 1fr))` at every viewport
 * (`styled/patterns/grid.mjs`), never stacking below `lg` -- unlike
 * `validate-dataset/index.tsx` and the settings screens
 * (`settings-two-panel.spec.tsx`), which already use a responsive
 * `gridTemplateColumns`/`gridTemplateRows` object. Fixed in
 * `recommendation-validation.tsx` alongside this spec.
 *
 * Mocking mechanism: `page.route()` on the CT `mount` fixture's enclosing
 * `page`, same as `settings-two-panel.spec.tsx` (checked before writing this
 * -- `vi.mock` doesn't apply here, Playwright CT mounts in a real Chromium
 * tab against a Vite dev build, not vitest's Node/jsdom environment).
 * `useRecommendationForm` (driven by `<RecommendationForm>`, mounted inside
 * the screen) fetches `/catalogs/topics`, `/catalogs/macro_sectors` and, per
 * topic returned, `/catalogs/subtopics` -- returning `[]` for topics means
 * the per-topic `subtopics` query never actually fires (`useQueries` maps
 * over an empty topics array), so `/catalogs/subtopics*` is registered
 * defensively only, matching that same spec's precedent.
 *
 * `RecipientUnitSelect`'s `candidates` come from the prediction itself
 * (Task 6's `OrganigramCandidate[]`), never a network call, so no
 * `/organigram/*` route is needed here.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/catalogs/topics*", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route("**/catalogs/macro_sectors*", (route) =>
    route.fulfill({ json: [] }),
  );
  // Defensive no-op: never called when `/catalogs/topics*` resolves to `[]`
  // (see docblock above), but registered in case that assumption ever changes.
  await page.route("**/catalogs/subtopics*", (route) =>
    route.fulfill({ json: [] }),
  );
});

test("RecommendationValidation: two-pane layout across viewports", async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(<RecommendationValidationFixture />);
  const viewportWidth = testInfo.project.use.viewport?.width ?? 0;

  // Document pane: the `<section aria-label={t("validation.
  // originalDocumentLabel")}>` grid item wrapping `<FileAnnotator>` -- an
  // accessibly-named `<section>` maps to ARIA role "region" (HTML-AAM), so
  // this resolves without adding a test-only attribute.
  const documentPane = component.getByRole("region", {
    name: "Documento original",
  });
  await expect(documentPane).toBeVisible();

  // Form pane: anchored on its `<SectionTitle>` text (validation.
  // sectionTitle), the same "locate by heading text" convention
  // `settings-two-panel.spec.tsx` uses for its own master/detail panes --
  // no container element wraps the form Stack with an accessible name of
  // its own.
  const formHeading = component.getByText("3. Validación de datos");
  await expect(formHeading).toBeVisible();

  // Sanity: the form itself rendered past the seeded prediction, not just
  // the section title -- confirms `<SeedPrediction>` actually delivered the
  // prediction before this test's assertions ran.
  await expect(
    component.getByRole("textbox", { name: "Número de recomendación" }),
  ).toBeVisible();

  const documentBox = await documentPane.boundingBox();
  const formHeadingBox = await formHeading.boundingBox();
  expect(documentBox).not.toBeNull();
  expect(formHeadingBox).not.toBeNull();
  if (!documentBox || !formHeadingBox) {
    throw new Error(
      "[recommendation-validation] boundingBox() was null - a pane failed to render.",
    );
  }

  if (viewportWidth < 1024) {
    // Below `lg`: the two panes stack (document on top, form below) instead
    // of living side by side -- the form heading's top edge must sit at or
    // below the document pane's bottom edge.
    expect(formHeadingBox.y).toBeGreaterThanOrEqual(
      documentBox.y + documentBox.height,
    );
    // Confirms the document pane is no longer squeezed into half the
    // viewport (the pre-fix `columns={2}` behaviour) -- it spans nearly the
    // full stacked row's width instead.
    expect(documentBox.width).toBeGreaterThan(viewportWidth * 0.9);
  } else {
    // At/above `lg`: side by side, not stacked/overlapping -- the document
    // pane's right edge must land at or before the form heading's left edge.
    expect(documentBox.x + documentBox.width).toBeLessThanOrEqual(
      formHeadingBox.x,
    );
  }

  // No viewport should ever force page-level horizontal scroll, regardless
  // of the stacked/side-by-side branch above.
  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(fitsViewport).toBe(true);
});
