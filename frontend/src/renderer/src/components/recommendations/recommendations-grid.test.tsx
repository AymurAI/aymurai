import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecommendationRow } from "@/types/dataExtraction";
import { formatDisplayTimestamp } from "@/utils/format-date";
import RecommendationsGrid from "./recommendations-grid";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Radix's Select trigger opens on `pointerdown` and its content measures
// itself — none of which jsdom implements. Same stubbing reason as the
// `ResizeObserver` shim already in `test/setup.ts`, kept local because this is
// the first test in the suite that actually opens one of these dropdowns.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

// The two closed catalogs come from the server, and the tests read the option
// text off THIS fixture — a value written into the component would not show up
// here (issue #58, "Decisiones tomadas" §5).
const ENUMS = {
  situations: ["En análisis", "Respondida"],
  statuses: ["Abierta", "Cerrada"],
};

function aRow(overrides: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    id: "r1",
    document_id: "d1",
    recommendation_number: "REC-001",
    recommendation_date_text: "22 de noviembre",
    recommendation_date: "2026-01-20",
    topic: "Salud",
    subtopic: "Guardias",
    personal_data: false,
    publishable_content: "contenido",
    recipients: [
      {
        id: "rec1",
        source_index: 0,
        name: "Ana Pérez",
        position: "Directora",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: "u1",
        unit_name: "Dirección",
        sector_id: "s1",
        sector_name: "Ministerio de Salud",
      },
    ],
    file_number: "EX-1",
    recommendation_detail: null,
    recommendation_situation: null,
    status: "Abierta",
    approved_for_publication: null,
    link: null,
    created_at: "2026-01-01T09:00:00",
    updated_at: "2026-02-01T10:00:00",
    ...overrides,
  };
}

// `updated_at: null` — never touched since it was registered.
const NEVER_EDITED = aRow({
  id: "r2",
  recommendation_number: "REC-002",
  recipients: [
    {
      id: "rec2",
      source_index: 0,
      name: "Luis Gómez",
      position: "Director",
      is_primary: true,
      macro_sector: "GCBA",
      unit_id: "u2",
      unit_name: "Subsecretaría",
      sector_id: "s2",
      sector_name: "Ministerio de Educación",
    },
  ],
  file_number: null,
  status: null,
  created_at: "2026-03-15T12:00:00",
  updated_at: null,
});

const { mockList, mockEnums, mockPatch } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockEnums: vi.fn(),
  mockPatch: vi.fn(),
}));

vi.mock("@/services/aymurai/dataExtraction", () => ({
  recommendationsList: (params: unknown) => ({
    queryKey: ["recommendations-list", params, undefined],
    queryFn: () => mockList(params),
  }),
  recommendationEnums: () => ({
    queryKey: ["recommendation-enums", undefined],
    queryFn: () => mockEnums(),
  }),
  patchRecommendationSeguimiento: () => ({ mutationFn: mockPatch }),
}));

function renderGrid() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecommendationsGrid />
    </QueryClientProvider>,
  );
}

/**
 * Radix's `Select` opens on `pointerdown`, and its handler reads
 * `pointerType`/`pointerId` off the event — jsdom fills in neither, so the
 * defaults `fireEvent` produces are read as a touch and ignored.
 */
async function openDropdown(trigger: HTMLElement) {
  // The catalog cells stay locked until `recommendationEnums()` answers, and a
  // pointerdown on a disabled trigger is simply dropped — so wait for it to
  // unlock rather than racing the query.
  await waitFor(() => expect(trigger).not.toHaveAttribute("data-disabled"));
  fireEvent.pointerDown(trigger, {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
    pointerId: 1,
  });
}

/** The accessible name `RecommendationsGridRow` builds for one cell. */
const cellLabel = (column: string, row: string) =>
  `grilla.columns.${column} · ${row}`;

describe("RecommendationsGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnums.mockResolvedValue(ENUMS);
    mockList.mockResolvedValue({
      items: [aRow(), NEVER_EDITED],
      total: 2,
      page: 1,
      page_size: 20,
    });
    mockPatch.mockImplementation(async ({ recommendationId, payload }) => ({
      ...aRow({ id: recommendationId }),
      ...payload,
    }));
  });

  it("lists the recommendations the server returned", async () => {
    renderGrid();

    expect(await screen.findByText("REC-001")).toBeInTheDocument();
    expect(screen.getByText("REC-002")).toBeInTheDocument();
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
  });

  it("shows the workbook's document-derived columns, read-only", async () => {
    mockList.mockResolvedValue({
      items: [
        aRow({ personal_data: true, publishable_content: "Texto publicable" }),
        aRow({
          id: "r3",
          recommendation_number: "REC-003",
          personal_data: null,
        }),
      ],
      total: 2,
      page: 1,
      page_size: 20,
    });
    renderGrid();

    expect(
      await screen.findByRole("columnheader", {
        name: "grilla.columns.publishableContent",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "grilla.columns.personalData" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Texto publicable")).toBeInTheDocument();
    // Same yes/no wording as the validation form, and the export's "si"/""
    // tri-state: never answered stays blank, not "No".
    const [first, second] = screen.getAllByRole("row").slice(1);
    expect(first).toHaveTextContent("validation.personalDataYes");
    expect(second).not.toHaveTextContent("validation.personalData");
    // Not one of the six seguimiento fields: nothing to edit here.
    expect(
      screen.queryByLabelText(cellLabel("personalData", "REC-001")),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(cellLabel("publishableContent", "REC-001")),
    ).not.toBeInTheDocument();
  });

  it("sends only the edited key when a seguimiento cell is committed", async () => {
    renderGrid();

    const cell = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-002"),
    );
    fireEvent.change(cell, { target: { value: "EX-99" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith(
      { recommendationId: "r2", payload: { file_number: "EX-99" } },
      expect.anything(),
    );
  });

  it("sends an explicit null when a cell with content is emptied", async () => {
    renderGrid();

    const cell = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-001"),
    );
    fireEvent.change(cell, { target: { value: "" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith(
      { recommendationId: "r1", payload: { file_number: null } },
      expect.anything(),
    );
  });

  it("saves nothing when a cell is left exactly as it was", async () => {
    renderGrid();

    const cell = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-001"),
    );
    fireEvent.focus(cell);
    fireEvent.blur(cell);

    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("offers the situation options the enums endpoint returned", async () => {
    renderGrid();

    const trigger = await screen.findByLabelText(
      cellLabel("recommendationSituation", "REC-001"),
    );
    await openDropdown(trigger);

    for (const situation of ENUMS.situations) {
      expect(
        await screen.findByRole("option", { name: situation }),
      ).toBeInTheDocument();
    }
  });

  it("offers the status options the enums endpoint returned", async () => {
    renderGrid();

    const trigger = await screen.findByLabelText(
      cellLabel("status", "REC-002"),
    );
    await openDropdown(trigger);

    for (const status of ENUMS.statuses) {
      expect(
        await screen.findByRole("option", { name: status }),
      ).toBeInTheDocument();
    }
  });

  it("saves the picked status as that single key", async () => {
    renderGrid();

    const trigger = await screen.findByLabelText(
      cellLabel("status", "REC-002"),
    );
    await openDropdown(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Cerrada" }));

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith(
      { recommendationId: "r2", payload: { status: "Cerrada" } },
      expect.anything(),
    );
  });

  it("reports a cleared dropdown as an explicit null", async () => {
    renderGrid();

    await screen.findByLabelText(cellLabel("status", "REC-001"));
    // The trigger's only button while a value is set is its clear (×) — the
    // suggestion mark the library also renders there never appears here. It is
    // also hidden until the catalog arrives, hence `findAllBy`.
    const [clear] = await screen.findAllByRole("button", { name: /limpiar/i });
    fireEvent.click(clear as HTMLElement);

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
    expect(mockPatch).toHaveBeenCalledWith(
      { recommendationId: "r1", payload: { status: null } },
      expect.anything(),
    );
  });

  it("marks the last edit with created_at when the row was never updated", async () => {
    renderGrid();

    // Expected through `formatDisplayTimestamp` rather than as a literal:
    // the fixtures carry the wire format (naive, no `Z`), which is rendered
    // in the reader's own timezone — so a literal would only hold on a
    // machine set to one particular one. `format-date.test.ts` is where the
    // formatting itself is pinned down.
    // REC-002 has `updated_at: null`, so its mark is its `created_at`...
    expect(
      await screen.findByText(formatDisplayTimestamp("2026-03-15T12:00:00")),
    ).toBeInTheDocument();
    // ...while REC-001, which has one, shows that instead of its own
    // `created_at`.
    expect(
      screen.getByText(formatDisplayTimestamp("2026-02-01T10:00:00")),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(formatDisplayTimestamp("2026-01-01T09:00:00")),
    ).not.toBeInTheDocument();
  });

  it("orders by a whitelisted column when its header is clicked", async () => {
    renderGrid();

    fireEvent.click(
      await screen.findByRole("button", {
        name: /grilla\.columns\.recommendationDate/,
      }),
    );

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: "recommendation_date",
          orderDir: "asc",
        }),
      ),
    );
  });

  it("sorts by the last edit by default, the column the header marks", async () => {
    renderGrid();

    const header = await screen.findByRole("columnheader", {
      name: /grilla\.columns\.lastEdited/,
    });
    expect(header).toHaveAttribute("aria-sort", "descending");
    // What "Última edición" shows is `updated_at ?? created_at`, so that is
    // what the request has to order by -- not `created_at` alone.
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: "last_edited", orderDir: "desc" }),
    );
  });

  it("asks the server for only the rows with an unparsed date", async () => {
    renderGrid();

    fireEvent.click(
      await screen.findByLabelText("grilla.filters.unparsedDates"),
    );

    await waitFor(() =>
      expect(mockList).toHaveBeenCalledWith(
        expect.objectContaining({ unparsedDates: true }),
      ),
    );
  });

  it("warns instead of losing the edit when the save fails", async () => {
    mockPatch.mockRejectedValueOnce(new Error("500"));
    renderGrid();

    const cell = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-002"),
    );
    fireEvent.change(cell, { target: { value: "EX-99" } });
    fireEvent.blur(cell);

    expect(await screen.findByText("grilla.saveFailed")).toBeInTheDocument();
    // The draft still shows the text that was never saved, so the cell itself
    // has to say so — a banner alone would leave the value looking accepted.
    await waitFor(() => expect(cell).toBeInvalid());
    expect(cell).toHaveValue("EX-99");
  });

  // The regression the per-cell tracking exists for: one boolean for the whole
  // grid meant row B's success silently erased row A's warning, while row A's
  // cell went on displaying text the server had rejected.
  it("keeps warning about a failed cell when a different row saves fine", async () => {
    mockPatch.mockRejectedValueOnce(new Error("500"));
    renderGrid();

    const failing = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-002"),
    );
    fireEvent.change(failing, { target: { value: "EX-99" } });
    fireEvent.blur(failing);
    await waitFor(() => expect(failing).toBeInvalid());

    const succeeding = screen.getByLabelText(
      cellLabel("recommendationDetail", "REC-001"),
    );
    fireEvent.change(succeeding, { target: { value: "va bien" } });
    fireEvent.blur(succeeding);
    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(2));

    expect(screen.getByText("grilla.saveFailed")).toBeInTheDocument();
    expect(failing).toBeInvalid();
    expect(succeeding).not.toBeInvalid();
  });

  it("clears a cell's warning once that same edit finally lands", async () => {
    mockPatch.mockRejectedValueOnce(new Error("500"));
    renderGrid();

    const cell = await screen.findByLabelText(
      cellLabel("fileNumber", "REC-002"),
    );
    fireEvent.change(cell, { target: { value: "EX-99" } });
    fireEvent.blur(cell);
    await waitFor(() => expect(cell).toBeInvalid());

    fireEvent.change(cell, { target: { value: "EX-100" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(cell).not.toBeInvalid());
    expect(screen.queryByText("grilla.saveFailed")).not.toBeInTheDocument();
  });

  it("surfaces a failure to load the base", async () => {
    mockList.mockRejectedValue(new Error("500"));
    renderGrid();

    expect(await screen.findByText("grilla.loadFailed")).toBeInTheDocument();
  });

  // Without this the two catalog cells render as empty pickers indistinguishable
  // from empty catalogs -- and clearing one would erase a value with nothing
  // left on the list to restore it from.
  it("says so and locks the catalog cells when the enums fail to load", async () => {
    mockEnums.mockRejectedValue(new Error("500"));
    renderGrid();

    expect(await screen.findByText("grilla.enumsFailed")).toBeInTheDocument();

    const status = screen.getByLabelText(cellLabel("status", "REC-001"));
    const situation = screen.getByLabelText(
      cellLabel("recommendationSituation", "REC-001"),
    );
    expect(status).toHaveAttribute("data-disabled");
    expect(situation).toHaveAttribute("data-disabled");
    // `Select` hides its own clear (×) while disabled, so there is no way to
    // erase a value the empty catalog could not put back.
    expect(
      screen.queryByRole("button", { name: /limpiar/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves the free-text cells editable when only the enums fail", async () => {
    mockEnums.mockRejectedValue(new Error("500"));
    renderGrid();

    await screen.findByText("grilla.enumsFailed");
    const cell = screen.getByLabelText(cellLabel("fileNumber", "REC-002"));
    fireEvent.change(cell, { target: { value: "EX-99" } });
    fireEvent.blur(cell);

    await waitFor(() => expect(mockPatch).toHaveBeenCalledTimes(1));
  });
});
