import { FeatureFlowEnum } from "@/types/features";

/**
 * Narrows a dropped/selected file list to what the feature can actually
 * process. The anonymizer and recommendations extraction both work on one
 * document at a time, so a multi-file drop keeps the last one rather than
 * silently processing the first.
 */
export function filesForFeatureLoad(feature: FeatureFlowEnum, files: File[]) {
  if (
    feature === FeatureFlowEnum.Anonymizer ||
    feature === FeatureFlowEnum.Recommendations
  ) {
    return files.slice(-1);
  }

  return files;
}
