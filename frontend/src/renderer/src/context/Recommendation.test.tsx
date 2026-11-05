import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  DataExtractionPrediction,
  RecommendationValidation,
} from "@/types/dataExtraction";
import RecommendationProvider, {
  failed,
  loaded,
  reset,
  startChecking,
  startExtracting,
  startParsing,
  stopped,
  useRecommendation,
  useRecommendationDispatch,
} from "./Recommendation";

function wrapper({ children }: { children: React.ReactNode }) {
  return <RecommendationProvider>{children}</RecommendationProvider>;
}

const makePrediction = (): DataExtractionPrediction => ({
  document_id: "doc-1",
  recommendation_number: "123/2026",
  recommendation_date: "2026-01-01",
  recipients: [],
  topic: null,
  subtopic: null,
  personal_data: null,
  publishable_content: "",
  config: { model: "m", options: {}, catalogs_hash: "hash" },
  catalogs_stale: false,
});

const makeValidation = (): RecommendationValidation => ({
  id: "val-1",
  document_id: "doc-1",
  recommendation_number: "123/2026",
  recommendation_date_text: "1 de enero",
  recommendation_date: "2026-01-01",
  topic: null,
  subtopic: null,
  personal_data: null,
  publishable_content: "",
  recipients: [],
  source_text: "texto",
  prediction: {},
});

describe("Recommendation context", () => {
  it("starts in idle state", () => {
    const { result } = renderHook(() => useRecommendation(), { wrapper });
    expect(result.current.status).toBe("idle");
    expect(result.current.prediction).toBeNull();
    expect(result.current.validation).toBeNull();
  });

  it("startParsing() sets status to parsing and stores the source file name", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(startParsing("acta.pdf")));
    expect(result.current.state.status).toBe("parsing");
    expect(result.current.state.sourceFileName).toBe("acta.pdf");
  });

  it("startChecking() sets status to checking and stores the document id", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(startParsing("acta.pdf")));
    act(() => result.current.dispatch(startChecking("doc-1")));
    expect(result.current.state.status).toBe("checking");
    expect(result.current.state.documentId).toBe("doc-1");
  });

  it("startExtracting() sets status to extracting", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(startParsing("acta.pdf")));
    act(() => result.current.dispatch(startChecking("doc-1")));
    act(() => result.current.dispatch(startExtracting()));
    expect(result.current.state.status).toBe("extracting");
  });

  it("loaded() with origin validation leaves both prediction and validation populated", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    const prediction = makePrediction();
    const validation = makeValidation();
    act(() =>
      result.current.dispatch(
        loaded({
          origin: "validation",
          prediction,
          validation,
          catalogsStale: false,
        }),
      ),
    );
    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.origin).toBe("validation");
    expect(result.current.state.prediction).toEqual(prediction);
    expect(result.current.state.validation).toEqual(validation);
    expect(result.current.state.catalogsStale).toBe(false);
  });

  it("failed() with isScannedPdf leaves a terminal error state", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() =>
      result.current.dispatch(
        failed("No se pudo extraer texto del PDF", { isScannedPdf: true }),
      ),
    );
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toBe("No se pudo extraer texto del PDF");
    expect(result.current.state.isScannedPdf).toBe(true);
  });

  it("failed() without options defaults isScannedPdf to false", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(failed("boom")));
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.isScannedPdf).toBe(false);
  });

  it("stopped() sets status to stopped", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(startParsing("acta.pdf")));
    act(() => result.current.dispatch(stopped()));
    expect(result.current.state.status).toBe("stopped");
  });

  it("reset() returns to the initial state", () => {
    const { result } = renderHook(
      () => ({
        state: useRecommendation(),
        dispatch: useRecommendationDispatch(),
      }),
      { wrapper },
    );
    act(() => result.current.dispatch(startParsing("acta.pdf")));
    act(() =>
      result.current.dispatch(
        loaded({
          origin: "inference",
          prediction: makePrediction(),
          validation: null,
          catalogsStale: false,
        }),
      ),
    );
    act(() => result.current.dispatch(reset()));
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.sourceFileName).toBeNull();
    expect(result.current.state.prediction).toBeNull();
  });
});
