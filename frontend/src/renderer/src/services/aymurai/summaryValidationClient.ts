import { backendSummaryValidationClient } from "./summaryValidation";
import type { SummaryValidationClient } from "./summaryValidation";

// Single switch point: `/llm/summarize/validation/document/:id` exists
// server-side (aymurai/api/endpoints/routers/llm/summary_validation.py), so
// this now goes through the real backend-backed implementation rather than
// the localStorage no-op. `noopSummaryValidationClient` (./noopSummaryValidation)
// is kept around as a working in-memory adapter for tests (CES-64), but no
// other file in this codebase should import summaryValidation.ts's
// implementations directly — always go through this module.
export const summaryValidationClient: SummaryValidationClient =
  backendSummaryValidationClient;

export type {
  SummaryValidation,
  SummaryValidationClient,
} from "./summaryValidation";
