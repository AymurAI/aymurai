import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type {
  RecommendationOrigin,
  RecommendationStatus,
} from "@/context/Recommendation";
import {
  failed,
  loaded,
  startChecking,
  startExtracting,
  startParsing,
  stopped,
  useRecommendation,
  useRecommendationDispatch,
} from "@/context/Recommendation";
import {
  documentExtractionEnvelope,
  extractDocument,
} from "@/services/aymurai/dataExtraction";
import { fileParser } from "@/services/aymurai/queries";

export interface UseDataExtractionResult {
  status: RecommendationStatus;
  origin: RecommendationOrigin | null;
  error: string | null;
  /** Terminal, no retry offered — see `RecommendationState.isScannedPdf`. */
  isScannedPdf: boolean;
  retry: () => void;
  abort: () => void;
}

/**
 * Runs the Recomendaciones pipeline for a single document — parse, then
 * check the backend for anything already stored, and only run the LLM
 * extraction if nothing is — dispatching each stage to the shared
 * Recommendation context (Task 9) as it resolves.
 *
 * Decision table on the lookup (`documentExtractionEnvelope`):
 *   - a stored validation exists    -> origin "validation", no LLM call.
 *   - only a stored prediction      -> origin "stored-inference", no LLM call.
 *   - neither exists (null / null)  -> origin "inference", runs `extractDocument`.
 *   - the lookup itself fails       -> terminal `"error"`, NEVER falls through
 *     to extraction. The historical client failed open to `null` here, so a
 *     transient GET failure silently replaced a saved human validation with
 *     fresh model output — never again.
 */
export function useDataExtraction(
  file: File | undefined,
): UseDataExtractionResult {
  const state = useRecommendation();
  const dispatch = useRecommendationDispatch();
  const queryClient = useQueryClient();

  // A stable placeholder so the query factories (which read `.name`/`.size`
  // off the file synchronously to build their query keys) never see
  // `undefined` — the queries themselves stay `enabled: false` until a real
  // file/documentId is available, so this is never actually fetched.
  const targetFile = useMemo(() => file ?? new File([], ""), [file]);

  // StrictMode double-invokes effects, and TanStack's `cancelQueries` on a
  // query with no prior data produces no error state, so three guards:
  const startedFor = useRef<string | null>(null); // synchronous latch by documentId
  const abortRef = useRef<AbortController | null>(null);
  const manualStop = useRef(false);

  // Guards the initial `startParsing` dispatch the same way `startedFor`
  // guards the extraction mutate() call below — without it, StrictMode's
  // double-invoke would reset the shared context back to "parsing" a second
  // time even after later stages had already advanced past it.
  const startedParsingFor = useRef<string | null>(null);

  const parseQuery = useQuery({
    ...fileParser(targetFile),
    enabled: file !== undefined,
  });

  useEffect(() => {
    if (!file || manualStop.current) return;
    if (startedParsingFor.current === file.name) return;
    startedParsingFor.current = file.name;
    dispatch(startParsing(file.name));
  }, [file, dispatch]);

  useEffect(() => {
    if (manualStop.current) return;
    if (!parseQuery.isError) return;
    dispatch(
      failed(
        parseQuery.error instanceof Error
          ? parseQuery.error.message
          : "No se pudo leer el documento.",
      ),
    );
  }, [parseQuery.isError, parseQuery.error, dispatch]);

  const documentId = parseQuery.data?.document_id;
  const paragraphs = parseQuery.data?.document;

  useEffect(() => {
    if (manualStop.current) return;
    if (!parseQuery.isSuccess || !parseQuery.data) return;
    // A parse can succeed and still yield zero paragraphs (an image-only /
    // scanned PDF: `documentExtractSchema.document` is an unconstrained
    // string[]). There is nothing to check or extract in that case, and it
    // will not succeed on a second attempt — terminal, no retry offered.
    if (parseQuery.data.document.length === 0) {
      dispatch(
        failed("No se pudo extraer texto del documento.", {
          isScannedPdf: true,
        }),
      );
      return;
    }
    dispatch(startChecking(parseQuery.data.document_id));
  }, [parseQuery.isSuccess, parseQuery.data, dispatch]);

  const envelopeQuery = useQuery({
    ...documentExtractionEnvelope(documentId ?? ""),
    enabled: documentId !== undefined && (paragraphs?.length ?? 0) > 0,
  });

  const mutation = useMutation(extractDocument());

  // Cancel any in-flight extraction on unmount (or when the target document
  // changes) instead of leaving it orphaned. This also means a genuine
  // remount (e.g. navigate to preview and back) never races an old,
  // still-running request: the old one is aborted first. Ported from the
  // historical desktop-app's identical cleanup effect
  // (`useDataExtraction.ts`, branch `feat/recomendaciones-defensoria`).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `documentId` is listed only to re-run this cleanup when the target document changes -- it is not read by the callback itself.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, [documentId]);

  useEffect(() => {
    if (manualStop.current) return;
    if (!envelopeQuery.isSuccess || documentId === undefined) return;
    const { prediction, validation } = envelopeQuery.data;

    if (validation != null) {
      dispatch(
        loaded({
          origin: "validation",
          prediction: prediction ?? null,
          validation,
          catalogsStale: envelopeQuery.data.catalogs_stale,
        }),
      );
      return;
    }

    if (prediction != null) {
      dispatch(
        loaded({
          origin: "stored-inference",
          prediction,
          validation: null,
          catalogsStale: envelopeQuery.data.catalogs_stale,
        }),
      );
      return;
    }

    // Neither stored — the only branch that ever spends an inference.
    dispatch(startExtracting());
    if (startedFor.current === documentId) return;
    startedFor.current = documentId;
    const controller = new AbortController();
    abortRef.current = controller;
    mutation.mutate({
      documentId,
      paragraphs: paragraphs ?? [],
      signal: controller.signal,
    });
    // `mutation.mutate` is stable across renders (TanStack Query memoizes
    // it), so listing it here does not cause extra re-runs.
  }, [
    envelopeQuery.isSuccess,
    envelopeQuery.data,
    documentId,
    paragraphs,
    dispatch,
    mutation.mutate,
  ]);

  useEffect(() => {
    // Fails closed: never falls through to `extractDocument`. The historical
    // client resolved a lookup failure to `null` (same shape as "nothing
    // stored"), which silently replaced a saved human validation with a
    // fresh model run. This dispatches a terminal error instead and stops.
    if (manualStop.current) return;
    if (!envelopeQuery.isError) return;
    dispatch(
      failed(
        envelopeQuery.error instanceof Error
          ? envelopeQuery.error.message
          : "No se pudo verificar si ya existe una extracción guardada.",
      ),
    );
  }, [envelopeQuery.isError, envelopeQuery.error, dispatch]);

  useEffect(() => {
    if (manualStop.current) return;
    if (!mutation.isSuccess || mutation.data === undefined) return;
    if (documentId === undefined) return;
    dispatch(
      loaded({
        origin: "inference",
        prediction: mutation.data,
        validation: null,
        catalogsStale: mutation.data.catalogs_stale,
      }),
    );
  }, [mutation.isSuccess, mutation.data, documentId, dispatch]);

  useEffect(() => {
    if (manualStop.current) return;
    if (!mutation.isError) return;
    dispatch(
      failed(
        mutation.error instanceof Error
          ? mutation.error.message
          : "No se pudo generar la extracción.",
      ),
    );
  }, [mutation.isError, mutation.error, dispatch]);

  const retry = () => {
    // Defense in depth: a scanned PDF is terminal (mirrors the historical
    // hook's "nothing to retry without a documentId" guard) — the UI already
    // hides the Reintentar affordance in this case, but this must refuse too
    // in case a caller invokes it directly.
    if (!file || state.isScannedPdf) return;
    manualStop.current = false;

    // Whichever stage hasn't succeeded yet is the one that needs re-running
    // -- it either failed outright, or it's the one Stop aborted mid-flight.
    // Checking `isSuccess` rather than `isError` is what makes a stopped
    // stage retriable too: `queryClient.cancelQueries` on a query with no
    // prior data (see `abort` below) does NOT flip that query into an error
    // state, so gating on `isError` alone would leave `retry` a no-op after
    // Stop. This mirrors the historical hook's identical criterion
    // (`!query.isSuccess` -> refetch that stage, else re-run the mutation).
    if (!parseQuery.isSuccess) {
      dispatch(startParsing(file.name));
      parseQuery.refetch();
      return;
    }
    if (documentId === undefined) return;
    if (!envelopeQuery.isSuccess) {
      dispatch(startChecking(documentId));
      envelopeQuery.refetch();
      return;
    }
    dispatch(startExtracting());
    const controller = new AbortController();
    abortRef.current = controller;
    mutation.mutate({
      documentId,
      paragraphs: paragraphs ?? [],
      signal: controller.signal,
    });
  };

  const abort = () => {
    manualStop.current = true;
    abortRef.current?.abort();
    queryClient.cancelQueries({ queryKey: fileParser(targetFile).queryKey });
    if (documentId !== undefined) {
      queryClient.cancelQueries({
        queryKey: documentExtractionEnvelope(documentId).queryKey,
      });
    }
    dispatch(stopped());
  };

  return {
    status: state.status,
    origin: state.origin,
    error: state.error,
    isScannedPdf: state.isScannedPdf,
    retry,
    abort,
  };
}
