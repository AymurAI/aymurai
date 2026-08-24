import {
  Outlet,
  createFileRoute,
  redirect,
  useParams,
} from "@tanstack/react-router";

import FileProvider from "@/context/File";
import SummaryProvider from "@/context/Summary";
import TranscriptionProvider from "@/context/Transcription";
import APIProtected from "@/features/APIProtected";
import { Stack } from "@/styled/jsx";
import {
  FeatureFlowEnum,
  getFeatureRouteSlug,
  parseFeatureRouteSlug,
} from "@/types/features";

export const Route = createFileRoute("/$feature")({
  // The URL carries the lowercase slug ("dataset"); everything inside the app
  // carries the FeatureFlowEnum value ("DATA_SET"). Mapping here — the one
  // route that owns the $feature segment — means no call site ever converts:
  // `params={{ feature }}` and `useParams().feature` both stay the enum, and
  // TanStack applies `stringify` when it builds hrefs.
  params: {
    parse: (raw: Record<string, string>) => {
      const feature = parseFeatureRouteSlug(raw.feature ?? "");
      if (!feature) throw redirect({ to: "/home/features" });
      return { feature };
    },
    stringify: ({ feature }: { feature: FeatureFlowEnum }) => ({
      feature: getFeatureRouteSlug(feature),
    }),
  },
  component: AppLayoutRoute,
});

function AppLayoutRoute() {
  const { feature } = useParams({ from: "/$feature" });
  const isVoice = feature === FeatureFlowEnum.VoiceToText;
  const isSummarizer = feature === FeatureFlowEnum.Summarizer;
  const inner = (
    <Stack
      width="full"
      height="[100dvh]"
      minHeight="0"
      gap="0"
      overflow="hidden"
    >
      <FileProvider>
        <Outlet key={feature} />
      </FileProvider>
    </Stack>
  );
  const wrapped = isVoice ? (
    <TranscriptionProvider>{inner}</TranscriptionProvider>
  ) : isSummarizer ? (
    <SummaryProvider>{inner}</SummaryProvider>
  ) : (
    inner
  );
  return <APIProtected>{wrapped}</APIProtected>;
}
