import {
  type JSONContent,
  documentFromMarkdown,
  documentFromPlainText,
  serializeDocumentToPlainText,
} from "@aymurai/ui";
import api from "../api";

export interface SummaryValidation {
  documentId: string;
  title: string;
  generatedSummary: string;
  editedSummary: string;
}

export interface SummaryValidationClient {
  save(summary: SummaryValidation, signal?: AbortSignal): Promise<void>;
  load(
    documentId: string,
    signal?: AbortSignal,
  ): Promise<SummaryValidation | null>;
}

interface SummarizationValidationResponse {
  title: string | null;
  summary: string;
  validation: JSONContent | null;
}

/**
 * Real backend-backed implementation, calling the
 * `/llm/summarize/validation/document/:id` route (mirrors asrValidation.ts's
 * `/asr/validation/document/:id`) — see
 * `aymurai/api/endpoints/routers/llm/summary_validation.py`.
 *
 * The backend's request/response shape doesn't line up field-for-field with
 * this module's `SummaryValidation`: it takes `title` and `validation`
 * (TipTap JSONContent, the human-edited document) and separately returns
 * `summary` (the machine-generated markdown, a column this route never
 * writes). There's no backend field for `generatedSummary` — it only
 * round-trips locally. This adapter translates at the boundary:
 * `editedSummary` (plain text) <-> `validation` (JSONContent) via
 * `documentFromPlainText`/`serializeDocumentToPlainText`, and on load, falls
 * back to `documentFromMarkdown(summary)` when the document was never
 * human-validated (`validation` is null).
 */
export const backendSummaryValidationClient: SummaryValidationClient = {
  async save(summary, signal) {
    await api.post(
      `/llm/summarize/validation/document/${summary.documentId}`,
      {
        title: summary.title,
        validation: documentFromPlainText(summary.editedSummary),
      },
      { signal },
    );
  },
  async load(documentId, signal) {
    const response = await api.get<SummarizationValidationResponse>(
      `/llm/summarize/validation/document/${documentId}`,
      { signal },
    );
    const data = response.data;
    if (!data) return null;

    return {
      documentId,
      title: data.title ?? "",
      generatedSummary: data.summary,
      editedSummary: serializeDocumentToPlainText(
        data.validation ?? documentFromMarkdown(data.summary),
      ),
    };
  },
};
