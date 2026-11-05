import { describe, expect, it } from "vitest";
import recommendations from "./locales/es/recommendations";

describe("recommendations i18n — onboarding", () => {
  it("defines every onboarding key the shared DocumentOnboarding screen reads", () => {
    expect(recommendations.onboarding).toBeDefined();
    expect(recommendations.onboarding.sectionTitle).toBe(
      "1. Selección de archivo",
    );
    expect(recommendations.onboarding.loadDocuments).toBe("Cargar documento");
    expect(typeof recommendations.onboarding.dropAreaTitle).toBe("string");
    expect(typeof recommendations.onboarding.dropAreaFormats).toBe("string");
    expect(typeof recommendations.onboarding.validFormats).toBe("string");
  });
});

describe("recommendations i18n — howItWorks", () => {
  it("defines every howItWorks step key the shared HowItWorks modal reads", () => {
    expect(recommendations.howItWorks).toBeDefined();
    for (const step of ["step1", "step2", "step3", "step4"] as const) {
      const entry = recommendations.howItWorks[step];
      expect(entry).toBeDefined();
      expect(typeof entry.alt).toBe("string");
      expect(entry.alt.length).toBeGreaterThan(0);
      expect(typeof entry.title).toBe("string");
      expect(entry.title.length).toBeGreaterThan(0);
      expect(typeof entry.subtitle).toBe("string");
      expect(entry.subtitle.length).toBeGreaterThan(0);
    }
  });
});

describe("recommendations i18n — preview", () => {
  it("defines every preview key the preview route reads", () => {
    expect(recommendations.preview).toBeDefined();
    expect(typeof recommendations.preview.sectionTitle).toBe("string");
    expect(typeof recommendations.preview.filesLabel).toBe("string");
    expect(typeof recommendations.preview.validFormats).toBe("string");
    expect(typeof recommendations.preview.loadMore).toBe("string");
    expect(typeof recommendations.preview.continue).toBe("string");
  });
});

describe("recommendations i18n — unvalidated-fields warning", () => {
  it("defines the warning with its {{fields}} slot and the confirm label", () => {
    expect(recommendations.validation.unvalidatedFieldsWarning).toContain(
      "{{fields}}",
    );
    expect(typeof recommendations.validation.validateAnyway).toBe("string");
    expect(recommendations.validation.validateAnyway.length).toBeGreaterThan(0);
  });
});

describe("recommendations i18n — editing", () => {
  it("uses editing terminology and names the publishable-content column", () => {
    expect(recommendations.correction.title).toBe(
      "Recomendaciones · Editar validación",
    );
    expect(recommendations.correction.save).toBe("Guardar edición");
    expect(recommendations.correction).not.toHaveProperty("subtitle");
    expect(recommendations.correction.sectionTitle).toBe(
      "Datos de la recomendación validada",
    );
    expect(recommendations.grilla.columns.publishableContent).toBe(
      "Contenido para publicar",
    );
  });
});
