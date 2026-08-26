import { documentFromMarkdown, type JSONContent } from "@aymurai/ui";
import { createContext, useContext, useReducer } from "react";

export type SummaryStatus =
  | "idle"
  | "streaming"
  | "completed"
  | "error"
  | "stopped";

export interface SummaryState {
  status: SummaryStatus;
  sourceFileName: string | null;
  documentId: string | null;
  title: string;
  partialText: string;
  document: JSONContent | null;
  error: string | null;
  // Set once the user edits the freshly generated document/title. The
  // restore-on-mount lookup in summary-validation.tsx checks this to avoid
  // clobbering an in-progress edit with a slow-resolving saved validation.
  hasUserEdited: boolean;
}

const initialState: SummaryState = {
  status: "idle",
  sourceFileName: null,
  documentId: null,
  title: "",
  partialText: "",
  document: null,
  error: null,
  hasUserEdited: false,
};

export type SummaryAction =
  | { type: "reset" }
  | { type: "start"; fileName: string }
  | { type: "setPartialText"; text: string }
  | { type: "finish"; summary: string; documentId: string }
  | { type: "error"; message: string }
  | { type: "stop" }
  | { type: "edit"; document: JSONContent }
  | { type: "editTitle"; title: string }
  | { type: "restoreValidation"; document: JSONContent; title: string };

export const reset = (): SummaryAction => ({ type: "reset" });
export const start = (fileName: string): SummaryAction => ({
  type: "start",
  fileName,
});
export const setPartialText = (text: string): SummaryAction => ({
  type: "setPartialText",
  text,
});
export const finish = (summary: string, documentId: string): SummaryAction => ({
  type: "finish",
  summary,
  documentId,
});
export const error = (message: string): SummaryAction => ({
  type: "error",
  message,
});
export const stop = (): SummaryAction => ({ type: "stop" });
export const edit = (document: JSONContent): SummaryAction => ({
  type: "edit",
  document,
});
export const editTitle = (title: string): SummaryAction => ({
  type: "editTitle",
  title,
});
export const restoreValidation = (
  document: JSONContent,
  title: string,
): SummaryAction => ({ type: "restoreValidation", document, title });

function summaryReducer(
  state: SummaryState,
  action: SummaryAction,
): SummaryState {
  switch (action.type) {
    case "reset":
      return initialState;
    case "start":
      return {
        ...initialState,
        status: "streaming",
        sourceFileName: action.fileName,
        title: `Resumen ${action.fileName}`,
      };
    case "setPartialText":
      return { ...state, partialText: action.text };
    case "finish":
      return {
        ...state,
        status: "completed",
        documentId: action.documentId,
        document: documentFromMarkdown(action.summary),
      };
    case "error":
      return { ...state, status: "error", error: action.message };
    case "stop":
      return { ...state, status: "stopped" };
    case "edit":
      return { ...state, document: action.document, hasUserEdited: true };
    case "editTitle":
      return { ...state, title: action.title, hasUserEdited: true };
    case "restoreValidation":
      return { ...state, document: action.document, title: action.title };
    default:
      return state;
  }
}

const SummaryContext = createContext<SummaryState>(initialState);
const SummaryDispatchContext = createContext<React.Dispatch<SummaryAction>>(
  () => {},
);

export default function SummaryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(summaryReducer, initialState);
  return (
    <SummaryContext.Provider value={state}>
      <SummaryDispatchContext.Provider value={dispatch}>
        {children}
      </SummaryDispatchContext.Provider>
    </SummaryContext.Provider>
  );
}

export function useSummary() {
  return useContext(SummaryContext);
}

export function useSummaryDispatch() {
  return useContext(SummaryDispatchContext);
}
