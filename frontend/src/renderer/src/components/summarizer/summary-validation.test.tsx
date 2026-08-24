import {
  documentFromPlainText,
  serializeDocumentToPlainText,
} from "@aymurai/ui";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import SummaryValidation from "./summary-validation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockFiles = [
  {
    data: new File(["x"], "acta.docx"),
    paragraphs: [
      { id: "p0", document_id: "d0", value: "Texto original completo." },
    ],
    selected: true,
    validationObject: {},
  },
];
vi.mock("@/hooks", () => ({ useFiles: () => mockFiles }));

const mockDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Resumen generado." }],
    },
  ],
};

const formattedDocument = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Texto validado a mano.",
          marks: [{ type: "bold" }],
        },
      ],
    },
  ],
};

const { mockDispatch, mockSave, mockLoad, mockNavigate } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockSave: vi.fn().mockResolvedValue(undefined),
  mockLoad: vi.fn().mockResolvedValue(null),
  mockNavigate: vi.fn(),
}));

let mockSummaryState = {
  status: "completed",
  document: mockDocument,
  documentId: "doc-0",
  title: "Resumen acta.docx",
  sourceFileName: "acta.docx",
  hasUserEdited: false,
};

vi.mock("@/context/Summary", () => ({
  useSummary: () => mockSummaryState,
  useSummaryDispatch: () => mockDispatch,
  edit: (document: unknown) => ({ type: "edit", document }),
  editTitle: (title: string) => ({ type: "editTitle", title }),
  restoreValidation: (document: unknown, title: string) => ({
    type: "restoreValidation",
    document,
    title,
  }),
}));

vi.mock("@/services/aymurai/summaryValidationClient", () => ({
  summaryValidationClient: { save: mockSave, load: mockLoad },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

// Header/BackButton compose Radix `Link`/`createLink` from `@tanstack/react-router`,
// which needs a real router context — stub them like the sibling
// summary-process/voice-to-text tests do.
vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));

vi.mock("@/components/ui/back-button", () => ({
  default: () => <button type="button">back</button>,
}));

describe("SummaryValidation", () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    mockNavigate.mockClear();
    mockSave.mockClear();
    mockSave.mockResolvedValue(undefined);
    mockLoad.mockClear();
    mockLoad.mockResolvedValue(null);
    mockSummaryState = {
      status: "completed",
      document: mockDocument,
      documentId: "doc-0",
      title: "Resumen acta.docx",
      sourceFileName: "acta.docx",
      hasUserEdited: false,
    };
  });

  it("renders both the original document panel and the summary editor", () => {
    render(<SummaryValidation />);
    expect(screen.getByText(/Texto original completo/)).toBeInTheDocument();
    expect(screen.getByText("Resumen generado.")).toBeInTheDocument();
  });

  it("saves via the persistence adapter when the editor content changes", () => {
    render(<SummaryValidation />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        // The backend's text_to_uuid(text) identity, threaded through
        // Summary state from the /llm/summarize response — not a display
        // filename and not a paragraph-level id from a different id
        // namespace. See the "does not collide" test below for why two
        // different documents must not share a save key.
        documentId: "doc-0",
        title: "Resumen acta.docx",
      }),
    );
  });

  it("awaits the save before navigating when Finalizar is clicked", async () => {
    render(<SummaryValidation />);
    fireEvent.click(screen.getByText("validation.finish"));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/$feature/finish" }),
      ),
    );
  });

  it("shows the save-failed error and stays on screen instead of navigating away, but continues on a second click", async () => {
    mockSave.mockRejectedValueOnce(new Error("network down"));
    render(<SummaryValidation />);

    fireEvent.click(screen.getByText("validation.finish"));

    await screen.findByText("validation.saveFailed");
    expect(mockNavigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("validation.finish"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/$feature/finish" }),
      ),
    );
  });

  it("dedupes a save already in flight instead of firing a second network write", async () => {
    let resolveSave!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(<SummaryValidation />);

    // Realistic sequence: finishing an edit blurs the editor (kicking off a
    // save), then the user immediately clicks "Finalizar" before that save
    // has resolved — this used to fire a second, uncoordinated
    // `summaryValidationClient.save()` call.
    fireEvent.blur(screen.getByRole("textbox"));
    fireEvent.click(screen.getByText("validation.finish"));

    expect(mockSave).toHaveBeenCalledTimes(1);

    resolveSave();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/$feature/finish" }),
      ),
    );
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  // Adversary: the test above pins the dedup for the case it was written for -
  // blur and click inside ONE user gesture, where both saves would carry
  // identical content, so collapsing them loses nothing. But `handleSave`
  // (summary-validation.tsx:57-58) coalesces unconditionally: it hands back
  // `inFlightSaveRef.current` whatever it contains, and that promise's payload
  // was serialised from `summary.document` at the moment the FIRST save
  // started. Nothing compares content, and nothing re-saves when the in-flight
  // write settles, so any edit made while a slow write is outstanding is
  // dropped - while `handleContinue` awaits that stale promise, sees `true`,
  // and navigates away as if the save had succeeded.
  it("persists an edit made while an earlier save is still in flight instead of coalescing it away", async () => {
    const paragraph = mockDocument.content[0].content[0];
    const originalText = paragraph.text;
    // Restore the shared mock document even when this test fails, so no other
    // test in the file depends on the order it ran in.
    onTestFinished(() => {
      paragraph.text = originalText;
    });

    let resolveFirstSave!: () => void;
    mockSave.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstSave = resolve;
        }),
    );

    const { rerender } = render(<SummaryValidation />);

    // 1. The user finishes an edit; leaving the editor starts save #1. The
    //    write is slow and still outstanding.
    fireEvent.blur(screen.getByRole("textbox"));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(
      serializeDocumentToPlainText(mockSave.mock.calls[0][0].editedSummary),
    ).toContain("Resumen generado.");

    // 2. The user goes back in, corrects the summary, and clicks "Finalizar"
    //    before that first write has come back.
    paragraph.text = "Resumen corregido a mano.";
    rerender(<SummaryValidation />);
    fireEvent.click(screen.getByText("validation.finish"));

    // 3. The first write lands and the app leaves the screen.
    resolveFirstSave();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({ to: "/$feature/finish" }),
      ),
    );

    // The correction must have reached the persistence adapter before the app
    // reported success and navigated away.
    const lastPayload = mockSave.mock.calls.at(-1)?.[0];
    expect(serializeDocumentToPlainText(lastPayload?.editedSummary)).toContain(
      "Resumen corregido a mano.",
    );
  });

  // Adversary: two different rulings that happen to be filed under the same
  // filename (very common: "sentencia.docx" exported from two different case
  // folders) must not share a save key. The key comes from Summary state's
  // documentId — the backend's text_to_uuid(text) identity for this
  // summarization, which differs whenever the source text does — never from
  // the display filename or a paragraph-level id from an unrelated namespace.
  it("keys the persisted summary so two different documents with the same filename do not collide", () => {
    const originalSummaryState = mockSummaryState;
    onTestFinished(() => {
      mockSummaryState = originalSummaryState;
    });

    // Two separate visits to the screen - the real sequence (validate one
    // ruling, later validate another) - so each gets its own component
    // instance and neither save can be coalesced into the other.
    mockSummaryState = { ...originalSummaryState, documentId: "case-a" };
    const { unmount } = render(<SummaryValidation />);
    fireEvent.blur(screen.getByRole("textbox"));
    const keyForA = mockSave.mock.calls.at(-1)?.[0]?.documentId;
    unmount();

    mockSummaryState = { ...originalSummaryState, documentId: "case-b" };
    render(<SummaryValidation />);
    fireEvent.blur(screen.getByRole("textbox"));
    const keyForB = mockSave.mock.calls.at(-1)?.[0]?.documentId;

    // Both saves really happened - guards against a vacuous pass where the
    // second blur never reached the adapter at all.
    expect(mockSave).toHaveBeenCalledTimes(2);
    expect(keyForA).toBeTruthy();
    expect(keyForB).toBeTruthy();

    // Distinct documents must land under distinct keys, or the second save
    // destroys the first document's persisted summary and `load()` can never
    // tell them apart again.
    expect(keyForB).not.toBe(keyForA);
  });

  it("looks up a stored validation for the current document on mount", async () => {
    render(<SummaryValidation />);
    await waitFor(() =>
      expect(mockLoad).toHaveBeenCalledWith("doc-0", expect.anything()),
    );
  });

  it("leaves the freshly generated summary in place when the document was never human-validated", async () => {
    mockLoad.mockResolvedValue({
      documentId: "doc-0",
      title: "",
      generatedSummary: "Resumen generado.",
      editedSummary: documentFromPlainText("Resumen generado."),
      hasValidation: false,
    });

    render(<SummaryValidation />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "restoreValidation" }),
    );
  });

  it("restores the saved validation instead of the freshly generated summary when reopening a validated document", async () => {
    mockLoad.mockResolvedValue({
      documentId: "doc-0",
      title: "Título guardado",
      generatedSummary: "Resumen generado.",
      editedSummary: formattedDocument,
      hasValidation: true,
    });

    render(<SummaryValidation />);

    await waitFor(() =>
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "restoreValidation",
        document: formattedDocument,
        title: "Título guardado",
      }),
    );
  });

  // Regression: `editedSummary` used to round-trip through
  // `documentFromPlainText`/`serializeDocumentToPlainText`, which silently
  // dropped every mark (bold, italic, etc.). Restoring must hand the stored
  // JSONContent to the dispatch untouched so formatting survives.
  it("preserves text formatting (bold, italic) when restoring a saved validation", async () => {
    mockLoad.mockResolvedValue({
      documentId: "doc-0",
      title: "Título guardado",
      generatedSummary: "Resumen generado.",
      editedSummary: formattedDocument,
      hasValidation: true,
    });

    render(<SummaryValidation />);

    await waitFor(() => {
      const call = mockDispatch.mock.calls.find(
        ([action]) => action.type === "restoreValidation",
      );
      expect(call?.[0].document.content[0].content[0].marks).toEqual([
        { type: "bold" },
      ]);
    });
  });

  // Adversary: the tests above only ever resolve `load()` before the user has
  // touched anything. But the restore effect fires as soon as `documentId` is
  // set — right when the freshly generated summary first renders — and
  // `load()` is a real network round-trip. If the user starts typing before
  // it resolves, an unconditional restore would silently throw those
  // keystrokes away the moment the (possibly stale) saved validation lands.
  it("does not restore a saved validation over an edit the user already started making", async () => {
    let resolveLoad!: (value: unknown) => void;
    mockLoad.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { rerender } = render(<SummaryValidation />);

    // The user starts editing while the lookup is still in flight.
    mockSummaryState = { ...mockSummaryState, hasUserEdited: true };
    rerender(<SummaryValidation />);

    resolveLoad({
      documentId: "doc-0",
      title: "Título guardado",
      generatedSummary: "Resumen generado.",
      editedSummary: formattedDocument,
      hasValidation: true,
    });
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "restoreValidation" }),
    );
  });

  // Adversary: a document validated with every word deleted (e.g. "this
  // ruling needs no summary") must not become a permanent dead end. Restoring
  // an empty document would zero out `document.content`, which
  // `summary-validation.tsx`'s `hasSummary` check turns into the
  // `missingSummary` error Callout in place of the editor — with no path back
  // in, since reopening the document keeps loading that same empty save.
  it("does not restore an intentionally emptied validation, keeping the freshly generated summary visible", async () => {
    mockLoad.mockResolvedValue({
      documentId: "doc-0",
      title: "Sin resumen",
      generatedSummary: "Resumen generado.",
      editedSummary: { type: "doc", content: [] },
      hasValidation: true,
    });

    render(<SummaryValidation />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalled());

    expect(mockDispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "restoreValidation" }),
    );
  });
});
