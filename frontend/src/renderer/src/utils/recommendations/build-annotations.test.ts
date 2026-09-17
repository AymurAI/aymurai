import { describe, expect, it } from "vitest";
import type { DataExtractionPrediction } from "@/types/dataExtraction";
import type { Paragraph } from "@/types/file";
import { buildAnnotations } from "./build-annotations";

const paragraphs: Paragraph[] = [
  { id: "d:0", document_id: "d", value: "Buenos Aires, 30 de mayo de 2022." },
  {
    id: "d:1",
    document_id: "d",
    value: "Se recomienda a Ana Pérez, Directora General.",
  },
];

const basePrediction: DataExtractionPrediction = {
  document_id: "d",
  recommendation_number: "",
  recommendation_date: "30 de mayo de 2022",
  recipients: [
    {
      name: "Ana Pérez",
      position: "Directora General",
      is_primary: true,
      macro_sector: null,
      unit_id: null,
      unit_name: null,
      sector_id: null,
      sector_name: "GCBA",
      match_method: null,
      unit_candidates: [],
      sector_candidates: [],
    },
  ],
  topic: "AMBIENTE y CAMBIO CLIMÁTICO",
  subtopic: "Inundaciones",
  personal_data: true,
  publishable_content: "Un resumen que no está en el texto.",
  config: { model: "test-model", options: {}, catalogs_hash: "hash" },
  catalogs_stale: false,
};

describe("buildAnnotations", () => {
  it("annotates date, name and position, keyed by paragraph id", () => {
    const map = buildAnnotations(basePrediction, paragraphs);
    expect(map.get("d:0")?.map((a) => a.field)).toEqual([
      "recommendation_date",
    ]);
    expect(map.get("d:1")?.map((a) => a.field)).toEqual([
      "recipient:0:name",
      "recipient:0:position",
    ]);
  });

  it("never annotates topic, subtopic, sector, personal_data or publishable_content", () => {
    const fields = [...buildAnnotations(basePrediction, paragraphs).values()]
      .flat()
      .map((a) => a.field);
    expect(fields).not.toContain("topic");
    expect(fields).not.toContain("subtopic");
    expect(fields).not.toContain("recipient:0:sector_name");
    expect(fields).not.toContain("publishable_content");
  });

  it("skips empty fields", () => {
    const fields = [...buildAnnotations(basePrediction, paragraphs).values()]
      .flat()
      .map((a) => a.field);
    expect(fields).not.toContain("recommendation_number");
  });

  describe("payload-aware highlighting", () => {
    // The highlight is a "why does this field say what it says" reference,
    // not a to-do marker -- it must never disappear just because the person
    // confirmed or edited the field. See the code comment on
    // `fieldsToLocate` for the full rationale.

    it("keeps a field highlighted while its value is still blank (suggestion pending)", () => {
      const map = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          {
            name: null,
            position: null,
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      expect(map.get("d:0")?.map((a) => a.field)).toEqual([
        "recommendation_date",
      ]);
      expect(map.get("d:1")?.map((a) => a.field)).toEqual([
        "recipient:0:name",
        "recipient:0:position",
      ]);
    });

    it("keeps a field highlighted after its suggestion is accepted unchanged", () => {
      const map = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: "2022-05-30",
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          {
            name: "Ana Pérez",
            position: "Directora General",
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      expect(map.get("d:0")?.map((a) => a.field)).toEqual([
        "recommendation_date",
      ]);
      expect(map.get("d:1")?.map((a) => a.field)).toEqual([
        "recipient:0:name",
        "recipient:0:position",
      ]);
    });

    it("tracks the payload's own edited value, not the model's original suggestion, once the person types something different", () => {
      const customParagraphs: Paragraph[] = [
        { id: "d:0", document_id: "d", value: "Expediente 999/2026 iniciado." },
      ];
      const prediction: DataExtractionPrediction = {
        ...basePrediction,
        recommendation_number: "123/2026", // not present in customParagraphs
        recommendation_date: "",
        recipients: [],
      };
      const map = buildAnnotations(prediction, customParagraphs, {
        recommendation_number: "999/2026", // the person's own edit
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [],
      });
      expect(map.get("d:0")?.map((a) => a.field)).toEqual([
        "recommendation_number",
      ]);
    });

    // Clearing a field writes "", not null, and the suggestion mark comes
    // back the moment it is empty. The highlight has to come back with it:
    // the two are the same offer, and a reference that disappears while the
    // mark is still on screen just reads as a glitch.
    it("falls back to the suggestion when the person erases a field", () => {
      const map = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          {
            name: "", // erased, so the mark is showing again
            position: "Directora General",
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });

      expect(map.get("d:1")?.map((a) => a.field)).toContain("recipient:0:name");
    });

    it("treats a whitespace-only field as erased too", () => {
      const map = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          {
            name: "   ",
            position: "Directora General",
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });

      expect(map.get("d:1")?.map((a) => a.field)).toContain("recipient:0:name");
    });

    // `locateValue` caps exact matches at three by default. Applied here it
    // highlighted a name's first three occurrences and left the rest dark,
    // which reads as the matcher failing on the ones further down.
    it("highlights every occurrence of a value, not just the first few", () => {
      const repeated: Paragraph[] = [
        {
          id: "d:0",
          document_id: "d",
          value: "los Refugios Tita Merello para mujeres",
        },
        {
          id: "d:1",
          document_id: "d",
          value: "los Refugios Tita Merello y Mariquita Sánchez",
        },
        {
          id: "d:2",
          document_id: "d",
          value: "el Hogar Eva Duarte; los Refugios Tita Merello",
        },
        {
          id: "d:3",
          document_id: "d",
          value: 'refugios - y "Tita Merello" - para mujeres',
        },
        {
          id: "d:4",
          document_id: "d",
          value: "en el refugio Tita Merello (17 plazas)",
        },
      ];
      const map = buildAnnotations(
        { ...basePrediction, recommendation_date: "", recipients: [] },
        repeated,
        {
          recommendation_number: null,
          recommendation_date_text: null,
          recommendation_date: null,
          topic: null,
          subtopic: null,
          personal_data: null,
          publishable_content: "",
          recipients: [
            {
              name: "Tita Merello",
              position: null,
              is_primary: true,
              macro_sector: null,
              unit_id: null,
              sector_id: null,
            },
          ],
        },
      );

      // Including the last two, which the default cap used to drop.
      expect([...map.keys()].sort()).toEqual([
        "d:0",
        "d:1",
        "d:2",
        "d:3",
        "d:4",
      ]);
    });

    // The typed value still wins whenever there is one -- the fallback must
    // not swallow a real edit.
    it("locates a typed value that appears inside surrounding punctuation", () => {
      const quoted: Paragraph[] = [
        {
          id: "d:0",
          document_id: "d",
          value:
            'Sostener la independencia de los refugios "Mariquita Sánchez" y "Tita Merello" -',
        },
      ];
      const map = buildAnnotations(
        { ...basePrediction, recipients: [] },
        quoted,
        {
          recommendation_number: null,
          recommendation_date_text: null,
          recommendation_date: null,
          topic: null,
          subtopic: null,
          personal_data: null,
          publishable_content: "",
          recipients: [
            {
              name: "Tita Merello", // typed without the quotes around it
              position: null,
              is_primary: true,
              macro_sector: null,
              unit_id: null,
              sector_id: null,
            },
          ],
        },
      );

      const located = map
        .get("d:0")
        ?.find((a) => a.field === "recipient:0:name");
      expect(located).toBeDefined();
      expect(quoted[0].value.slice(located?.start, located?.end)).toBe(
        "Tita Merello",
      );
    });

    it("always searches recommendation_date's raw detected prose, never the payload's chosen date", () => {
      // `recommendation_date_text` is never itself edited (conserved
      // verbatim, PLAN.md §D.3), so there is no "the person's own text" to
      // prefer here -- unlike the other three fields, this one ignores the
      // payload entirely for its search text.
      const map = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: "123/2026",
        recommendation_date_text: "30 de mayo de 2022",
        recommendation_date: "2022-05-30",
        topic: "AMBIENTE y CAMBIO CLIMÁTICO",
        subtopic: "Inundaciones",
        personal_data: true,
        publishable_content: "x",
        recipients: [
          {
            name: "Ana Pérez",
            position: "Directora General",
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      expect(map.get("d:0")?.map((a) => a.field)).toEqual([
        "recommendation_date",
      ]);
    });

    it("highlights a manually-added recipient's name/position too, even though it has no counterpart in the prediction", () => {
      // `addRecipient` (`useRecommendationForm.ts`) appends a blank
      // recipient at the end of `values.recipients`, with no matching entry
      // in `prediction.recipients` at all (`source_index: null`). There is
      // nothing to fall back to for this one -- the payload IS the only
      // source of truth.
      const customParagraphs: Paragraph[] = [
        {
          id: "d:2",
          document_id: "d",
          value: "Con copia a Juan Gómez, Subsecretario.",
        },
      ];
      const map = buildAnnotations(basePrediction, customParagraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          // Index 0 mirrors basePrediction's own recipient (blank payload).
          {
            name: null,
            position: null,
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
          // Index 1 exists only in the payload -- manually added.
          {
            name: "Juan Gómez",
            position: "Subsecretario",
            is_primary: false,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      expect(map.get("d:2")?.map((a) => a.field)).toEqual([
        "recipient:1:name",
        "recipient:1:position",
      ]);
    });

    it("with no payload (null), matches the all-blank-payload case -- everything falls back to the prediction", () => {
      const withNullPayload = buildAnnotations(
        basePrediction,
        paragraphs,
        null,
      );
      const withBlankPayload = buildAnnotations(basePrediction, paragraphs, {
        recommendation_number: null,
        recommendation_date_text: null,
        recommendation_date: null,
        topic: null,
        subtopic: null,
        personal_data: null,
        publishable_content: "",
        recipients: [
          {
            name: null,
            position: null,
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      expect([...withNullPayload.entries()]).toEqual([
        ...withBlankPayload.entries(),
      ]);
    });
  });

  it("returns non-overlapping ranges within a paragraph", () => {
    const overlapping: Paragraph[] = [
      {
        id: "d:0",
        document_id: "d",
        value: "Directora General de Fiscalización",
      },
    ];
    const prediction: DataExtractionPrediction = {
      ...basePrediction,
      recommendation_date: "",
      recipients: [
        {
          ...basePrediction.recipients[0],
          name: "Directora General",
          position: "Directora General de Fiscalización",
          sector_name: "",
        },
      ],
    };
    const annotations =
      buildAnnotations(prediction, overlapping).get("d:0") ?? [];
    for (let i = 1; i < annotations.length; i++) {
      expect(annotations[i].start).toBeGreaterThanOrEqual(
        annotations[i - 1].end,
      );
    }
  });
});
