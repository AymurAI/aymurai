import { Button, Callout, Spinner } from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AxiosError } from "axios";
import { type Dispatch, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import FileAnnotator from "@/components/file-annotator";
import Footer from "@/components/layout/footer";
import Header from "@/components/layout/header";
import { FileContext, FileDispatchContext } from "@/context/File";
import { showToast } from "@/features/showToast";
import { SectionTitle } from "@/layout/section-title";
import type { Action } from "@/reducers/file";
import {
  correctRecommendation,
  recommendationDetail,
  recommendationsList,
} from "@/services/aymurai/dataExtraction";
import { css } from "@/styled/css";
import { Grid, HStack, Stack, styled } from "@/styled/jsx";
import type {
  RecommendationDetail,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import { FeatureFlowEnum } from "@/types/features";
import type { DocFile } from "@/types/file";
import { buildAnnotations } from "@/utils/recommendations/build-annotations";
import type { PendingValidationField } from "@/utils/recommendations/pending-validation-fields";
import { predictionFromDetail } from "@/utils/recommendations/prediction-from-detail";
import RecommendationForm from "./recommendation-form";

const page = css({
  display: "flex",
  flexDirection: "column",
  width: "full",
  height: "[100dvh]",
  minH: "0",
  overflow: "hidden",
  bg: "bg.primary",
});

const statusText = css({
  textStyle: "paragraph.sm.default",
  color: "text.lighter",
});

const panes = css({
  flex: "1",
  minH: "0",
  overflow: "hidden",
  bg: "bg.primary",
});

// Same reason as `recommendation-validation.tsx`'s `validationPane`: a grid
// item stretches to the row height but its content still overflows that
// stretched box unless min-height is pinned to 0, which is what makes each
// pane scroll internally instead of pushing the screen taller.
const documentPane = css({
  height: "full",
  minHeight: "[0]",
  overflow: "hidden",
  bg: "bg.secondary",
});

/**
 * This screen's `<FileContext.Provider>` is read-only on purpose: the only
 * file in it is synthetic, `<FileAnnotator>` mounts here with annotation
 * disabled, and the global store keys files by `data.name` — a dispatch
 * escaping into it could collide with a real upload in flight elsewhere.
 */
const NOOP_DISPATCH: Dispatch<Action> = () => {};

/**
 * Rebuilds the `DocFile` the annotator needs from what the server stored,
 * with no re-upload and no trip through the global file store.
 *
 * `data` is a real (if synthetic) `File`, never `undefined`:
 * `AnnotationProvider` dereferences `file.data.name` unconditionally inside
 * seven `useCallback`s on every render — regardless of `isAnnotable` — so a
 * missing `data` crashes the whole screen synchronously on mount.
 *
 * The paragraph split is the exact inverse of how the backend composed
 * `source_text` in the first place (`"\n".join(payload.document.document)`,
 * `routers/defensoria/data_extraction.py`), so it round-trips exactly —
 * except for the one documented case where a paragraph contained its own
 * newline, which the join made indistinguishable from a paragraph boundary
 * and no split can recover (issue #58). See this component's test suite,
 * which pins both halves of that statement.
 */
function syntheticDocFile(detail: RecommendationDetail): DocFile {
  return {
    data: new File([detail.source_text], `recomendacion-${detail.id}.txt`, {
      type: "text/plain",
    }),
    // Deterministic ids: the annotator keys paragraphs (and the highlight map
    // from `buildAnnotations`) by them, so they must be stable across renders
    // and across a refetch of the same recommendation.
    paragraphs: detail.source_text.split("\n").map((value, index) => ({
      value,
      id: `${detail.id}-p${index}`,
      document_id: detail.document_id,
    })),
    selected: true,
    validationObject: {},
  };
}

interface Props {
  recommendationId: string;
}

/**
 * The correction screen (`/home/dataset/$recommendationId`): the one place a
 * field that came from the original document — tema, subtema, destinatarios,
 * contenido publicable, número y fecha — can be fixed on an already-saved
 * recommendation, without re-uploading the file (issue #58).
 *
 * It reuses the wizard's two validation-step components as independent
 * blocks: `<FileAnnotator>` fed a reconstructed `DocFile`, and
 * `<RecommendationForm>` fed a reconstructed prediction plus the saved
 * validation. It does NOT reuse the wizard's flow — no `RecommendationState`
 * context, no global `FileContext`, no stepper: this is not a step of
 * anything, it is a single edit of one stored row.
 *
 * ADR-0013 inverted: `validation` is never null here (the row exists by
 * definition), so `useRecommendationForm`'s `buildInitial` seeds every field
 * with the SAVED validated value instead of blanking it behind a suggestion
 * mark. Blanking is for a first validation pass, where the model's guess is
 * the only answer on offer; on a correction the person is editing their own
 * earlier answer and must see it.
 */
export default function RecommendationCorrection({ recommendationId }: Props) {
  const { t } = useTranslation("recommendations");
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const detailQuery = useQuery(recommendationDetail(recommendationId));
  const save = useMutation(correctRecommendation());

  const [payload, setPayload] = useState<RecommendationValidationInput | null>(
    null,
  );
  const [pendingFields, setPendingFields] = useState<PendingValidationField[]>(
    [],
  );
  const [confirmUnvalidated, setConfirmUnvalidated] = useState(false);
  // Which KIND of save failure, not just "one happened": a request that never
  // got an answer ("network") is a connection problem worth naming as one; a
  // request the server answered with an error ("server": 422, 500, 404 because
  // the row was deleted elsewhere) is not, and telling the person to check
  // their connection sends them to look at the one thing that demonstrably
  // works.
  const [saveError, setSaveError] = useState<"network" | "server" | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);

  const detail = detailQuery.data;

  // A confirmation belongs to the exact list the person was shown — same
  // reasoning as `recommendation-validation.tsx`, where every edit recomputes
  // the list into a new array so a stale "yes" can't wave through fields that
  // were still pending when it was given.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pendingFields is used only as an identity signal, not read in the body
  useEffect(() => {
    setConfirmUnvalidated(false);
  }, [pendingFields]);

  // `predictionFromDetail` parses the stored blob rather than casting it, so
  // a row written by an older extraction shape throws here. That is a missing
  // suggestion overlay, not a broken screen — but the form needs a prediction
  // to render at all, so it is reported instead of crashing the route.
  const prediction = useMemo(() => {
    if (!detail) return null;
    try {
      return predictionFromDetail(detail);
    } catch {
      return null;
    }
  }, [detail]);

  const docFile = useMemo(
    () => (detail ? syntheticDocFile(detail) : null),
    [detail],
  );
  const localFiles = useMemo(() => (docFile ? [docFile] : []), [docFile]);

  // Same "where does this value come from" highlight the wizard shows, tracking
  // whatever the person currently has on screen (`payload`) and falling back to
  // the model's own suggestion while a field is still blank.
  const annotations = useMemo(
    () =>
      prediction
        ? buildAnnotations(prediction, docFile?.paragraphs ?? [], payload)
        : new Map(),
    [prediction, docFile?.paragraphs, payload],
  );

  const goBack = () => navigate({ to: "/home/dataset" });

  // The backend's own `_etag` convention: `updated_at` when set, else
  // `created_at`. Sent as `If-Match` so a save against a snapshot somebody
  // else has already replaced is refused (412) rather than silently
  // overwriting their work.
  const etag = detail ? (detail.updated_at ?? detail.created_at) : null;

  const labelByField: Record<PendingValidationField["labelKey"], string> = {
    recommendationNumber: t("validation.recommendationNumber"),
    recommendationDate: t("validation.recommendationDate"),
    topic: t("validation.topic"),
    subtopic: t("validation.subtopic"),
    macroSector: t("validation.macroSector"),
    name: t("validation.name"),
    position: t("validation.position"),
    unit: t("validation.unit"),
  };
  const pendingLabels = pendingFields.map(({ labelKey, recipientIndex }) =>
    recipientIndex === undefined
      ? labelByField[labelKey]
      : `${t("validation.recipientLabel")} ${recipientIndex + 1}: ${labelByField[labelKey]}`,
  );

  const handleSave = async () => {
    if (!payload || !etag || conflict) return;
    // ADR-0013 (enmienda 2026-09-18): a field the person cleared is about to
    // be persisted empty. Name those fields once; the next press goes through.
    if (pendingFields.length > 0 && !confirmUnvalidated) {
      showToast(
        t("validation.unvalidatedFieldsWarning", {
          fields: pendingLabels.join(", "),
        }),
        "warning",
      );
      setConfirmUnvalidated(true);
      return;
    }
    setSaveError(null);
    try {
      await save.mutateAsync({ recommendationId, ifMatch: etag, payload });
      // Every page/filter combination of the grilla is its own cache entry
      // (the factory keys on the whole params object), so the corrected row
      // only shows up on return if the whole prefix is invalidated — read off
      // the factory, the same reflex as the grilla's own PATCH.
      queryClient.invalidateQueries({
        queryKey: [recommendationsList({}).queryKey[0]],
      });
      queryClient.invalidateQueries({
        queryKey: recommendationDetail(recommendationId).queryKey,
      });
      goBack();
    } catch (error) {
      // A 412 is NOT a transient failure to retry — retrying is exactly what
      // `If-Match` exists to prevent, since the second attempt would carry the
      // same stale etag and clobber a save this screen never saw. The person
      // reloads the detail (remounting the form on the fresh values via a
      // changed `key`) and decides again.
      if (error instanceof AxiosError && error.response?.status === 412) {
        setConflict(true);
        return;
      }
      // An `AxiosError` WITH a `response` means the request reached the server
      // and came back refused (same narrowing `settings/subtopics-panel.tsx`
      // uses); anything else -- no `response` at all, or a non-Axios throw --
      // is a request that never got an answer, which is the only case where
      // "revisá tu conexión" is actually the right advice.
      setSaveError(
        error instanceof AxiosError && error.response ? "server" : "network",
      );
    }
  };

  const handleReload = async () => {
    setReloadFailed(false);
    const result = await detailQuery.refetch();
    if (result.error) {
      setReloadFailed(true);
      return;
    }
    setConflict(false);
    setSaveError(null);
  };

  const editHeader = (
    <Header
      title={t("correction.title")}
      feature={FeatureFlowEnum.Recommendations}
    />
  );

  if (detailQuery.isPending) {
    return (
      <div className={page}>
        {editHeader}
        <HStack
          justify="center"
          gap="3"
          flex="1"
          aria-live="polite"
          aria-busy="true"
        >
          <Spinner />
          <styled.p className={statusText}>{t("correction.loading")}</styled.p>
        </HStack>
      </div>
    );
  }

  if (detailQuery.isError || !detail || !prediction || !docFile) {
    return (
      <div className={page}>
        {editHeader}
        <Stack gap="4" flex="1" p={{ base: "6", xl: "12" }}>
          <Callout
            variant="error"
            role="alert"
            message={
              detail && !prediction
                ? t("correction.predictionUnavailable")
                : t("correction.loadFailed")
            }
          />
        </Stack>
        <Footer withBuiltBy>
          <Button variant="secondary" size="md" onClick={goBack}>
            {t("correction.back")}
          </Button>
        </Footer>
      </div>
    );
  }

  return (
    <div className={page}>
      {editHeader}
      <Grid
        className={panes}
        gridTemplateColumns={{
          base: "[minmax(0, 1fr)]",
          lg: "[repeat(2, minmax(0, 1fr))]",
        }}
        gridTemplateRows={{
          base: "[minmax(0, 1fr) minmax(0, 1fr)]",
          lg: "[minmax(0, 1fr)]",
        }}
        gap="0"
        justifyContent="stretch"
        alignItems="stretch"
      >
        <section
          className={documentPane}
          aria-label={t("correction.originalDocumentLabel")}
        >
          <FileContext.Provider value={localFiles}>
            <FileDispatchContext.Provider value={NOOP_DISPATCH}>
              <FileAnnotator file={docFile} extraAnnotations={annotations} />
            </FileDispatchContext.Provider>
          </FileContext.Provider>
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
          <SectionTitle>{t("correction.sectionTitle")}</SectionTitle>

          {conflict && (
            <Stack gap="3" alignItems="flex-start">
              <Callout
                variant="warning"
                role="alert"
                message={t("correction.conflict")}
              />
              <Button
                variant="secondary"
                onClick={handleReload}
                disabled={detailQuery.isFetching}
              >
                {t("correction.reload")}
              </Button>
              {reloadFailed && (
                <Callout
                  variant="error"
                  role="alert"
                  message={t("correction.reloadFailed")}
                />
              )}
            </Stack>
          )}

          {saveError && (
            <Callout
              variant="error"
              role="alert"
              message={
                saveError === "server"
                  ? t("correction.saveRejected")
                  : t("correction.saveFailed")
              }
            />
          )}

          <RecommendationForm
            key={`${detail.id}:${etag}`}
            prediction={prediction}
            validation={detail}
            onValuesChange={setPayload}
            onPendingFieldsChange={setPendingFields}
          />
        </Stack>
      </Grid>

      <Footer withBuiltBy>
        <HStack gap="3">
          <Button variant="secondary" size="md" onClick={goBack}>
            {t("correction.cancel")}
          </Button>
          <Button
            size="md"
            onClick={handleSave}
            disabled={save.isPending || conflict || !payload}
          >
            {confirmUnvalidated
              ? t("correction.saveAnyway")
              : t("correction.save")}
          </Button>
        </HStack>
      </Footer>
    </div>
  );
}
