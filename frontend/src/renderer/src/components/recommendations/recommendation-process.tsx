import { Button, Callout, Card, CheckCircle, Spinner } from "@aymurai/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Footer from "@/components/layout/footer";
import Header from "@/components/layout/header";
import MainContent from "@/components/layout/main-content";
import BackButton from "@/components/ui/back-button";
import RequireFile from "@/features/RequireFile";
import { useFiles } from "@/hooks";
import { useDataExtraction } from "@/hooks/useDataExtraction";
import { SectionTitle } from "@/layout/section-title";
import taskbar from "@/services/taskbar";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import { FeatureFlowEnum, featureNamespace } from "@/types/features";

const spinnerSlot = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: "0",
  w: "12",
  h: "12",
});

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
 *
 * Status indicator matches `summary-process.tsx`'s pattern (a `Spinner`
 * while running, a `CheckCircle` once ready) rather than the generic
 * per-file `<FileProcessing>` progress bar: a single LLM call has no
 * meaningful numeric progress to report, so a determinate-looking bar and
 * an elapsed-seconds ticker both read as noise rather than signal.
 */
export default function RecommendationProcess() {
  const feature = FeatureFlowEnum.Recommendations;
  const { t } = useTranslation(featureNamespace[feature]);
  const navigate = useNavigate();

  const files = useFiles();
  const file = files[0];

  const extraction = useDataExtraction(file?.data);
  const hasNotified = useRef(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const isReady = extraction.status === "ready";
  const isError = extraction.status === "error";
  // A manual Stop must be retriable too -- see `useDataExtraction`'s `retry`,
  // which no longer requires an error flag to fire. `status` stays "stopped"
  // internally (distinct copy/visuals below), but the Reintentar affordance
  // has to treat it the same as "error" or the button would never appear.
  const isStopped = extraction.status === "stopped";

  useEffect(() => {
    if (isReady && !hasNotified.current) {
      hasNotified.current = true;
      taskbar.notify();
    }
  }, [isReady]);

  // Homologa con el banner dismissable de Anonimizador/Resumen
  // (`routes/$feature/process.tsx`, `summary-process.tsx`): se vuelve a
  // mostrar si el estado cambia (p. ej. tras un Reintentar).
  useEffect(() => {
    setIsDismissed(false);
  }, [extraction.status]);

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
              <HStack justifyContent="space-between" alignItems="center">
                <Stack direction="column" gap="1">
                  <styled.h2 textStyle="subtitle.md.default">
                    {isReady
                      ? t("process.finishedTitle")
                      : isStopped
                        ? t("process.stoppedTitle")
                        : isError
                          ? t("process.errorTitle")
                          : t("process.processingTitle")}
                  </styled.h2>
                  <styled.p textStyle="subtitle.sm.default" color="text.lighter">
                    {isReady
                      ? t("process.finishedSubtitle")
                      : isStopped
                        ? t("process.stoppedSubtitle")
                        : isError
                          ? t("process.errorSubtitle")
                          : t("process.processingSubtitle")}
                  </styled.p>
                </Stack>
                <HStack gap="4" alignItems="center">
                  {!isReady && !isError && !isStopped && (
                    <Button variant="secondary" onClick={handleAbort}>
                      {t("process.stop")}
                    </Button>
                  )}
                  <div className={spinnerSlot}>
                    {!isReady && !isError && !isStopped && <Spinner />}
                    {isReady && (
                      <CheckCircle aria-label={t("process.completedAria")} />
                    )}
                  </div>
                </HStack>
              </HStack>

              {isReady && extraction.origin === "stored-inference" && (
                <Callout
                  message={t("process.storedInference")}
                  variant="info"
                  size="compact"
                  noBorder
                />
              )}

              {(isError || isStopped) && (
                <Stack gap="3" direction="column" alignItems="flex-start">
                  {/* Same `Callout` + `variant="error"` + dismissable `X`
                      used by the Anonimizador/Resumen process screens for
                      both a real error and a manual Stop (`routes/$feature/
                      process.tsx`, `summary-process.tsx`) -- despite the
                      name, that variant renders in the same burnt-orange
                      tone as this screen's own `catalogsStale` warning, so
                      it already reads as a non-destructive notice, not a
                      hard failure. */}
                  {isError && !isDismissed && (
                    <Callout
                      message={t(
                        extraction.isScannedPdf
                          ? "process.noTextError"
                          : "process.errorText",
                      )}
                      variant="error"
                      noBorder
                      onDismiss={() => setIsDismissed(true)}
                    />
                  )}
                  {isStopped && !isDismissed && (
                    <Callout
                      message={t("process.stoppedText")}
                      variant="error"
                      noBorder
                      onDismiss={() => setIsDismissed(true)}
                    />
                  )}
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
