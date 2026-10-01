import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import Header from "@/components/layout/header";
import MainContent from "@/components/layout/main-content";
import RecommendationsGrid from "@/components/recommendations/recommendations-grid";
import APIProtected from "@/features/APIProtected";
import { Stack } from "@/styled/jsx";

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
  const { t } = useTranslation("recommendations");
  return (
    <APIProtected>
      <Stack width="full" height="[100dvh]" gap="0">
        <Header title={t("grilla.headerTitle")} />
        <MainContent full>
          <Stack
            gap="6"
            p={{ base: "4", md: "8" }}
            height="[calc(100dvh - 96px)]"
            minH="0"
          >
            <RecommendationsGrid />
          </Stack>
        </MainContent>
      </Stack>
    </APIProtected>
  );
}
