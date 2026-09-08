import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  listMacroSectors,
  listSubtopics,
  listTopics,
} from "@/services/aymurai/catalogs";
import type { MacroSector, Subtopic, Topic } from "@/types/catalogs";
import type {
  DataExtractionPrediction,
  FormOption,
  RecipientDetail,
  RecipientFormValues,
  RecipientPrediction,
  RecommendationFormValues,
  RecommendationValidation,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import { parseSpanishProseDate } from "@/utils/recommendations/parse-spanish-date";

export interface UseRecommendationFormResult {
  /** Frozen at first render — see `useRecommendationForm`'s doc. */
  suggestions: RecommendationFormValues;
  values: RecommendationFormValues;
  setValue: (field: keyof RecommendationFormValues, value: unknown) => void;
  setRecipient: (index: number, patch: Partial<RecipientFormValues>) => void;
  addRecipient: () => void;
  removeRecipient: (index: number) => void;
  /** Active topics + any out-of-catalog `values.topic`, flagged. */
  topicOptions: FormOption[];
  /** Active subtopics of the current topic + any out-of-catalog `values.subtopic`. */
  subtopicOptions: FormOption[];
  /** Active macro sectors + any out-of-catalog recipient macro_sector, deduped. */
  macroSectorOptions: FormOption[];
  toPayload: () => RecommendationValidationInput;
}

function emptyRecipientFormValues(): RecipientFormValues {
  return {
    id: null,
    source_index: null,
    name: null,
    position: null,
    is_primary: false,
    macro_sector: null,
    unit_id: null,
    sector_id: null,
  };
}

/** The sole recipient seeded when the model returned none at all — is_primary
 *  defaults true since, being the only one, it must be. */
function seededRecipient(): RecipientFormValues {
  return { ...emptyRecipientFormValues(), is_primary: true };
}

function recipientFromPrediction(
  recipient: RecipientPrediction,
  sourceIndex: number,
): RecipientFormValues {
  return {
    id: null,
    source_index: sourceIndex,
    name: recipient.name,
    position: recipient.position,
    is_primary: recipient.is_primary,
    macro_sector: recipient.macro_sector,
    unit_id: recipient.unit_id,
    sector_id: recipient.sector_id,
  };
}

function recipientFromDetail(detail: RecipientDetail): RecipientFormValues {
  return {
    id: detail.id,
    source_index: detail.source_index,
    name: detail.name,
    position: detail.position,
    is_primary: detail.is_primary,
    macro_sector: detail.macro_sector,
    unit_id: detail.unit_id,
    sector_id: detail.sector_id,
  };
}

/** The frozen suggestion paired to a saved recipient, by `source_index` —
 *  never by array position (Task 11 brief). A hand-added recipient (no
 *  `source_index`) or a stale one (index no longer in `prediction.recipients`)
 *  gets an empty stand-in so `suggestions.recipients` and `values.recipients`
 *  always line up 1:1 by index. */
function suggestionForSourceIndex(
  prediction: DataExtractionPrediction,
  sourceIndex: number | null,
): RecipientFormValues {
  if (sourceIndex === null) return emptyRecipientFormValues();
  const source = prediction.recipients[sourceIndex];
  if (!source) return emptyRecipientFormValues();
  return recipientFromPrediction(source, sourceIndex);
}

function valuesFromPrediction(
  prediction: DataExtractionPrediction,
): RecommendationFormValues {
  const recipients =
    prediction.recipients.length > 0
      ? prediction.recipients.map(recipientFromPrediction)
      : [seededRecipient()];

  return {
    recommendation_number: prediction.recommendation_number,
    recommendation_date_text: prediction.recommendation_date,
    recommendation_date: parseSpanishProseDate(prediction.recommendation_date),
    topic: prediction.topic,
    subtopic: prediction.subtopic,
    personal_data: prediction.personal_data,
    publishable_content: prediction.publishable_content,
    recipients,
  };
}

interface Initial {
  values: RecommendationFormValues;
  suggestions: RecommendationFormValues;
}

function buildInitial(
  prediction: DataExtractionPrediction,
  validation: RecommendationValidation | null,
): Initial {
  const suggestionValues = valuesFromPrediction(prediction);

  if (validation === null) {
    // Same object for both on purpose: every edit clones-and-replaces
    // `values` (never mutates in place), so `suggestions` keeps pointing at
    // this original, untouched value even though it started out shared.
    return { values: suggestionValues, suggestions: suggestionValues };
  }

  const values: RecommendationFormValues = {
    recommendation_number: validation.recommendation_number,
    recommendation_date_text: validation.recommendation_date_text,
    recommendation_date: validation.recommendation_date,
    topic: validation.topic,
    subtopic: validation.subtopic,
    personal_data: validation.personal_data,
    publishable_content: validation.publishable_content,
    recipients: validation.recipients.map(recipientFromDetail),
  };

  const suggestions: RecommendationFormValues = {
    ...suggestionValues,
    recipients: validation.recipients.map((detail) =>
      suggestionForSourceIndex(prediction, detail.source_index),
    ),
  };

  return { values, suggestions };
}

/** Active catalog entries, as options, plus any of `currentValues` that isn't
 *  among them — kept and flagged rather than silently discarded (§ keep-and-
 *  flag). Extras are deduped and appended in encounter order. */
function buildOptions(
  catalog: { name: string; active: boolean }[],
  currentValues: (string | null)[],
): FormOption[] {
  const base: FormOption[] = catalog
    .filter((entry) => entry.active)
    .map((entry) => ({
      value: entry.name,
      label: entry.name,
      outOfCatalog: false,
    }));

  const known = new Set(base.map((option) => option.value));
  const extras: FormOption[] = [];
  for (const value of currentValues) {
    if (!value) continue;
    if (known.has(value)) continue;
    if (extras.some((extra) => extra.value === value)) continue;
    extras.push({ value, label: value, outOfCatalog: true });
  }

  return [...base, ...extras];
}

/**
 * Owns editing state for the Recomendaciones validation form: frozen
 * `suggestions` (the model's inference, for diffing) vs. mutable `values`
 * (what the person is correcting), the topic->subtopic cascade, and
 * keep-and-flag for any topic/subtopic/macro_sector the model returned that
 * isn't in the current catalog. Ported from the historical desktop-app's
 * `useRecomendacionForm` (branch `feat/recomendaciones-defensoria`), which
 * only supported a hardcoded `TAXONOMY` constant with no options/keep-and-
 * flag surface at all — that lived in the historical form component instead
 * (`recomendacion-form.tsx`/`destinatario-fields.tsx`), reading straight off
 * `TAXONOMY`/`SECTOR_OPTIONS`. Here it moves into the hook because the
 * taxonomy is now async (the catalogs API, Fase 7) rather than a synchronous
 * constant, and `topicOptions`/`subtopicOptions`/`macroSectorOptions` need to
 * be derived from it in one place shared by Tasks 12/13.
 *
 * `suggestions` are frozen via `useRef` on the very first render and never
 * reassigned afterwards, regardless of later `prediction`/`validation` prop
 * changes — editing a value must never retroactively change what the model
 * is recorded as having said.
 *
 * When `validation` is given, `values` come from it and `suggestions` are
 * still derived from `prediction`, paired to each saved recipient by
 * `source_index` (never by array position — a recipient the person deleted
 * shifts every later index).
 */
export function useRecommendationForm(
  prediction: DataExtractionPrediction,
  validation: RecommendationValidation | null,
): UseRecommendationFormResult {
  const initialRef = useRef<Initial | null>(null);
  if (initialRef.current === null) {
    initialRef.current = buildInitial(prediction, validation);
  }
  const suggestions = initialRef.current.suggestions;
  const [values, setValues] = useState<RecommendationFormValues>(
    initialRef.current.values,
  );

  const topicsQuery = useQuery(listTopics());
  const macroSectorsQuery = useQuery(listMacroSectors());
  const topics: Topic[] = topicsQuery.data ?? [];

  // Every topic's subtopics are fetched up front (the real taxonomy is a
  // small, closed set — 25 topics / ~242 subtopics total, see
  // `mockCatalogs.ts`), so the topic->subtopic cascade below can decide
  // synchronously whether the CURRENT subtopic is still valid under a NEW
  // topic without waiting on a fetch triggered by the very change it's
  // reacting to.
  const subtopicsQueries = useQueries({
    queries: topics.map((topic) => ({
      ...listSubtopics(topic.id),
      enabled: topicsQuery.isSuccess,
    })),
  });

  const subtopicsByTopicId = new Map<string, Subtopic[]>();
  topics.forEach((topic, index) => {
    subtopicsByTopicId.set(topic.id, subtopicsQueries[index]?.data ?? []);
  });

  const currentTopic = values.topic
    ? topics.find((topic) => topic.name === values.topic)
    : undefined;
  const currentTopicSubtopics = currentTopic
    ? (subtopicsByTopicId.get(currentTopic.id) ?? [])
    : [];
  const macroSectors: MacroSector[] = macroSectorsQuery.data ?? [];

  const topicOptions = buildOptions(topics, [values.topic]);
  const subtopicOptions = buildOptions(currentTopicSubtopics, [
    values.subtopic,
  ]);
  const macroSectorOptions = buildOptions(
    macroSectors,
    values.recipients.map((recipient) => recipient.macro_sector),
  );

  function setValue(
    field: keyof RecommendationFormValues,
    value: unknown,
  ): void {
    setValues((current) => {
      if (field === "topic") {
        const nextTopicName = value as string | null;
        const nextTopic = nextTopicName
          ? topics.find((topic) => topic.name === nextTopicName)
          : undefined;
        const nextSubtopics = nextTopic
          ? (subtopicsByTopicId.get(nextTopic.id) ?? [])
          : [];
        const subtopicStillValid =
          current.subtopic !== null &&
          nextSubtopics.some(
            (subtopic) => subtopic.active && subtopic.name === current.subtopic,
          );
        return {
          ...current,
          topic: nextTopicName,
          subtopic: subtopicStillValid ? current.subtopic : null,
        };
      }
      return { ...current, [field]: value };
    });
  }

  function setRecipient(
    index: number,
    patch: Partial<RecipientFormValues>,
  ): void {
    setValues((current) => ({
      ...current,
      recipients: current.recipients.map((recipient, i) =>
        i === index ? { ...recipient, ...patch } : recipient,
      ),
    }));
  }

  function addRecipient(): void {
    setValues((current) => ({
      ...current,
      recipients: [...current.recipients, emptyRecipientFormValues()],
    }));
  }

  function removeRecipient(index: number): void {
    setValues((current) => {
      if (current.recipients.length <= 1) return current;
      return {
        ...current,
        recipients: current.recipients.filter((_, i) => i !== index),
      };
    });
  }

  // Memoized on `values` alone (Task 13's `<RecommendationValidation>` lifts
  // this via `<RecommendationForm>`'s `onValuesChange` effect) -- a plain
  // function declaration here would be a new reference every render even
  // when `values` hasn't changed, which would make that effect's dependency
  // list either omit `toPayload` (an exhaustive-deps false-negative) or,
  // if listed, re-fire on every unrelated re-render and risk a feedback
  // loop with the parent's own setState.
  const toPayload = useCallback(
    (): RecommendationValidationInput => ({
      recommendation_number: values.recommendation_number,
      recommendation_date_text: values.recommendation_date_text,
      recommendation_date: values.recommendation_date,
      topic: values.topic,
      subtopic: values.subtopic,
      // `null` ("sin responder") travels through as-is: coercing it to
      // `false` would persist an explicit "No" the person never gave.
      personal_data: values.personal_data,
      publishable_content: values.publishable_content,
      recipients: values.recipients.map((recipient) => ({
        // Omitted entirely (not `null`) for a hand-added recipient — the
        // server distinguishes "no id yet" from "id explicitly cleared".
        ...(recipient.id !== null ? { id: recipient.id } : {}),
        source_index: recipient.source_index,
        name: recipient.name,
        position: recipient.position,
        is_primary: recipient.is_primary,
        macro_sector: recipient.macro_sector,
        unit_id: recipient.unit_id,
        sector_id: recipient.sector_id,
      })),
    }),
    [values],
  );

  return {
    suggestions,
    values,
    setValue,
    setRecipient,
    addRecipient,
    removeRecipient,
    topicOptions,
    subtopicOptions,
    macroSectorOptions,
    toPayload,
  };
}
