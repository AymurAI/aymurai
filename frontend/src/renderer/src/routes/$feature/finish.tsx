import {
  createFileRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import FinishAnonymizer from "@/components/finish/finish-anonymizer";
import FinishDataset from "@/components/finish/finish-dataset";
import Header from "@/components/layout/header";
import RecommendationFinish from "@/components/recommendations/recommendation-finish";
import SummaryFinish from "@/components/summarizer/summary-finish";
import VoiceFinish from "@/components/voice-to-text/finish";
import RequireFile from "@/features/RequireFile";
import RequireSummary from "@/features/RequireSummary";
import { useFileDispatch } from "@/hooks";
import { removeAllFiles } from "@/reducers/file/actions";
import { FeatureFlowEnum, featureNamespace } from "@/types/features";

export const Route = createFileRoute("/$feature/finish")({
  component: RouteComponent,
});

function RouteComponent() {
  const params = useParams({ from: "/$feature/finish" });
  if (params.feature === FeatureFlowEnum.VoiceToText) return <VoiceFinish />;
  if (params.feature === FeatureFlowEnum.Recommendations)
    return <RecommendationFinishRoute />;
  if (params.feature === FeatureFlowEnum.Summarizer)
    return (
      <RequireFile>
        <RequireSummary>
          <SummaryFinish />
        </RequireSummary>
      </RequireFile>
    );
  return <DocumentFinish />;
}

function DocumentFinish() {
  const navigate = useNavigate();
  const params = useParams({ from: "/$feature/finish" });
  const { feature } = params;

  const { t } = useTranslation(featureNamespace[feature]);
  const dispatch = useFileDispatch();

  const handleRestart = () => {
    dispatch(removeAllFiles());
    navigate({ to: "/$feature/onboarding", params });
  };

  return (
    <RequireFile>
      <Header title={t("title")} currentStep={4} feature={feature} />

      {feature === FeatureFlowEnum.Dataset ? (
        <FinishDataset onRestart={handleRestart} />
      ) : (
        <FinishAnonymizer />
      )}
    </RequireFile>
  );
}

// Recommendations is single-file (see `filesForFeatureLoad`) and doesn't
// share `DocumentFinish`'s Dataset/Anonymizer branching, so it gets its own
// route wrapper -- same shape as the Summarizer branch above, following the
// historical desktop-app's own dedicated `RecomendacionFinishRoute`
// (`routes/app.$feature/finish.tsx`, branch
// `feat/recomendaciones-defensoria`).
function RecommendationFinishRoute() {
  const feature = FeatureFlowEnum.Recommendations;
  const params = useParams({ from: "/$feature/finish" });
  const navigate = useNavigate();
  const { t } = useTranslation(featureNamespace[feature]);
  const dispatch = useFileDispatch();

  const handleRestart = () => {
    dispatch(removeAllFiles());
    navigate({ to: "/$feature/onboarding", params });
  };

  return (
    <RequireFile>
      <Header title={t("title")} currentStep={4} feature={feature} />
      <RecommendationFinish onRestart={handleRestart} />
    </RequireFile>
  );
}
