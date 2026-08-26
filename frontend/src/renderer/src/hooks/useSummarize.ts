import { useMutation } from "@tanstack/react-query";
import { CanceledError } from "axios";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  finish,
  restoreValidation,
  type SummaryAction,
  setPartialText,
  start,
  stop,
  error as summaryError,
} from "@/context/Summary";
import { summarizeDocument } from "@/services/aymurai/queries";
import { summaryValidationClient } from "@/services/aymurai/summaryValidationClient";
import type { DocFile } from "@/types/file";

export type SummarizeHookStatus =
  | "idle"
  | "processing"
  | "completed"
  | "error"
  | "stopped";

interface UseSummarizeOptions {
  dispatch?: React.Dispatch<SummaryAction>;
}

export function useSummarize(
  file: DocFile | undefined,
  { dispatch }: UseSummarizeOptions = {},
) {
  const [stopped, setStopped] = useState(false);
  const userAbortedRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const mutation = useMutation(
    summarizeDocument({
      onPartialText: (text) => dispatchRef.current?.(setPartialText(text)),
    }),
  );
  const { mutate, reset: resetMutation } = mutation;

  const text = useMemo(
    () => file?.paragraphs?.map((p) => p.value).join("\n\n") ?? "",
    [file],
  );
  const fileKey = file ? `${file.data.name}:${file.data.size}` : "";

  // biome-ignore lint/correctness/useExhaustiveDependencies: fileKey is the intended trigger; mutate/text are stable per render
  useEffect(() => {
    if (!file || !text) return;

    userAbortedRef.current = false;
    setStopped(false);
    dispatchRef.current?.(start(file.data.name));

    let active = true;
    const controller = new AbortController();
    controllerRef.current = controller;

    // Same StrictMode-double-mount workaround as useTranscribe.
    Promise.resolve().then(() => {
      if (!active) return;
      mutate(
        { text, signal: controller.signal },
        {
          onSuccess: (result) => {
            // Guard against a superseded request: if a newer file/effect run
            // has replaced controllerRef, this settle is stale — ignore it.
            if (controllerRef.current !== controller) return;
            dispatchRef.current?.(finish(result.summary, result.documentId));

            // A prior human validation for this exact document (same
            // text_to_uuid identity) outranks the freshly (re)generated
            // machine summary — best-effort: the fresh summary already
            // dispatched above is a reasonable fallback if this lookup
            // fails or there simply isn't one yet.
            summaryValidationClient
              .load(result.documentId, controller.signal)
              .then((validation) => {
                if (controllerRef.current !== controller) return;
                if (!validation?.hasValidation) return;
                // Mirrors summary-validation.tsx's restore-on-mount guard:
                // an intentionally emptied validation must not blackhole the
                // freshly generated (always non-empty) summary.
                if ((validation.editedSummary.content?.length ?? 0) === 0) {
                  return;
                }
                dispatchRef.current?.(
                  restoreValidation(validation.editedSummary, validation.title),
                );
              })
              .catch(() => {});
          },
          onError: (err) => {
            if (controllerRef.current !== controller) return;
            if (userAbortedRef.current) return;
            dispatchRef.current?.(
              summaryError(
                err instanceof Error ? err.message : "Unknown error",
              ),
            );
          },
        },
      );
    });

    return () => {
      active = false;
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [fileKey]);

  const status: SummarizeHookStatus = useMemo(() => {
    if (stopped) return "stopped";
    if (mutation.isPending) return "processing";
    if (mutation.isSuccess) return "completed";
    if (mutation.isError) {
      return mutation.error instanceof CanceledError ? "stopped" : "error";
    }
    return "idle";
  }, [
    stopped,
    mutation.isPending,
    mutation.isSuccess,
    mutation.isError,
    mutation.error,
  ]);

  const abort = useCallback(() => {
    userAbortedRef.current = true;
    setStopped(true);
    controllerRef.current?.abort();
    resetMutation();
    dispatchRef.current?.(stop());
  }, [resetMutation]);

  return { status, abort };
}
