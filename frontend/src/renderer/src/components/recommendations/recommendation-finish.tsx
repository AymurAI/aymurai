import { Button, Callout } from "@aymurai/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import FileCheck from "@/components/file-check";
import FinishMainContent from "@/components/finish/finish-main-content";
import Footer from "@/components/layout/footer";
import { useFiles } from "@/hooks";
import { downloadRecommendationsExport } from "@/services/aymurai/dataExtraction";
import { downloadBlob } from "@/services/export/download-blob";
import { css } from "@/styled/css";
import { HStack } from "@/styled/jsx";
import { FeatureFlowEnum, featureNamespace } from "@/types/features";

interface RecommendationFinishProps {
  onRestart: () => void;
}

const EXPORT_FILE_NAME = "recomendaciones.xlsx";

// Spans every column of `FinishMainContent`'s 4-column FileCheck grid so the
// error banner reads as a single full-width row instead of one more grid
// item squeezed into a column.
const fullWidthCallout = css({ gridColumn: "1 / -1" });

/**
 * Recommendations' finish step: mirrors `finish-dataset.tsx`'s layout
 * (a `FileCheck` grid inside `FinishMainContent`, `Footer` with the two
 * actions).
 *
 * The one deliberate partial rewrite in this plan, not a faithful port. The
 * historical desktop-app screen (`components/recomendaciones/finish.tsx`,
 * branch `feat/recomendaciones-defensoria`) submitted the already-validated
 * `RecomendacionState` into a shared local `.xlsx` on mount, via
 * `submitRecomendacion`/`localIsoDate` (upsert by `DOCUMENT_ID`), then let
 * the person open that file with `filesystem.excel.open`. That local
 * workbook is no longer the source of truth (ANALYSIS §C.2/§C.3) -- the
 * previous screen (`recommendation-validation.tsx`, Task 13) already saves
 * the validated recommendation to the server via `validateRecommendation`
 * and blocks navigation here on a save failure, so by the time this screen
 * mounts the file shown is already confirmed, not "pending write". There is
 * therefore no submission effect left to run at all: this screen's only job
 * is to offer the export of the server's structured base, via
 * `downloadRecommendationsExport` (Task 6) and the same `downloadBlob`
 * helper the anonymizer and summarizer finish screens already use.
 */
export default function RecommendationFinish({
  onRestart,
}: RecommendationFinishProps) {
  const feature = FeatureFlowEnum.Recommendations;
  const { t } = useTranslation(featureNamespace[feature]);
  const files = useFiles();

  const [downloadFailed, setDownloadFailed] = useState(false);
  const downloadMutation = useMutation(downloadRecommendationsExport());

  const handleDownload = async () => {
    setDownloadFailed(false);
    try {
      const blob = await downloadMutation.mutateAsync("xlsx");
      downloadBlob(blob, EXPORT_FILE_NAME);
    } catch {
      setDownloadFailed(true);
    }
  };

  return (
    <>
      <FinishMainContent feature={feature}>
        {files.map(({ data }) => (
          <FileCheck key={data.name} fileName={data.name} />
        ))}
        {downloadFailed && (
          <Callout
            className={fullWidthCallout}
            message={t("finish.downloadFailed")}
            variant="error"
            role="alert"
          />
        )}
      </FinishMainContent>
      <Footer withBuiltBy>
        <HStack alignItems="center" gap="4">
          <Button variant="secondary" onClick={onRestart} size="md">
            {t("finish.restart")}
          </Button>
          <Button
            size="md"
            onClick={handleDownload}
            disabled={downloadMutation.isPending}
            isLoading={downloadMutation.isPending}
          >
            {t("finish.download")}
          </Button>
        </HStack>
      </Footer>
    </>
  );
}
