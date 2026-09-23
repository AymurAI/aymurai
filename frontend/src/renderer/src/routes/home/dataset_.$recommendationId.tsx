import { createFileRoute } from "@tanstack/react-router";
import RecommendationCorrection from "@/components/recommendations/recommendation-correction";
import APIProtected from "@/features/APIProtected";
import HomeLayout from "@/layout/home";

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
 * No `<Header currentStep={...}>` either — a correction is not a step of the
 * extraction wizard, so it carries no stepper. `HomeLayout` supplies the plain
 * app header.
 */
export const Route = createFileRoute("/home/dataset_/$recommendationId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { recommendationId } = Route.useParams();
  return (
    <APIProtected>
      <HomeLayout variant="wide">
        <RecommendationCorrection recommendationId={recommendationId} />
      </HomeLayout>
    </APIProtected>
  );
}
