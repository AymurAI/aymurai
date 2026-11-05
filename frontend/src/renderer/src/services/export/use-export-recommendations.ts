import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { downloadRecommendationsExport } from "@/services/aymurai/dataExtraction";
import { downloadBlob } from "./download-blob";

/** Download the same complete, dated workbook from either recommendations view. */
export function useExportRecommendations() {
  const mutation = useMutation(downloadRecommendationsExport());
  const [isError, setIsError] = useState(false);
  const download = async () => {
    setIsError(false);
    try {
      const { blob, fileName } = await mutation.mutateAsync("xlsx");
      downloadBlob(blob, fileName);
    } catch {
      setIsError(true);
    }
  };
  return { download, isPending: mutation.isPending, isError };
}
