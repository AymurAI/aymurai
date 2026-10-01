import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let mock: typeof import("./mockDataExtraction");
let catalogs: typeof import("./mockCatalogs");

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

async function list(
  params: Parameters<typeof mock.mockRecommendationsList>[0],
) {
  return settle(mock.mockRecommendationsList(params));
}

describe("mock recommendations list filters", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    mock = await import("./mockDataExtraction");
    catalogs = await import("./mockCatalogs");
    const detail = await settle(
      mock.mockRecommendationDetail("recommendation-1"),
    );
    const topics = await settle(catalogs.mockListTopics());
    await settle(
      mock.mockCorrectRecommendation({
        recommendationId: detail.id,
        ifMatch: detail.updated_at ?? detail.created_at,
        payload: {
          recommendation_number: detail.recommendation_number,
          recommendation_date_text: detail.recommendation_date_text,
          recommendation_date: detail.recommendation_date,
          topic: topics[0].name,
          subtopic: null,
          personal_data: false,
          publishable_content: detail.publishable_content,
          recipients: [
            {
              name: "Primary",
              position: null,
              is_primary: true,
              macro_sector: "Empresa",
              unit_id: null,
              sector_id: null,
            },
            {
              name: "Secondary Person",
              position: "Directora",
              is_primary: false,
              macro_sector: "GCBA",
              unit_id: "dgpolea",
              sector_id: "avig",
            },
          ],
        },
      }),
    );
  });

  afterEach(() => vi.useRealTimers());

  it.each([
    "SECONDARY PERSON",
    "directora",
    "Estrategia Ambiental",
    "Vicejefatura",
    "gcba",
    "123/2026",
    "EX-2026-00123",
    "medicamentos",
  ])("searches recipient and recommendation fields for %s", async (q) => {
    const result = await list({ q });
    expect(result.items.map((row) => row.id)).toEqual(["recommendation-1"]);
  });

  it("filters any recipient by sector and resolves catalog IDs before paginating", async () => {
    const topics = await settle(catalogs.mockListTopics());
    const sectors = await settle(catalogs.mockListMacroSectors());
    const result = await list({
      topicId: topics[0].id,
      sectorId: "avig",
      macroSectorId: sectors.find((sector) => sector.name === "GCBA")?.id,
      recommendationSituation: "Notificado",
      dateFrom: "2026-11-22",
      dateTo: "2026-11-22",
      pageSize: 1,
      orderBy: "recommendation_number",
      orderDir: "asc",
    });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("recommendation-1");
    expect((await list({ sectorId: "missing" })).total).toBe(0);
    expect((await list({ macroSectorId: "missing" })).total).toBe(0);
    expect((await list({ topicId: "missing" })).total).toBe(0);
    expect((await list({ dateFrom: "2026-11-23" })).total).toBe(0);
  });

  it("distinguishes approved, rejected and unanswered publication values", async () => {
    expect(
      (await list({ publicationUnanswered: true })).items.map((row) => row.id),
    ).toEqual(["recommendation-1"]);
    expect((await list({ approvedForPublication: false })).total).toBe(0);
    expect(
      (
        await list({ approvedForPublication: true, status: "Solucionado" })
      ).items.map((row) => row.id),
    ).toEqual(["recommendation-2"]);
    await settle(
      mock.mockPatchRecommendationSeguimiento({
        recommendationId: "recommendation-1",
        payload: {
          approved_for_publication: false,
          recommendation_detail: "Detalle único",
        },
      }),
    );
    expect(
      (await list({ approvedForPublication: false })).items.map(
        (row) => row.id,
      ),
    ).toEqual(["recommendation-1"]);
    expect((await list({ publicationUnanswered: true })).total).toBe(0);
    expect((await list({ q: "Detalle único" })).total).toBe(1);
  });

  it("retains ordering, page totals and unparsed dates", async () => {
    const result = await list({
      page: 2,
      pageSize: 1,
      orderBy: "recommendation_number",
      orderDir: "desc",
    });
    expect(result).toMatchObject({ total: 2, page: 2, page_size: 1 });
    expect(result.items[0].id).toBe("recommendation-1");
    expect(
      (await list({ unparsedDates: true })).items.map((row) => row.id),
    ).toEqual(["recommendation-2"]);
  });
});
