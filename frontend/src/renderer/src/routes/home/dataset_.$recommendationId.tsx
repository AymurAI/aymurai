import { createFileRoute } from "@tanstack/react-router";
import RecommendationCorrection from "@/components/recommendations/recommendation-correction";
import { validateGridSearch } from "@/components/recommendations/recommendations-grid-search";
import APIProtected from "@/features/APIProtected";

/**
 * The correction screen for one recommendation already in the grilla — a flat
 * file beside `dataset.tsx`, not a `dataset/` directory, so the existing
 * grilla route file stays exactly where it is.
 *
 * The TRAILING UNDERSCORE (`dataset_.$recommendationId`) is load-bearing and
 * not cosmetic: TanStack Router's flat routing would otherwise read
 * `dataset.$recommendationId` as a CHILD of the `/home/dataset` route, and
 * `dataset.tsx` renders the grilla with no `<Outlet />` — so `/home/dataset/
 * <id>` would have rendered the grilla again and this screen never at all
 * (confirmed in the generated `routeTree.gen.ts`, which nested it under
 * `HomeDatasetRouteWithChildren` before the rename). `_` opts out of that
 * nesting and leaves the URL untouched. Adding an `<Outlet />` to
 * `dataset.tsx` was the alternative, and is exactly the restructuring of that
 * file this route was meant to avoid.
 *
 * No feature-flag `beforeLoad`, same criterion as `/home/dataset` and every
 * other `/home/*` route: the Defensoría flag gates the entry points into this
 * screen, not the screen itself.
 *
 * The edit screen owns the same full-height Header/content/Footer
 * composition as validation, but omits the stepper because it is not a wizard
 * step.
 */
export const Route = createFileRoute("/home/dataset_/$recommendationId")({
  // The grilla's own search, carried in by its Editar link and handed back on
  // the way out, so returning restores its filters, sort, page and tab.
  validateSearch: validateGridSearch,
  component: RouteComponent,
});

function RouteComponent() {
  const { recommendationId } = Route.useParams();
  const gridSearch = Route.useSearch();
  return (
    <APIProtected>
      <RecommendationCorrection
        recommendationId={recommendationId}
        gridSearch={gridSearch}
      />
    </APIProtected>
  );
}
