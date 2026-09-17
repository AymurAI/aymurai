import { createContext, useContext, useReducer } from "react";
import type {
  DataExtractionPrediction,
  RecommendationValidation,
} from "@/types/dataExtraction";

export type RecommendationOrigin =
  | "inference"
  | "stored-inference"
  | "validation";

export type RecommendationStatus =
  | "idle"
  | "parsing"
  | "checking"
  | "extracting"
  | "ready"
  | "error"
  | "stopped";

export interface RecommendationState {
  status: RecommendationStatus;
  documentId: string | null;
  sourceFileName: string | null;
  origin: RecommendationOrigin | null;
  prediction: DataExtractionPrediction | null;
  validation: RecommendationValidation | null;
  catalogsStale: boolean;
  error: string | null;
  // Terminal, no retry offered: a PDF with no extractable text will not
  // succeed on a second attempt, and offering one just wastes the person's time.
  isScannedPdf: boolean;
}

const initialState: RecommendationState = {
  status: "idle",
  documentId: null,
  sourceFileName: null,
  origin: null,
  prediction: null,
  validation: null,
  catalogsStale: false,
  error: null,
  isScannedPdf: false,
};

export type RecommendationAction =
  | { type: "reset" }
  | { type: "startParsing"; fileName: string }
  | { type: "startChecking"; documentId: string }
  | { type: "startExtracting" }
  | {
      type: "loaded";
      origin: RecommendationOrigin;
      prediction: DataExtractionPrediction | null;
      validation: RecommendationValidation | null;
      catalogsStale: boolean;
    }
  | { type: "failed"; message: string; isScannedPdf: boolean }
  | { type: "stopped" };

export const reset = (): RecommendationAction => ({ type: "reset" });

export const startParsing = (fileName: string): RecommendationAction => ({
  type: "startParsing",
  fileName,
});

export const startChecking = (documentId: string): RecommendationAction => ({
  type: "startChecking",
  documentId,
});

export const startExtracting = (): RecommendationAction => ({
  type: "startExtracting",
});

export const loaded = ({
  origin,
  prediction,
  validation,
  catalogsStale,
}: {
  origin: RecommendationOrigin;
  prediction: DataExtractionPrediction | null;
  validation: RecommendationValidation | null;
  catalogsStale: boolean;
}): RecommendationAction => ({
  type: "loaded",
  origin,
  prediction,
  validation,
  catalogsStale,
});

export const failed = (
  message: string,
  { isScannedPdf = false }: { isScannedPdf?: boolean } = {},
): RecommendationAction => ({
  type: "failed",
  message,
  isScannedPdf,
});

export const stopped = (): RecommendationAction => ({ type: "stopped" });

function recommendationReducer(
  state: RecommendationState,
  action: RecommendationAction,
): RecommendationState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "startParsing":
      return {
        ...initialState,
        status: "parsing",
        sourceFileName: action.fileName,
      };
    case "startChecking":
      return {
        ...state,
        status: "checking",
        documentId: action.documentId,
      };
    case "startExtracting":
      return { ...state, status: "extracting" };
    case "loaded":
      return {
        ...state,
        status: "ready",
        origin: action.origin,
        prediction: action.prediction,
        validation: action.validation,
        catalogsStale: action.catalogsStale,
      };
    case "failed":
      return {
        ...state,
        status: "error",
        error: action.message,
        isScannedPdf: action.isScannedPdf,
      };
    case "stopped":
      return { ...state, status: "stopped" };
    default:
      return state;
  }
}

const RecommendationContext = createContext<RecommendationState>(initialState);
const RecommendationDispatchContext = createContext<
  React.Dispatch<RecommendationAction>
>(() => {});

export default function RecommendationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(recommendationReducer, initialState);
  return (
    <RecommendationContext.Provider value={state}>
      <RecommendationDispatchContext.Provider value={dispatch}>
        {children}
      </RecommendationDispatchContext.Provider>
    </RecommendationContext.Provider>
  );
}

export function useRecommendation() {
  return useContext(RecommendationContext);
}

export function useRecommendationDispatch() {
  return useContext(RecommendationDispatchContext);
}
