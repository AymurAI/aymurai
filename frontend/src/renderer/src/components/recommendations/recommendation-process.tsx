import { Button, Callout, Card } from "@aymurai/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileProcessing } from "@/components";
import Footer from "@/components/layout/footer";
import Header from "@/components/layout/header";
import MainContent from "@/components/layout/main-content";
import BackButton from "@/components/ui/back-button";
import { formatTime } from "@/components/voice-to-text/format-time";
import RequireFile from "@/features/RequireFile";
import { useFiles } from "@/hooks";
import { useDataExtraction } from "@/hooks/useDataExtraction";
import type { PredictStatus } from "@/hooks/usePredict";
import { SectionTitle } from "@/layout/section-title";
import taskbar from "@/services/taskbar";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import { FeatureFlowEnum, featureNamespace } from "@/types/features";

/**
 * Recomendaciones' processing step: a single-file variant of the generic
 * `DocumentProcess` (`routes/$feature/process.tsx`). There is no per-
 * paragraph prediction here — `useDataExtraction` owns the whole pipeline
 * (parse -> lookup -> maybe extract) and reports back through the shared
 * Recommendation context (Task 9), so this screen only has to reflect that
 * single status, not aggregate several per-file tables like the generic
 * screen does.
 *
 * Ported from the historical desktop-app
 * (`components/recomendaciones/process.tsx`, branch
 * `feat/recomendaciones-defensoria`), rewired onto `useDataExtraction` and
 * the destination's `FeatureFlowEnum`.
 */
export default function RecommendationProcess() {
  const feature = FeatureFlowEnum.Recommendations;
  const { t } = useTranslation(featureNamespace[feature]);
  const navigate = useNavigate();

  const files = useFiles();
  const file = files[0];

  const extraction = useDataExtraction(file?.data);
  const hasNotified = useRef(false);

  const isReady = extraction.status === "ready";
  const isError = extraction.status === "error";

  // A real local LLM extraction can take minutes with no numeric progress to
  // report (see `progress` below). Without any moving signal, a healthy slow
  // extraction is indistinguishable from a hang — this is purely an
  // elapsed-time indicator, additive to `progress`/`combinedStatus`.
  const isExtracting = extraction.status === "extracting";
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!isExtracting) {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => clearInterval(interval);
  }, [isExtracting]);

  // `useDataExtraction`'s own status already accounts for every stage
  // (parsing/checking/extracting), so — unlike the generic screen — there is
  // no separate per-stage table to fold in here.
  const combinedStatus: PredictStatus =
    extraction.status === "stopped"
      ? "stopped"
      : isError
        ? "error"
        : isReady
          ? "completed"
          : "processing";

  // No per-paragraph ratio to weight here: it's a single LLM call, so we
  // report an indeterminate 0.5 while it runs and 1 once it's done.
  const progress = isReady ? 1 : 0.5;

  useEffect(() => {
    if (isReady && !hasNotified.current) {
      hasNotified.current = true;
      taskbar.notify();
    }
  }, [isReady]);

  const handleNext = () => {
    navigate({ to: "/$feature/validation", params: { feature } });
  };

  const handleAbort = () => {
    extraction.abort();
  };

  return (
    <RequireFile>
      <Header title={t("title")} feature={feature} currentStep={2} />
      <MainContent>
        <Stack gap="10">
          <HStack alignItems="center" gap="6">
            <BackButton to="/$feature/preview" params={{ feature }} />
            <SectionTitle>{t("process.sectionTitle")}</SectionTitle>
          </HStack>
          <Card className={css({ alignItems: "stretch" })}>
            <Stack gap="6" direction="column">
              <Stack direction="column" gap="1">
                <styled.h2 textStyle="subtitle.md.default">
                  {t("process.processingTitle")}
                </styled.h2>
                <styled.p textStyle="subtitle.sm.default" color="text.lighter">
                  {t("process.processingSubtitle")}
                </styled.p>
                {isExtracting && (
                  <styled.p
                    textStyle="subtitle.sm.default"
                    color="text.lighter"
                  >
                    {t("process.extracting", {
                      elapsed: formatTime(elapsedMs),
                    })}
                  </styled.p>
                )}
              </Stack>
              {file && (
                <FileProcessing
                  fileName={file.data.name}
                  status={combinedStatus}
                  progress={progress}
                  onAbort={handleAbort}
                />
              )}
              {isError && (
                <Stack gap="3" direction="column" alignItems="flex-start">
                  <Callout
                    message={t(
                      extraction.isScannedPdf
                        ? "process.noTextError"
                        : "process.errorText",
                    )}
                    variant="error"
                    noBorder
                  />
                  {/* A scanned PDF is terminal: it will not succeed on a
                      second attempt, and Reintentar would just waste the
                      person's time. */}
                  {!extraction.isScannedPdf && (
                    <Button variant="secondary" onClick={extraction.retry}>
                      {t("process.retry")}
                    </Button>
                  )}
                </Stack>
              )}
            </Stack>
          </Card>
        </Stack>
      </MainContent>
      <Footer withBuiltBy>
        <Button onClick={handleNext} disabled={!isReady}>
          {t("process.next")}
        </Button>
      </Footer>
    </RequireFile>
  );
}
