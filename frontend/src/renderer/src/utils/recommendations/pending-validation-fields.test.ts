import { describe, expect, it } from "vitest";
import type {
  RecipientFormValues,
  RecommendationFormValues,
} from "@/types/dataExtraction";
import { findPendingValidationFields } from "./pending-validation-fields";

function aRecipient(
  partial: Partial<RecipientFormValues> = {},
): RecipientFormValues {
  return {
    id: null,
    source_index: 0,
    name: null,
    position: null,
    is_primary: false,
    macro_sector: null,
    unit_id: null,
    sector_id: null,
    ...partial,
  };
}

function aFormValues(
  partial: Partial<RecommendationFormValues> = {},
): RecommendationFormValues {
  return {
    recommendation_number: null,
    recommendation_date_text: null,
    recommendation_date: null,
    topic: null,
    subtopic: null,
    personal_data: null,
    publishable_content: "",
    recipients: [aRecipient()],
    ...partial,
  };
}

describe("findPendingValidationFields", () => {
  it("reports nothing when the model answered nothing", () => {
    expect(findPendingValidationFields(aFormValues(), aFormValues())).toEqual(
      [],
    );
  });

  it("reports a top-level field left blank while its suggestion stands", () => {
    expect(
      findPendingValidationFields(
        aFormValues(),
        aFormValues({ topic: "Salud" }),
      ),
    ).toEqual([{ labelKey: "topic" }]);
  });

  it("stops reporting a field once a value was accepted or typed", () => {
    expect(
      findPendingValidationFields(
        aFormValues({ topic: "Otro tema" }),
        aFormValues({ topic: "Salud" }),
      ),
    ).toEqual([]);
  });

  it("treats an empty string as blank, like the suggestion mark does", () => {
    expect(
      findPendingValidationFields(
        aFormValues({ recommendation_number: "" }),
        aFormValues({ recommendation_number: "123/2026" }),
      ),
    ).toEqual([{ labelKey: "recommendationNumber" }]);
  });

  it("reports top-level fields in the order the form renders them", () => {
    expect(
      findPendingValidationFields(
        aFormValues(),
        aFormValues({
          recommendation_number: "123/2026",
          recommendation_date: "2026-11-22",
          topic: "Salud",
          subtopic: "Acceso a medicamentos",
        }),
      ),
    ).toEqual([
      { labelKey: "recommendationNumber" },
      { labelKey: "recommendationDate" },
      { labelKey: "topic" },
      { labelKey: "subtopic" },
    ]);
  });

  it("reports a recipient's own fields, tagged with its index", () => {
    expect(
      findPendingValidationFields(
        aFormValues({ recipients: [aRecipient(), aRecipient()] }),
        aFormValues({
          recipients: [
            aRecipient(),
            aRecipient({
              macro_sector: "GCBA",
              name: "Ana Pérez",
              position: "Directora",
            }),
          ],
        }),
      ),
    ).toEqual([
      { labelKey: "macroSector", recipientIndex: 1 },
      { labelKey: "name", recipientIndex: 1 },
      { labelKey: "position", recipientIndex: 1 },
    ]);
  });

  // ADR-0013: the pair never travels alone, so it is one pending field, not
  // two -- naming both would read like two separate things to go fix.
  it("counts the unit/sector pair as a single pending field", () => {
    expect(
      findPendingValidationFields(
        aFormValues(),
        aFormValues({
          recipients: [aRecipient({ unit_id: "u1", sector_id: "s1" })],
        }),
      ),
    ).toEqual([{ labelKey: "unit", recipientIndex: 0 }]);
  });

  // A hand-added recipient has no frozen inference of its own
  // (`useRecommendationForm`'s `addRecipient`), so `suggestions.recipients`
  // is shorter than `values.recipients` and the lookup must not throw.
  it("ignores a recipient the person added by hand", () => {
    expect(
      findPendingValidationFields(
        aFormValues({ recipients: [aRecipient(), aRecipient()] }),
        aFormValues({ recipients: [aRecipient({ name: "Ana Pérez" })] }),
      ),
    ).toEqual([{ labelKey: "name", recipientIndex: 0 }]);
  });

  // The three fields ADR-0013 deliberately leaves pre-filled are not part of
  // this question at all -- they are saved with the model's answer by design.
  it("ignores the fields ADR-0013 leaves out", () => {
    expect(
      findPendingValidationFields(
        aFormValues({ personal_data: null, publishable_content: "" }),
        aFormValues({
          personal_data: true,
          publishable_content: "Síntesis del modelo.",
          recommendation_date_text: "22 de noviembre",
        }),
      ),
    ).toEqual([]);
  });
});
