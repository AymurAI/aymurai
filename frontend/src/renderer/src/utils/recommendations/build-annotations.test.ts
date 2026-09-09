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
      expect(map.get("d:1")?.map((a) => a.field)).toEqual([
        "recipient:0:name",
        "recipient:0:position",
      ]);
    });

    it("drops a field's highlight once its value is set (suggestion accepted or overridden)", () => {
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
            name: "Ana Pérez",
            position: null,
            is_primary: true,
            macro_sector: null,
            unit_id: null,
            sector_id: null,
          },
        ],
      });
      // name accepted -> no longer highlighted; position still blank -> stays.
      expect(map.get("d:1")?.map((a) => a.field)).toEqual([
        "recipient:0:position",
      ]);
    });

    it("never gates recommendation_date on the payload -- it never carried a suggestion overlay", () => {
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

    it("with no payload (null), behaves exactly as before -- everything highlighted", () => {
      const withPayload = buildAnnotations(basePrediction, paragraphs, null);
      const withoutPayload = buildAnnotations(basePrediction, paragraphs);
      expect([...withPayload.entries()]).toEqual([...withoutPayload.entries()]);
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
