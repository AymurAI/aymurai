import { Button, Callout } from "@aymurai/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileAnnotator } from "@/components";
import Footer from "@/components/layout/footer";
import Header from "@/components/layout/header";
import {
  loaded,
  useRecommendation,
  useRecommendationDispatch,
} from "@/context/Recommendation";
import { useFiles } from "@/hooks";
import { SectionTitle } from "@/layout/section-title";
import {
  extractDocument,
  validateRecommendation,
} from "@/services/aymurai/dataExtraction";
import { css } from "@/styled/css";
import { Grid, Stack } from "@/styled/jsx";
import type { RecommendationValidationInput } from "@/types/dataExtraction";
import { FeatureFlowEnum } from "@/types/features";
import { buildAnnotations } from "@/utils/recommendations/build-annotations";
import RecommendationForm from "./recommendation-form";

// Grid items stretch to the row height by default, but their content can
// still overflow that stretched box unless min-height is pinned to 0 --
// mirrors `summary-validation.tsx`'s identical pane, same underlying reason
// (the taller of the two panes would otherwise push the whole row past the
// header/footer instead of scrolling internally).
const validationPane = css({
  height: "full",
  minHeight: "[0]",
  overflow: "hidden",
});

/**
 * Recomendaciones' validation screen: the payoff of the flow, and the first
 * place `<RecommendationForm>` (Task 11, wired to `<RecipientFields>` in
 * Task 12) mounts on a real screen instead of in isolation. Reads the
 * `RecommendationState` the previous screen already populated via
 * `useDataExtraction` (Task 10) from the shared context (Task 9) -- this
 * screen does not fetch the extraction itself.
 *
 * Ported from the historical desktop-app
 * (`components/recomendaciones/validation.tsx`, branch
 * `feat/recomendaciones-defensoria`), rewired onto the Recommendation
 * context instead of `file.recomendacion`: the historical screen persisted
 * the edited values into `DocFile.recomendacion` via
 * `reducers/file/actions.ts`'s `setRecomendacion`/`validate`, a shared
 * reducer this feature no longer uses -- that file is intentionally left
 * untouched, and this screen keeps its own state in the Recommendation
 * context instead.
 *
 * Reverses the historical failure handling on purpose. The historical
 * screen navigated on to `finish` even when the save failed, because
 * `/llm/data-extraction/{id}/validate` didn't exist on the backend yet and
 * failing was the expected path (see its `saveFailed` toast, worded "podés
 * continuar de todos modos"). The endpoint exists now and the server is the
 * source of truth for the structured recommendations base, so a save
 * failure here blocks navigation instead: walking on would silently lose
 * the person's corrections.
 */
export default function RecommendationValidation() {
  const feature = FeatureFlowEnum.Recommendations;
  const { t } = useTranslation("recommendations");
  const navigate = useNavigate();

  const recommendation = useRecommendation();
  const dispatch = useRecommendationDispatch();
  const file = useFiles()[0];

  const [payload, setPayload] = useState<RecommendationValidationInput | null>(
    null,
  );
  const [saveFailed, setSaveFailed] = useState(false);
  const [reExtractFailed, setReExtractFailed] = useState(false);

  const saveMutation = useMutation(validateRecommendation());
  const reExtractMutation = useMutation(extractDocument());

  // Built once from the model's inference, not from the person's live
  // edits -- `buildAnnotations` (Task 8) takes the `DataExtractionPrediction`
  // itself, so highlighting does not track in-progress edits (matching the
  // historical screen's own choice to highlight from the saved/inferred
  // values, not a live diff).
  //
  // A real limitation this screen inherits from how `buildAnnotations`
  // (`utils/recommendations/build-annotations.ts`) builds its fields: each
  // recipient is paired to its highlight by array index
  // (`recipient:${index}:name`, see that file's `fieldsToLocate`), not a
  // stable id -- `RecipientPrediction` has none. If the person deletes a
  // recipient (via `<RecommendationForm>`'s "Eliminar destinatario")
  // *before* saving, the highlight for every recipient after the deleted
  // one can point at the wrong name/position until the extraction is
  // reloaded fresh. Not fixed here -- the historical screen had the
  // identical limitation -- just flagged again at the point where it
  // actually surfaces.
  const annotations = useMemo(
    () =>
      recommendation.prediction
        ? buildAnnotations(recommendation.prediction, file?.paragraphs ?? [])
        : new Map(),
    [recommendation.prediction, file?.paragraphs],
  );

  const handleReExtract = () => {
    if (!recommendation.documentId) return;
    setReExtractFailed(false);
    reExtractMutation.mutate(
      {
        documentId: recommendation.documentId,
        paragraphs: (file?.paragraphs ?? []).map(
          (paragraph) => paragraph.value,
        ),
        useCache: false,
      },
      {
        onSuccess: (prediction) => {
          dispatch(
            loaded({
              origin: "inference",
              prediction,
              validation: null,
              catalogsStale: prediction.catalogs_stale,
            }),
          );
        },
        // A silent failure here is exactly what this task exists to avoid
        // for the save path -- the same must hold for re-extraction: without
        // this, a failed request just re-enables the button with no
        // feedback, and the person has no way to tell a retry is needed.
        onError: () => {
          setReExtractFailed(true);
        },
      },
    );
  };

  const handleValidate = async () => {
    if (!recommendation.documentId || !payload) return;
    setSaveFailed(false);
    try {
      const validation = await saveMutation.mutateAsync({
        documentId: recommendation.documentId,
        payload,
      });
      dispatch(
        loaded({
          origin: "validation",
          prediction: recommendation.prediction,
          validation,
          catalogsStale: recommendation.catalogsStale,
        }),
      );
      navigate({ to: "/$feature/finish", params: { feature } });
    } catch {
      // The server is now the source of truth for the structured
      // recommendations base -- unlike the historical screen, a failed save
      // must never navigate on silently. Staying here (with the error
      // shown) is what actually lets the person retry instead of losing
      // their corrections with no trace.
      setSaveFailed(true);
    }
  };

  // `RequireRecommendation` only guards "at least a prediction or a
  // validation exists" (Task 9) -- a stored validation with no matching
  // stored prediction is a real envelope shape the backend can return
  // (`DocumentExtractionEnvelope.prediction` is nullable independently of
  // `validation`). `<RecommendationForm>` needs the raw prediction (for
  // `suggestions`/`sector_candidates`), so this is a hard stop rather than a
  // crash on `prediction!`.
  if (!file || !recommendation.prediction) {
    return (
      <>
        <Header title={t("title")} feature={feature} currentStep={3} />
        <Callout
          message={t("validation.missingPrediction")}
          variant="error"
          role="alert"
        />
      </>
    );
  }

  return (
    <>
      <Header title={t("title")} feature={feature} currentStep={3} />
      <Grid
        columns={2}
        gap="0"
        flex="1"
        minHeight="0"
        overflow="hidden"
        justifyContent="stretch"
        alignItems="stretch"
      >
        <section
          className={validationPane}
          aria-label={t("validation.originalDocumentLabel")}
        >
          <FileAnnotator file={file} extraAnnotations={annotations} />
        </section>
        <Stack
          position="relative"
          px={{ base: "6", xl: "[100px]" }}
          py={{ base: "6", xl: "16" }}
          overflowY="auto"
          overflowX="hidden"
          gap={{ base: "8", xl: "16" }}
          bg="bg.primary"
          minHeight="0"
          minWidth="0"
        >
          <SectionTitle className={css({ whiteSpace: "nowrap" })}>
            {t("validation.sectionTitle")}
          </SectionTitle>

          {recommendation.origin === "stored-inference" && (
            <Callout message={t("validation.storedInference")} variant="info" />
          )}
          {recommendation.origin === "validation" && (
            <Callout
              message={t("validation.alreadyValidated")}
              variant="success"
            />
          )}
          {recommendation.catalogsStale && (
            <Stack gap="3" direction="column" alignItems="flex-start">
              <Callout
                message={t("validation.catalogsStale")}
                variant="warning"
              />
              <Button
                variant="secondary"
                onClick={handleReExtract}
                disabled={reExtractMutation.isPending}
              >
                {t("validation.reExtract")}
              </Button>
              {reExtractFailed && (
                <Callout
                  message={t("validation.reExtractFailed")}
                  variant="error"
                  role="alert"
                />
              )}
            </Stack>
          )}

          <RecommendationForm
            prediction={recommendation.prediction}
            validation={recommendation.validation}
            onValuesChange={setPayload}
          />

          {saveFailed && (
            <Callout
              message={t("validation.saveFailed")}
              variant="error"
              role="alert"
            />
          )}
        </Stack>
      </Grid>
      <Footer withBuiltBy>
        <Button
          size="md"
          onClick={handleValidate}
          disabled={saveMutation.isPending}
        >
          {t("validation.validate")}
        </Button>
      </Footer>
    </>
  );
}
