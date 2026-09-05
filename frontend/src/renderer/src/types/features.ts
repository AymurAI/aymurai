export enum FeatureFlowEnum {
  Dataset = "DATA_SET",
  Anonymizer = "ANONYMIZER",
  VoiceToText = "VOICE_TO_TEXT",
  Summarizer = "SUMMARIZER",
  Recommendations = "RECOMMENDATIONS",
}

/**
 * i18next namespace per feature. These values are also the localStorage keys
 * under `tutorialsSeen`, so they must not change without a store migration.
 */
export const featureNamespace = {
  [FeatureFlowEnum.Dataset]: "dataset",
  [FeatureFlowEnum.Anonymizer]: "anonymizer",
  [FeatureFlowEnum.VoiceToText]: "voice-to-text",
  [FeatureFlowEnum.Summarizer]: "summarizer",
  [FeatureFlowEnum.Recommendations]: "recommendations",
} as const satisfies Record<FeatureFlowEnum, string>;

/**
 * URL segment per feature. Kept as its own map rather than aliased to
 * `featureNamespace`: the two happen to coincide today, but a namespace rename
 * is an internal refactor while a slug rename breaks every bookmark and needs a
 * redirect in `aymurai/api/endpoints/routers/frontend/frontend.py`. Keep both
 * in sync with `FEATURE_ROUTE_SLUGS` there.
 */
export const featureRouteSlug = {
  [FeatureFlowEnum.Dataset]: "dataset",
  [FeatureFlowEnum.Anonymizer]: "anonymizer",
  [FeatureFlowEnum.VoiceToText]: "voice-to-text",
  [FeatureFlowEnum.Summarizer]: "summarizer",
  [FeatureFlowEnum.Recommendations]: "recommendations",
} as const satisfies Record<FeatureFlowEnum, string>;

const FEATURE_BY_ROUTE_SLUG = Object.fromEntries(
  Object.entries(featureRouteSlug).map(([feature, slug]) => [slug, feature]),
) as Record<string, FeatureFlowEnum>;

export function getFeatureRouteSlug(feature: FeatureFlowEnum): string {
  return featureRouteSlug[feature];
}

export function parseFeatureRouteSlug(slug: string): FeatureFlowEnum | null {
  return FEATURE_BY_ROUTE_SLUG[slug.toLowerCase()] ?? null;
}
