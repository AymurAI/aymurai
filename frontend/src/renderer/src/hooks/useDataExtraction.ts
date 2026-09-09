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
  // Same guard for `startChecking`, one stage later. Without it, any
  // background refetch of `parseQuery` that returns a referentially-new
  // `data` (structural sharing only preserves identity for deeply-equal
  // results) re-runs this effect and re-dispatches `startChecking` --
  // silently rewinding `status` from "ready" back to "checking" after the
  // pipeline had already finished, with no further trigger to move it
  // forward again (the envelope/extraction effects below only ever fire
  // once per resolved document via their own `startedFor` guard).
  const startedCheckingFor = useRef<string | null>(null);

  const parseQuery = useQuery({
    ...fileParser(targetFile),
    enabled: file !== undefined,
  });

  useEffect(() => {
    if (!file || manualStop.current) return;
    if (startedParsingFor.current === file.name) return;
    // `RecommendationProvider` is mounted once for the whole `/$feature/*`
    // route tree (`routes/$feature/route.tsx`), so its state survives this
    // screen unmounting -- but this hook's own refs are fresh on every
    // remount. Navigating away (e.g. to validation) and back to processing
    // for the SAME document therefore used to blindly re-dispatch
    // `startParsing`, which reset the shared state back to `initialState`
    // (wiping `prediction`/`origin` too) even when it already held "ready".
    //
    // A remount must still restart the pipeline in two cases, though: a
    // genuinely different document (`sourceFileName` no longer matches --
    // otherwise a second file would silently keep showing the first one's
    // stale "ready" prediction, notifying the taskbar bell immediately for
    // work that was never actually done on it), and the same document
    // recovering from "error"/"stopped" (there is no separate Reintentar
    // affordance any more -- going back to Selección de archivo and
    // continuing again, which remounts this hook, is the only way back in,
    // matching Anonimizador/Resumen).
    const isNewDocument = state.sourceFileName !== file.name;
    const isRecoverable = state.status === "error" || state.status === "stopped";
    if (state.status !== "idle" && !isNewDocument && !isRecoverable) return;
    startedParsingFor.current = file.name;
    dispatch(startParsing(file.name));
  }, [file, dispatch, state.status, state.sourceFileName]);

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
    if (startedCheckingFor.current === parseQuery.data.document_id) return;
    // `parseQuery`'s cached success survives a remount even when the shared
    // context has already moved past "parsing" (checking/extracting/ready/
    // error/stopped) -- without this, every remount of an already-resolved
    // document re-dispatched `startChecking`, silently rewinding `status`
    // from "ready" back to "checking" (a visible spinner flicker) before the
    // envelope effect below raced it back to "ready".
    if (state.status !== "parsing") return;
    startedCheckingFor.current = parseQuery.data.document_id;
    dispatch(startChecking(parseQuery.data.document_id));
  }, [parseQuery.isSuccess, parseQuery.data, dispatch, state.status]);

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
    // Same shape as the `startChecking` guard above: `envelopeQuery`'s
    // cached success also survives a remount of an already-resolved (or
    // already-extracting) document. Without this, every remount re-ran this
    // whole branch — including, for a document that needed a fresh
    // inference, unconditionally dispatching `startExtracting` (flickering
    // the checkmark back to a spinner) and then genuinely calling
    // `mutation.mutate` again, spending a second, non-deterministic LLM call
    // nobody asked for, since the result isn't persisted server-side until
    // the person validates it (so the envelope keeps reporting "nothing
    // stored" on every lookup).
    if (state.status !== "checking") return;
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
    state.status,
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
    abort,
  };
}
