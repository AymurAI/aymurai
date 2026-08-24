import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SummaryProvider, {
  edit,
  editTitle,
  error,
  finish,
  reset,
  restoreValidation,
  setPartialText,
  start,
  stop,
  useSummary,
  useSummaryDispatch,
} from "./Summary";

function wrapper({ children }: { children: React.ReactNode }) {
  return <SummaryProvider>{children}</SummaryProvider>;
}

describe("Summary context", () => {
  it("starts in idle state", () => {
    const { result } = renderHook(() => useSummary(), { wrapper });
    expect(result.current.status).toBe("idle");
    expect(result.current.document).toBeNull();
  });

  it("start() sets status to streaming and derives a default title", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("acta.docx")));
    expect(result.current.state.status).toBe("streaming");
    expect(result.current.state.title).toBe("Resumen acta.docx");
  });

  it("setPartialText() replaces (not appends to) partialText", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(setPartialText("Hola")));
    act(() => result.current.dispatch(setPartialText("Hola mundo")));
    expect(result.current.state.partialText).toBe("Hola mundo");
  });

  it("finish() sets status to completed, parses the summary into a document, and stores the document id", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() =>
      result.current.dispatch(
        finish("Primer párrafo.\n\nSegundo párrafo.", "doc-1"),
      ),
    );
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.document?.content).toHaveLength(2);
    expect(result.current.state.documentId).toBe("doc-1");
  });

  it("error()/stop() set the corresponding status", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(error("boom")));
    expect(result.current.state.status).toBe("error");
    expect(result.current.state.error).toBe("boom");

    act(() => result.current.dispatch(stop()));
    expect(result.current.state.status).toBe("stopped");
  });

  it("edit()/editTitle() update the document and title without touching status", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(finish("Texto.", "doc-1")));
    act(() =>
      result.current.dispatch(
        edit({ type: "doc", content: [{ type: "paragraph" }] }),
      ),
    );
    act(() => result.current.dispatch(editTitle("Nuevo título")));
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.document).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(result.current.state.title).toBe("Nuevo título");
  });

  it("restoreValidation() overwrites document and title without touching status or documentId", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(finish("Texto generado.", "doc-1")));
    act(() =>
      result.current.dispatch(
        restoreValidation(
          { type: "doc", content: [{ type: "paragraph" }] },
          "Título validado",
        ),
      ),
    );
    expect(result.current.state.status).toBe("completed");
    expect(result.current.state.documentId).toBe("doc-1");
    expect(result.current.state.document).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(result.current.state.title).toBe("Título validado");
  });

  it("edit()/editTitle() mark the summary as user-edited", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(finish("Texto.", "doc-1")));
    expect(result.current.state.hasUserEdited).toBe(false);

    act(() =>
      result.current.dispatch(
        edit({ type: "doc", content: [{ type: "paragraph" }] }),
      ),
    );
    expect(result.current.state.hasUserEdited).toBe(true);
  });

  it("start() resets hasUserEdited for the next document", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(finish("Texto.", "doc-1")));
    act(() =>
      result.current.dispatch(
        edit({ type: "doc", content: [{ type: "paragraph" }] }),
      ),
    );
    act(() => result.current.dispatch(start("b.docx")));
    expect(result.current.state.hasUserEdited).toBe(false);
  });

  it("reset() returns to the initial state", () => {
    const { result } = renderHook(
      () => ({ state: useSummary(), dispatch: useSummaryDispatch() }),
      { wrapper },
    );
    act(() => result.current.dispatch(start("a.docx")));
    act(() => result.current.dispatch(reset()));
    expect(result.current.state.status).toBe("idle");
    expect(result.current.state.title).toBe("");
  });
});
