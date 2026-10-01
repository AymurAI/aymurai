import { describe, expect, it } from "vitest";
import type { RecommendationDetail } from "@/types/dataExtraction";
import { predictionFromDetail } from "./prediction-from-detail";

/**
 * Captured from a real extract -> validate -> correct cycle run against the
 * actual FastAPI test client (`FakeProvider` stands in only for the LLM call
 * itself; catalogs seeding, organigram matching, and persistence all ran for
 * real) -- not hand-typed. `prediction` is exactly what
 * `RecommendationDetailResponse.prediction` serves on the wire: the raw,
 * unresolved `RawExtraction.model_dump()` shape, missing `document_id`/
 * `config`/`catalogs_stale` and each recipient's organigram resolution. This
 * is the shape `predictionFromDetail` exists to reconcile.
 */
const REAL_DETAIL_FIXTURE: RecommendationDetail = {
  id: "38778ad6-9546-49b7-ab63-f9cbdd555a74",
  document_id: "b13a222f-c9c4-55b0-9838-591a27280af4",
  recommendation_number: null,
  recommendation_date_text: null,
  recommendation_date: null,
  topic: null,
  subtopic: null,
  personal_data: null,
  publishable_content: "Contenido.",
  recipients: [],
  file_number: null,
  recommendation_detail: null,
  recommendation_situation: null,
  status: null,
  approved_for_publication: null,
  link: null,
  created_at: "2026-09-23T19:43:59",
  updated_at: null,
  source_text: "Documento de captura de fixture.",
  source_paragraphs: ["Documento de captura de fixture."],
  prediction: {
    recommendation_number: "5/2024",
    recommendation_date: "01 de enero de 2024",
    recipients: [
      {
        name: "Juan Perez",
        position: "Ministro de Salud",
        is_primary: true,
        macro_sector: "GCBA",
      },
      {
        name: "Maria Gomez",
        position: "Presidenta",
        is_primary: false,
        macro_sector: "Poder Judicial",
      },
    ],
    topic: "SALUD",
    subtopic: "Hospitales",
    personal_data: false,
    publishable_content: "Resumen.",
  },
};

describe("predictionFromDetail", () => {
  it("parses a real stored prediction blob without throwing", () => {
    expect(() => predictionFromDetail(REAL_DETAIL_FIXTURE)).not.toThrow();
  });

  it("fills document_id from the detail row, and the preserved stored fields through", () => {
    const result = predictionFromDetail(REAL_DETAIL_FIXTURE);

    expect(result.document_id).toBe(REAL_DETAIL_FIXTURE.document_id);
    expect(result.recommendation_number).toBe("5/2024");
    expect(result.recommendation_date).toBe("01 de enero de 2024");
    expect(result.topic).toBe("SALUD");
    expect(result.subtopic).toBe("Hospitales");
    expect(result.personal_data).toBe(false);
    expect(result.publishable_content).toBe("Resumen.");
    expect(result.recipients).toHaveLength(2);
    expect(result.recipients[0]).toMatchObject({
      name: "Juan Perez",
      position: "Ministro de Salud",
      is_primary: true,
      macro_sector: "GCBA",
    });
  });

  it("defaults every recipient's organigram resolution to unresolved, honestly rather than silently", () => {
    const result = predictionFromDetail(REAL_DETAIL_FIXTURE);

    for (const recipient of result.recipients) {
      expect(recipient.unit_id).toBeNull();
      expect(recipient.unit_name).toBeNull();
      expect(recipient.sector_id).toBeNull();
      expect(recipient.sector_name).toBeNull();
      expect(recipient.match_method).toBeNull();
      expect(recipient.sector_candidates).toEqual([]);
      expect(recipient.unit_candidates).toEqual([]);
    }
  });

  it("defaults config/catalogs_stale, which are not preserved in storage", () => {
    const result = predictionFromDetail(REAL_DETAIL_FIXTURE);

    expect(result.config).toEqual({
      model: "",
      options: {},
      catalogs_hash: "",
    });
    expect(result.catalogs_stale).toBe(false);
  });

  it("rejects a malformed stored prediction instead of passing it through", () => {
    const malformed = {
      ...REAL_DETAIL_FIXTURE,
      // `publishable_content` is required and non-nullable on the stored shape.
      prediction: {
        ...REAL_DETAIL_FIXTURE.prediction,
        publishable_content: undefined,
      },
    };

    expect(() =>
      predictionFromDetail(malformed as RecommendationDetail),
    ).toThrow();
  });
});
