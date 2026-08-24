import api from "@/services/api";
import { documentFromPlainText } from "@aymurai/ui";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { noopSummaryValidationClient } from "./noopSummaryValidation";
import { summaryValidationClient } from "./summaryValidationClient";

describe("summaryValidationClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("saves through the backend validation route", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue({ data: null });

    await summaryValidationClient.save({
      documentId: "doc-1",
      title: "t",
      generatedSummary: "g",
      editedSummary: "e",
    });

    expect(post).toHaveBeenCalledWith(
      "/llm/summarize/validation/document/doc-1",
      { title: "t", validation: documentFromPlainText("e") },
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
      editedSummary: "Editado.",
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
      editedSummary: "A",
    });
    await noopSummaryValidationClient.save({
      documentId: "doc-1",
      title: "B",
      generatedSummary: "B",
      editedSummary: "B",
    });
    expect(await noopSummaryValidationClient.load("doc-1")).toEqual({
      documentId: "doc-1",
      title: "B",
      generatedSummary: "B",
      editedSummary: "B",
      hasValidation: true,
    });
  });
});
