import { createFileRoute } from "@tanstack/react-router";
import RecommendationsGrid from "@/components/recommendations/recommendations-grid";
import APIProtected from "@/features/APIProtected";
import HomeLayout from "@/layout/home";

/**
 * The grilla de seguimiento. Not to be confused with the `dataset` segment of
 * `FeatureFlowEnum`/`/$feature/...`: that is the Set de Datos flow, a
 * different route tree entirely.
 *
 * No feature-flag `beforeLoad` here on purpose — the Defensoría flag gates the
 * *entry points* into this screen, not the screen itself, the same way every
 * other `/home/*` route works: the route exists, it is simply not linked to
 * while the flag is off.
 */
export const Route = createFileRoute("/home/dataset")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <APIProtected>
      <HomeLayout variant="wide">
        <RecommendationsGrid />
      </HomeLayout>
    </APIProtected>
  );
}
