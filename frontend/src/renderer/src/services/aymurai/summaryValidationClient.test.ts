import { documentFromPlainText } from "@aymurai/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import { noopSummaryValidationClient } from "./noopSummaryValidation";
import { summaryValidationClient } from "./summaryValidationClient";

const editedDocument = documentFromPlainText("e");

describe("summaryValidationClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the edited document's JSONContent verbatim, preserving marks", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: null });

    await summaryValidationClient.save({
      documentId: "doc-1",
      title: "t",
      generatedSummary: "g",
      editedSummary: editedDocument,
    });

    expect(post).toHaveBeenCalledWith(
      "/llm/summarize/validation/document/doc-1",
      { title: "t", validation: editedDocument },
      { signal: undefined },
    );
  });
});

describe("backendSummaryValidationClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports hasValidation: false when the record was never human-validated", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: { title: null, summary: "Generado.", validation: null },
    });

    const result = await summaryValidationClient.load("doc-1");

    expect(result?.hasValidation).toBe(false);
  });

  it("reports hasValidation: true when a human validation is stored", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        title: "Título validado",
        summary: "Generado.",
        validation: documentFromPlainText("Editado."),
      },
    });

    const result = await summaryValidationClient.load("doc-1");

    expect(result?.hasValidation).toBe(true);
  });

  it("returns the stored validation's JSONContent verbatim, preserving marks", async () => {
    const storedDocument = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Editado en negrita.",
              marks: [{ type: "bold" }],
            },
          ],
        },
      ],
    };
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        title: "Título validado",
        summary: "Generado.",
        validation: storedDocument,
      },
    });

    const result = await summaryValidationClient.load("doc-1");

    expect(result?.editedSummary).toEqual(storedDocument);
  });
});

describe("noopSummaryValidationClient", () => {
  beforeEach(() => localStorage.clear());

  it("returns null for a document that was never saved", async () => {
    expect(await noopSummaryValidationClient.load("doc-1")).toBeNull();
  });

  it("round-trips a saved summary through localStorage", async () => {
    const summary = {
      documentId: "doc-1",
      title: "Resumen acta.docx",
      generatedSummary: "Original.",
      editedSummary: documentFromPlainText("Editado."),
    };
    await noopSummaryValidationClient.save(summary);
    expect(await noopSummaryValidationClient.load("doc-1")).toEqual({
      ...summary,
      hasValidation: true,
    });
  });

  it("overwrites a previous save for the same documentId", async () => {
    await noopSummaryValidationClient.save({
      documentId: "doc-1",
      title: "A",
      generatedSummary: "A",
      editedSummary: documentFromPlainText("A"),
    });
    await noopSummaryValidationClient.save({
      documentId: "doc-1",
      title: "B",
      generatedSummary: "B",
      editedSummary: documentFromPlainText("B"),
    });
    expect(await noopSummaryValidationClient.load("doc-1")).toEqual({
      documentId: "doc-1",
      title: "B",
      generatedSummary: "B",
      editedSummary: documentFromPlainText("B"),
      hasValidation: true,
    });
  });
});
