import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OrganigramScreen from "./organigram-screen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const units = [
  {
    id: "jg",
    parent_id: null,
    name: "Jefatura de Gabinete",
    acronym: null,
    short_name: null,
    is_sector: false,
    active: true,
    order: 1,
    created_at: "x",
    updated_at: "x",
  },
  {
    id: "seca",
    parent_id: "jg",
    name: "Secretaría de Cultura",
    acronym: "SECA",
    short_name: null,
    is_sector: true,
    active: true,
    order: 1,
    created_at: "x",
    updated_at: "x",
  },
];
const holdersByUnit: Record<string, unknown[]> = {
  seca: [
    {
      id: "h1",
      unit_id: "seca",
      name: "María Pérez",
      is_current: true,
      created_at: "x",
      updated_at: "x",
    },
  ],
};

const updateUnitMock = vi.fn();
const addHolderMock = vi.fn();

vi.mock("@/services/aymurai", () => ({
  organigramService: {
    listUnits: () => ({ queryKey: ["units"], queryFn: async () => units }),
    unitHolders: (unitId: string) => ({
      queryKey: ["holders", unitId],
      queryFn: async () => holdersByUnit[unitId] ?? [],
    }),
    updateUnit: () => ({ mutationFn: updateUnitMock }),
    addHolder: () => ({ mutationFn: addHolderMock }),
    createUnit: () => ({ mutationFn: vi.fn() }),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

describe("OrganigramScreen — tree + detail panel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the root unit and its child nested under it", async () => {
    renderWithClient(<OrganigramScreen />);

    // `organigramService.listUnits()`'s mocked queryFn is async, so the tree
    // only populates after a render past the initial empty-data state —
    // `findByText` (not a synchronous `getByText`) is required here, matching
    // taxonomy-screen.test.tsx's identical "lists topics in the master panel"
    // test for the same reason.
    expect(await screen.findByText("Jefatura de Gabinete")).toBeInTheDocument();
    expect(
      await screen.findByText("Secretaría de Cultura (SECA)"),
    ).toBeInTheDocument();
  });

  it("shows an empty detail panel until a node is selected", () => {
    renderWithClient(<OrganigramScreen />);
    expect(screen.getByText("organigram.detail.empty")).toBeInTheDocument();
  });

  it("shows the selected unit's is_sector toggle and current holder", async () => {
    renderWithClient(<OrganigramScreen />);

    fireEvent.click(await screen.findByText("Secretaría de Cultura (SECA)"));

    expect(
      await screen.findByLabelText("organigram.detail.isSectorLabel"),
    ).toBeChecked();
    expect(await screen.findByText("María Pérez")).toBeInTheDocument();
  });

  it("marks a node as a sector via the is_sector toggle", async () => {
    renderWithClient(<OrganigramScreen />);

    fireEvent.click(await screen.findByText("Jefatura de Gabinete"));
    const toggle = await screen.findByLabelText(
      "organigram.detail.isSectorLabel",
    );
    fireEvent.click(toggle);

    // react-query v5's `mutate()` dispatches the mutationFn asynchronously (a
    // microtask beyond the synchronous event-handler tick — see
    // taxonomy-screen.test.tsx's identical note), and it always calls
    // `mutationFn` with a second `MutationFunctionContext` argument alongside
    // the variables — `expect.anything()` tolerates that without caring about
    // its exact shape, which isn't this screen's concern.
    await waitFor(() => {
      expect(updateUnitMock).toHaveBeenCalledWith(
        { id: "jg", is_sector: true },
        expect.anything(),
      );
    });
  });

  it("adds a new current holder, inserting rather than overwriting", async () => {
    renderWithClient(<OrganigramScreen />);

    fireEvent.click(await screen.findByText("Secretaría de Cultura (SECA)"));
    fireEvent.change(
      await screen.findByLabelText("organigram.detail.newHolderNameLabel"),
      {
        target: { value: "Juan Gómez" },
      },
    );
    fireEvent.click(screen.getByText("organigram.detail.newHolderAction"));

    await waitFor(() => {
      expect(addHolderMock).toHaveBeenCalledWith(
        { unit_id: "seca", name: "Juan Gómez" },
        expect.anything(),
      );
    });
  });
});
