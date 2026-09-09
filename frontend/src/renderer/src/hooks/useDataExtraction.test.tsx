import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as RecommendationContext from "@/context/Recommendation";
import RecommendationProvider from "@/context/Recommendation";
import api from "@/services/api";
import type {
  DataExtractionPrediction,
  DocumentExtractionEnvelope,
  RecommendationValidation,
} from "@/types/dataExtraction";
import { useDataExtraction } from "./useDataExtraction";

// Pinned exactly like `services/aymurai/dataExtraction.test.ts`'s
// "real (non-mock) implementation" suite: exercising the decision table
// through the mocked `api` client, not the mock-data branch.
vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_DATA_EXTRACTION: false,
}));

// Must satisfy `documentExtractSchema`'s `z.uuid()` (RFC 4122 version/variant
// nibbles), unlike `dataExtraction.test.ts`'s DOCUMENT_ID, which only ever
// flows through `z.string()` fields.
const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";

function aPrediction(): DataExtractionPrediction {
  return {
    document_id: DOCUMENT_ID,
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [],
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: false,
    publishable_content: "Contenido publicable.",
    config: { model: "m", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
  };
}

function aValidation(): RecommendationValidation {
  return {
    id: "val-1",
    document_id: DOCUMENT_ID,
    recommendation_number: "123/2026",
    recommendation_date_text: "22 de noviembre",
    recommendation_date: null,
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: false,
    publishable_content: "Contenido publicable.",
    recipients: [],
    source_text: "texto fuente",
    prediction: {},
  };
}

let extractSpy: ReturnType<
  typeof vi.fn<() => Promise<DataExtractionPrediction>>
>;

/** Controls what GET /llm/data-extraction/{id} resolves (or rejects) with. */
function mockEnvelope(
  partial: Pick<DocumentExtractionEnvelope, "prediction" | "validation">,
) {
  vi.spyOn(api, "get").mockResolvedValue({
    data: {
      document_id: DOCUMENT_ID,
      catalogs_stale: false,
      updated_at: null,
      ...partial,
    },
  });
}

function mockEnvelopeError(error: Error) {
  vi.spyOn(api, "get").mockRejectedValue(error);
}

/**
 * Wires POST /misc/document-extract (always succeeds, single non-empty
 * paragraph) and POST /llm/data-extraction (routed through `extractSpy`, so
 * tests can assert whether the model was ever actually called).
 */
function setUpPosts() {
  extractSpy = vi
    .fn<() => Promise<DataExtractionPrediction>>()
    .mockResolvedValue(aPrediction());
  vi.spyOn(api, "post").mockImplementation(async (url: string) => {
    if (url === "/misc/document-extract") {
      return {
        data: {
          document_id: DOCUMENT_ID,
          footer: null,
          header: null,
          document: ["Un párrafo con texto seleccionable."],
        },
      };
    }
    if (url === "/llm/data-extraction") {
      const result = await extractSpy();
      return { data: result };
    }
    throw new Error(`unexpected POST ${url}`);
  });
}

function renderUseDataExtraction() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const file = new File(["contenido"], "acta.pdf", {
    type: "application/pdf",
  });
  const hook = renderHook(() => useDataExtraction(file), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RecommendationProvider>{children}</RecommendationProvider>
      </QueryClientProvider>
    ),
  });
  return { ...hook, queryClient, file };
}

describe("useDataExtraction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs an extraction when the server holds nothing", async () => {
    setUpPosts();
    mockEnvelope({ prediction: null, validation: null });

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.origin).toBe("inference"));
    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("ready");
  });

  it("reuses a stored extraction without calling the model", async () => {
    setUpPosts();
    mockEnvelope({ prediction: aPrediction(), validation: null });

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.origin).toBe("stored-inference"));
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it("reuses a stored validation without calling the model", async () => {
    setUpPosts();
    mockEnvelope({ prediction: aPrediction(), validation: aValidation() });

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.origin).toBe("validation"));
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it("fails closed: a lookup error never falls through to an extraction", async () => {
    setUpPosts();
    mockEnvelopeError(new Error("network down"));

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(extractSpy).not.toHaveBeenCalled();
    expect(result.current.isScannedPdf).toBe(false);
  });

  it("terminates without offering a retry when the document has no extractable text", async () => {
    extractSpy = vi
      .fn<() => Promise<DataExtractionPrediction>>()
      .mockResolvedValue(aPrediction());
    vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === "/misc/document-extract") {
        return {
          data: {
            document_id: DOCUMENT_ID,
            footer: null,
            header: null,
            document: [],
          },
        };
      }
      if (url === "/llm/data-extraction") {
        const result = await extractSpy();
        return { data: result };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    vi.spyOn(api, "get");

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.isScannedPdf).toBe(true);
    expect(api.get).not.toHaveBeenCalled();
    expect(extractSpy).not.toHaveBeenCalled();
  });

  it("resumes correctly after Stop mid envelope-search, then retry", async () => {
    setUpPosts();
    // Never resolves on its own -- simulates the envelope GET still being
    // in flight when Stop is pressed (`cancelQueries` on a query with no
    // prior data does not itself settle the promise; see `abort`'s note in
    // `useDataExtraction.ts`).
    vi.spyOn(api, "get").mockImplementationOnce(() => new Promise(() => {}));

    const { result } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.status).toBe("checking"));

    act(() => result.current.abort());
    expect(result.current.status).toBe("stopped");

    // Retry must be reachable and effective with no error flag ever having
    // been set (Stop alone never produces one) -- this is the regression:
    // `retry()` used to require `parseQuery.isError`/`envelopeQuery.isError`/
    // `mutation.isError`, none of which a manual Stop ever sets.
    mockEnvelope({ prediction: null, validation: null });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.origin).toBe("inference"));
    expect(result.current.status).toBe("ready");
    expect(extractSpy).toHaveBeenCalledTimes(1);
  });

  it("stays ready after a background refetch of the file-parser query resolves with a new object", async () => {
    // Reproduces the "notification sounds, spinner keeps spinning" bug: a
    // background refetch (e.g. React Query's default `refetchOnWindowFocus`
    // after an Alt-Tab) can resolve with a referentially-new `data` object
    // even when the meaningful content (document_id, paragraphs) is
    // unchanged -- structural sharing only preserves identity when EVERY
    // field matches, and a real parse response can carry a field that
    // legitimately varies between identical calls (a server-side timestamp,
    // a request id echoed in an unused header, etc). Before the
    // `startedCheckingFor` guard, any such reference change re-ran the
    // parse-success effect and re-dispatched `startChecking`, silently
    // rewinding `status` from "ready" back to "checking" with nothing left
    // to move it forward again.
    extractSpy = vi
      .fn<() => Promise<DataExtractionPrediction>>()
      .mockResolvedValue(aPrediction());
    let parseCalls = 0;
    vi.spyOn(api, "post").mockImplementation(async (url: string) => {
      if (url === "/misc/document-extract") {
        parseCalls += 1;
        return {
          data: {
            document_id: DOCUMENT_ID,
            // Varies between calls with the document_id and paragraphs held
            // fixed -- exactly the shape of harmless-looking field drift
            // that defeats structural sharing without changing anything
            // downstream logic actually reads.
            footer: parseCalls === 1 ? null : "",
            header: null,
            document: ["Un párrafo con texto seleccionable."],
          },
        };
      }
      if (url === "/llm/data-extraction") {
        const result = await extractSpy();
        return { data: result };
      }
      throw new Error(`unexpected POST ${url}`);
    });
    mockEnvelope({ prediction: aPrediction(), validation: null });

    const { result, queryClient, file } = renderUseDataExtraction();

    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ["file-parser", file.name, file.size],
      });
    });
    expect(parseCalls).toBe(2);

    expect(result.current.status).toBe("ready");
  });

  it("does not re-run the pipeline from scratch when the screen remounts but the shared context already resolved", async () => {
    // `RecommendationProvider` is mounted once for the whole `/$feature/*`
    // route tree, so its state survives navigating away from processing
    // (e.g. to validation) and back -- but `useDataExtraction`'s own refs
    // are fresh on every remount of the screen that calls it. Before the
    // `state.status !== "idle"` guard, that remount re-dispatched
    // `startParsing` unconditionally, wiping the already-resolved
    // prediction/origin back to a blank slate -- the "bell rings once, then
    // the spinner never stops" bug: the reset restarts a pipeline the
    // person can no longer see restart, since nothing here prompts a second
    // notification once `hasNotified` (scoped to the OLD hook instance) is
    // gone too.
    setUpPosts();
    mockEnvelope({ prediction: aPrediction(), validation: null });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const file = new File(["contenido"], "acta.pdf", {
      type: "application/pdf",
    });
    const box: { current: ReturnType<typeof useDataExtraction> | null } = {
      current: null,
    };
    function Consumer() {
      box.current = useDataExtraction(file);
      return null;
    }
    function tree(mounted: boolean) {
      return (
        <QueryClientProvider client={queryClient}>
          <RecommendationProvider>{mounted && <Consumer />}</RecommendationProvider>
        </QueryClientProvider>
      );
    }

    const { rerender } = render(tree(true));
    await waitFor(() => expect(box.current?.status).toBe("ready"));
    expect(box.current?.origin).toBe("stored-inference");

    // Spied only from here: the action creator is also called once,
    // legitimately, during the initial mount above.
    const startParsingSpy = vi.spyOn(RecommendationContext, "startParsing");

    // Unmount just the screen (RecommendationProvider itself stays put, at
    // the same tree position, so React never remounts it or resets its
    // reducer state) ...
    act(() => {
      rerender(tree(false));
    });
    // ... then remount it, as happens navigating back to processing.
    act(() => {
      rerender(tree(true));
    });

    // The real bug: everything here resolves near-instantly, so a reset
    // (dispatching `startParsing` again) races back to "ready" before any
    // later check can observe the dip -- asserting on final `status` alone
    // can't tell "never reset" apart from "reset, then recovered". Whether
    // the action creator got called again cannot be raced away like that.
    expect(startParsingSpy).not.toHaveBeenCalled();

    await waitFor(() => expect(box.current?.status).toBe("ready"));
    expect(box.current?.origin).toBe("stored-inference");
  });
});
