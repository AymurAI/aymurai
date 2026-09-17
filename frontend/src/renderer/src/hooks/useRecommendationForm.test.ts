import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  type RenderHookOptions,
  renderHook as rtlRenderHook,
} from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listMacroSectors,
  listSubtopics,
  listTopics,
} from "@/services/aymurai/catalogs";
import type { MacroSector, Subtopic, Topic } from "@/types/catalogs";
import type {
  DataExtractionPrediction,
  RecipientDetail,
  RecipientPrediction,
  RecommendationValidation,
} from "@/types/dataExtraction";
import { useRecommendationForm } from "./useRecommendationForm";

// Pinned exactly like `services/aymurai/catalogs.test.ts`'s "real (non-mock)
// implementation" suite: the taxonomy is seeded straight into the query
// cache below, so USE_MOCK_CATALOGS's own fixture must not shadow it.
vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_CATALOGS: false,
}));

const now = "2026-01-01T00:00:00Z";

function aTopic(id: string, name: string, order: number): Topic {
  return {
    id,
    code: null,
    name,
    active: true,
    order,
    created_at: now,
    updated_at: now,
  };
}

function aSubtopic(
  id: string,
  topicId: string,
  name: string,
  order = 1,
): Subtopic {
  return {
    id,
    topic_id: topicId,
    code: null,
    name,
    active: true,
    order,
    created_at: now,
    updated_at: now,
  };
}

// A small closed taxonomy covering every scenario this file exercises,
// seeded once per test into the query cache (see `renderHook` below) so
// `topicOptions`/`subtopicOptions` and the topic->subtopic cascade in
// `setValue` are synchronously correct from the very first render — no test
// here ever awaits a fetch.
const TOPICS: Topic[] = [
  aTopic("topic-salud", "Salud", 1),
  aTopic("topic-ambiente", "Ambiente", 2),
  aTopic("topic-otro", "Otro tema con el mismo subtema", 3),
  aTopic("topic-compartido", "Tema con subtema compartido", 4),
];

const SUBTOPICS_BY_TOPIC: Record<string, Subtopic[]> = {
  "topic-salud": [
    aSubtopic("sub-medicamentos", "topic-salud", "Acceso a medicamentos"),
  ],
  "topic-ambiente": [
    aSubtopic("sub-inundaciones", "topic-ambiente", "Inundaciones"),
  ],
  // Coincidentally shares a subtopic *name* with topic-compartido below —
  // two distinct rows (distinct ids/topic_id), same name, exercising the
  // "keeps the subtopic when it is still valid under the new topic" test.
  "topic-otro": [
    aSubtopic("sub-compartido-b", "topic-otro", "Subtema compartido"),
  ],
  "topic-compartido": [
    aSubtopic("sub-compartido-a", "topic-compartido", "Subtema compartido"),
  ],
};

const MACRO_SECTORS: MacroSector[] = [
  {
    id: "ms-gcba",
    code: "GCBA",
    name: "GCBA",
    active: true,
    order: 0,
    created_at: now,
    updated_at: now,
  },
  {
    id: "ms-nacionales",
    code: "ORGANISMOS_NACIONALES",
    name: "Organismos Nacionales",
    active: true,
    order: 1,
    created_at: now,
    updated_at: now,
  },
];

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({
    // `staleTime: Infinity` keeps the seeded data authoritative: no test
    // here awaits anything, so a background refetch racing the assertions
    // would just be noise (and would hit the real, unmocked `api.get`).
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(listTopics().queryKey, TOPICS);
  for (const topic of TOPICS) {
    queryClient.setQueryData(
      listSubtopics(topic.id).queryKey,
      SUBTOPICS_BY_TOPIC[topic.id] ?? [],
    );
  }
  queryClient.setQueryData(listMacroSectors().queryKey, MACRO_SECTORS);
});

/** Shadows RTL's `renderHook` so every `it()` body below can call it exactly
 * as written, with the taxonomy already wired in. */
function renderHook<T>(
  callback: () => T,
  options?: RenderHookOptions<unknown>,
) {
  return rtlRenderHook(callback, {
    ...options,
    wrapper: ({ children }) =>
      createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

function aRecipientPrediction(
  partial: Partial<RecipientPrediction> = {},
): RecipientPrediction {
  return {
    name: null,
    position: null,
    is_primary: false,
    macro_sector: null,
    unit_id: null,
    unit_name: null,
    sector_id: null,
    sector_name: null,
    match_method: null,
    unit_candidates: [],
    sector_candidates: [],
    ...partial,
  };
}

function aPrediction(): DataExtractionPrediction {
  return {
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [
      aRecipientPrediction({
        name: "Ana Pérez",
        position: "Directora",
        is_primary: true,
        macro_sector: "GCBA",
      }),
    ],
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: null,
    publishable_content: "Contenido publicable.",
    config: { model: "m", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
  };
}

function aPredictionWith(
  partial: Partial<DataExtractionPrediction>,
): DataExtractionPrediction {
  return { ...aPrediction(), ...partial };
}

function aPredictionWithRecipient(
  partial: Partial<RecipientPrediction>,
): DataExtractionPrediction {
  return aPredictionWith({ recipients: [aRecipientPrediction(partial)] });
}

function aPredictionWithRecipients(
  partials: Partial<RecipientPrediction>[],
): DataExtractionPrediction {
  return aPredictionWith({
    recipients: partials.map((partial) => aRecipientPrediction(partial)),
  });
}

function aRecipientDetail(
  partial: Partial<RecipientDetail> = {},
): RecipientDetail {
  return {
    id: "",
    source_index: null,
    name: null,
    position: null,
    is_primary: false,
    macro_sector: null,
    unit_id: null,
    unit_name: null,
    sector_id: null,
    sector_name: null,
    ...partial,
  };
}

function aValidationWithRecipients(
  partials: Partial<RecipientDetail>[],
): RecommendationValidation {
  return {
    id: "val-1",
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date_text: "22 de noviembre",
    recommendation_date: null,
    topic: "Salud",
    subtopic: "Acceso a medicamentos",
    personal_data: null,
    publishable_content: "Contenido publicable.",
    recipients: partials.map((partial) => aRecipientDetail(partial)),
    source_text: "texto fuente",
    prediction: {},
  };
}

// Named `use...` (not `renderWith...`) so biome's rules-of-hooks lint
// recognizes these as hooks themselves — they call `useRecommendationForm`
// internally, so a plain function name trips `lint/correctness/useHookAtTopLevel`.
function useTaxonomyPrediction() {
  return useRecommendationForm(aPrediction(), null);
}

function useSharedSubtopicPrediction() {
  return useRecommendationForm(
    aPredictionWith({
      topic: "Tema con subtema compartido",
      subtopic: "Subtema compartido",
    }),
    null,
  );
}

describe("useRecommendationForm", () => {
  it("freezes suggestions so editing a value never mutates the inference", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );
    const originalTopic = result.current.suggestions.topic;

    act(() => result.current.setValue("topic", "Otro tema"));

    expect(result.current.values.topic).toBe("Otro tema");
    expect(result.current.suggestions.topic).toBe(originalTopic);
  });

  it("starts recommendation_number and each recipient's name/position blank, with the prediction only in suggestions", () => {
    // These are exactly the fields `ValidatedTextField` shows a clickable
    // suggestion mark for -- pre-filling `values` with the same text as
    // `suggestions` would show the model's guess twice (once as the field's
    // "confirmed" value, once as the suggestion overlay) and make the mark
    // permanently inert, since it's already equal to the value on every
    // first render.
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );

    expect(result.current.values.recommendation_number).toBeNull();
    expect(result.current.values.recipients[0].name).toBeNull();
    expect(result.current.values.recipients[0].position).toBeNull();

    expect(result.current.suggestions.recommendation_number).toBe("123/2026");
    expect(result.current.suggestions.recipients[0].name).toBe("Ana Pérez");
    expect(result.current.suggestions.recipients[0].position).toBe("Directora");

    // Unaffected: no suggestion mark renders next to either of these, so
    // there is nothing for a pre-filled value to duplicate.
    expect(result.current.values.recipients[0].is_primary).toBe(true);
    expect(result.current.values.publishable_content).toBe(
      "Contenido publicable.",
    );
  });

  it("starts topic/subtopic/macro_sector blank too, with the prediction only in suggestions", () => {
    // `@aymurai/ui`'s `Select` renders its suggestion mark only when it has
    // no value, so pre-filling these three made the mark unreachable and
    // left the fields looking settled rather than pending validation.
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );

    expect(result.current.values.topic).toBeNull();
    expect(result.current.values.subtopic).toBeNull();
    expect(result.current.values.recipients[0].macro_sector).toBeNull();

    expect(result.current.suggestions.topic).toBe("Salud");
    expect(result.current.suggestions.subtopic).toBe("Acceso a medicamentos");
    expect(result.current.suggestions.recipients[0].macro_sector).toBe("GCBA");
  });

  it("offers the suggested subtopic while the topic is still pending", () => {
    // The subtopic list follows the suggested topic until a topic is
    // actually validated -- otherwise the subtopic's own mark would have
    // nothing to resolve against, and Subtema could only be suggested after
    // Tema had been clicked.
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );

    expect(result.current.values.topic).toBeNull();
    expect(result.current.subtopicOptions).toContainEqual(
      expect.objectContaining({
        value: "Acceso a medicamentos",
        outOfCatalog: false,
      }),
    );
  });

  it("drops the suggested subtopic once a different topic is validated", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );

    act(() => result.current.setValue("topic", "Ambiente"));

    // Not an off-catalog value to preserve -- just one that belongs to
    // another topic, so it must not stay selectable here.
    expect(result.current.subtopicOptions).not.toContainEqual(
      expect.objectContaining({ value: "Acceso a medicamentos" }),
    );
  });

  it("starts each recipient's unit_id/sector_id blank too, with the prediction only in suggestions", () => {
    // `RecipientUnitCombobox` shows the same kind of clickable suggestion
    // mark as `ValidatedTextField` -- same reasoning as name/position above.
    const { result } = renderHook(() =>
      useRecommendationForm(
        aPredictionWithRecipient({
          macro_sector: "GCBA",
          unit_id: "leaf-42",
          sector_id: "sector-7",
        }),
        null,
      ),
    );

    expect(result.current.values.recipients[0].unit_id).toBeNull();
    expect(result.current.values.recipients[0].sector_id).toBeNull();
    expect(result.current.suggestions.recipients[0].unit_id).toBe("leaf-42");
    expect(result.current.suggestions.recipients[0].sector_id).toBe("sector-7");
  });

  it("starts recommendation_date blank too, with the parsed date only in suggestions", () => {
    // `aPrediction()`'s own "22 de noviembre" has no year, so
    // `parseSpanishProseDate` never matches it -- use a prose string it
    // actually parses to make this meaningful.
    const { result } = renderHook(() =>
      useRecommendationForm(
        aPredictionWith({ recommendation_date: "22 de noviembre de 2026" }),
        null,
      ),
    );

    expect(result.current.values.recommendation_date).toBeNull();
    expect(result.current.suggestions.recommendation_date).toBe("2026-11-22");

    // The raw prose is never itself a suggestion mark (nothing to
    // duplicate) -- it stays pre-filled as hover context next to the field.
    expect(result.current.values.recommendation_date_text).toBe(
      "22 de noviembre de 2026",
    );
  });

  it("keeps an out-of-catalog topic instead of discarding it", () => {
    // Never silently drop what the model returned: keep it, offer it as an extra
    // option, and flag it inline.
    const { result } = renderHook(() =>
      useRecommendationForm(
        aPredictionWith({ topic: "Tema inexistente" }),
        null,
      ),
    );

    // The model's answer now lives in the suggestion, not the value -- but
    // it still has to be an option, or the `Select` could neither show its
    // mark nor accept a click on it (both go through the same lookup).
    expect(result.current.values.topic).toBeNull();
    expect(result.current.suggestions.topic).toBe("Tema inexistente");
    expect(result.current.topicOptions).toContainEqual(
      expect.objectContaining({
        value: "Tema inexistente",
        outOfCatalog: true,
      }),
    );
  });

  // Both cascade tests accept the suggested subtopic first: the field now
  // starts blank (`blankValidatedFields`), and asserting the cascade against
  // an already-null subtopic would pass no matter what the cascade did.
  it("clears the subtopic when changing topic invalidates it", () => {
    const { result } = renderHook(() => useTaxonomyPrediction());
    act(() => result.current.setValue("subtopic", "Acceso a medicamentos"));
    act(() => result.current.setValue("topic", "Ambiente"));
    expect(result.current.values.subtopic).toBeNull();
  });

  it("keeps the subtopic when it is still valid under the new topic", () => {
    const { result } = renderHook(() => useSharedSubtopicPrediction());
    act(() => result.current.setValue("subtopic", "Subtema compartido"));
    act(() =>
      result.current.setValue("topic", "Otro tema con el mismo subtema"),
    );
    expect(result.current.values.subtopic).toBe("Subtema compartido");
  });

  it("sends null for an unanswered personal_data, never false", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );
    expect(result.current.toPayload().personal_data).toBeNull();
  });

  it("sends the corrected value, not the raw inference", () => {
    // The historical suite had exactly this test and it caught a real bug.
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );
    act(() =>
      result.current.setValue("publishable_content", "texto corregido"),
    );
    expect(result.current.toPayload().publishable_content).toBe(
      "texto corregido",
    );
  });

  it("keeps an out-of-catalog macro sector too", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(
        aPredictionWithRecipient({ macro_sector: "Sector inventado" }),
        null,
      ),
    );

    expect(result.current.values.recipients[0].macro_sector).toBeNull();
    expect(result.current.suggestions.recipients[0].macro_sector).toBe(
      "Sector inventado",
    );
    expect(result.current.macroSectorOptions).toContainEqual(
      expect.objectContaining({
        value: "Sector inventado",
        outOfCatalog: true,
      }),
    );
  });

  it("pairs suggestions to saved recipients by source_index, not by position", () => {
    // The saved list is missing prediction.recipients[0]; the survivor still has
    // to diff against entry 1, which pairing by array position would get wrong.
    const prediction = aPredictionWithRecipients([
      { name: "Primero" },
      { name: "Segundo" },
    ]);
    const validation = aValidationWithRecipients([
      { id: "r2", source_index: 1, name: "Segundo corregido" },
    ]);

    const { result } = renderHook(() =>
      useRecommendationForm(prediction, validation),
    );

    expect(result.current.values.recipients).toHaveLength(1);
    expect(result.current.values.recipients[0].name).toBe("Segundo corregido");
    expect(result.current.suggestions.recipients[0].name).toBe("Segundo");
  });

  it("round-trips id and source_index for a saved recipient", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(
        aPredictionWithRecipients([{ name: "Primero" }, { name: "Segundo" }]),
        aValidationWithRecipients([
          { id: "r2", source_index: 1, name: "Segundo" },
        ]),
      ),
    );

    expect(result.current.toPayload().recipients[0]).toMatchObject({
      id: "r2",
      source_index: 1,
    });
  });

  it("sends a null source_index for a recipient the person added", () => {
    const { result } = renderHook(() =>
      useRecommendationForm(aPrediction(), null),
    );
    act(() => result.current.addRecipient());

    const added = result.current.toPayload().recipients.at(-1);
    expect(added?.source_index).toBeNull();
    expect(added?.id).toBeUndefined();
  });
});
