import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaxonomyScreen from "./taxonomy-screen";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

const topics = [
  {
    id: "t1",
    code: "ACC",
    name: "Acceso a la justicia",
    active: true,
    order: 1,
    created_at: "x",
    updated_at: "x",
  },
  {
    id: "t2",
    code: "AMB",
    name: "Ambiente",
    active: true,
    order: 2,
    created_at: "x",
    updated_at: "x",
  },
];
const subtopicsByTopic: Record<string, unknown[]> = {
  t1: [
    {
      id: "s1",
      topic_id: "t1",
      code: "ACC1",
      name: "Patrocinio",
      active: true,
      order: 1,
      created_at: "x",
      updated_at: "x",
    },
  ],
  // Two entries specifically so the aria-label-uniqueness test below has a
  // real sibling-row scenario to exercise — t1's single-subtopic fixture is
  // left untouched since other tests assert an `order` computed from its
  // length.
  t2: [
    {
      id: "s2",
      topic_id: "t2",
      code: "AMB1",
      name: "Espacios verdes",
      active: true,
      order: 1,
      created_at: "x",
      updated_at: "x",
    },
    {
      id: "s3",
      topic_id: "t2",
      code: "AMB2",
      name: "Residuos",
      active: true,
      order: 2,
      created_at: "x",
      updated_at: "x",
    },
  ],
};

let deferTopicUsage = false;

const createTopicMock = vi.fn();
const createSubtopicMock = vi.fn();
const updateSubtopicMock = vi.fn();

const usageByTopic: Record<string, number> = { t1: 2, t2: 0 };
const usageBySubtopic: Record<string, number> = { s1: 2, s2: 5, s3: 0 };

// Held open so a test can assert the "still counting" state before resolving.
let resolveTopicUsage: ((value: { count: number }) => void) | null = null;

vi.mock("@/features/showToast", () => ({ showToast: vi.fn() }));

vi.mock("@/services/aymurai", () => ({
  catalogsService: {
    listTopics: () => ({ queryKey: ["topics"], queryFn: async () => topics }),
    listSubtopics: (topicId: string) => ({
      queryKey: ["subtopics", topicId],
      queryFn: async () => subtopicsByTopic[topicId] ?? [],
    }),
    createTopic: () => ({ mutationFn: createTopicMock }),
    updateTopic: () => ({ mutationFn: vi.fn() }),
    // Usage is fetched per id, on demand, when a dialog opens — the API has no
    // bulk endpoint.
    topicUsage: (id: string) => ({
      queryKey: ["topics", id, "usage"],
      queryFn: () =>
        new Promise<{ count: number }>((resolve) => {
          resolveTopicUsage = resolve;
          if (deferTopicUsage) return;
          resolve({ count: usageByTopic[id] ?? 0 });
        }),
    }),
    subtopicUsage: (id: string) => ({
      queryKey: ["subtopics", "usage", id],
      queryFn: async () => ({ count: usageBySubtopic[id] ?? 0 }),
    }),
    createSubtopic: () => ({ mutationFn: createSubtopicMock }),
    updateSubtopic: () => ({ mutationFn: updateSubtopicMock }),
    reassignSubtopic: () => ({ mutationFn: vi.fn() }),
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

describe("TaxonomyScreen — master-detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deferTopicUsage = false;
    resolveTopicUsage = null;
  });

  it("lists topics in the master panel", async () => {
    renderWithClient(<TaxonomyScreen />);

    expect(await screen.findByText("Acceso a la justicia")).toBeInTheDocument();
    expect(await screen.findByText("Ambiente")).toBeInTheDocument();
  });

  it("shows a topic's subtopics in the detail panel once selected", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));

    expect(await screen.findByText("Patrocinio")).toBeInTheDocument();
  });

  it("selects a topic via keyboard (Enter on its row), matching organigram-tree-node.tsx's pattern", async () => {
    renderWithClient(<TaxonomyScreen />);

    const row = (await screen.findByText("Ambiente")).closest(
      '[role="option"]',
    );
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("tabIndex", "0");

    fireEvent.keyDown(row as HTMLElement, { key: "Enter" });

    expect(await screen.findByText("Espacios verdes")).toBeInTheDocument();
  });

  it("does not select the row when Enter is pressed on its nested deactivate button", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    expect(await screen.findByText("Patrocinio")).toBeInTheDocument();

    // Enter on "Ambiente"'s deactivate button must not bubble up into its
    // row's onKeyDown and switch the detail panel away from "Acceso a la
    // justicia"'s subtopics — the button's own onKeyDown stops propagation,
    // same as its onClick already does for mouse clicks.
    fireEvent.keyDown(
      screen.getByLabelText("taxonomy.topics.deactivateAction: Ambiente"),
      { key: "Enter" },
    );

    expect(screen.getByText("Patrocinio")).toBeInTheDocument();
    expect(screen.queryByText("Espacios verdes")).not.toBeInTheDocument();
  });

  it("shows an empty state in the detail panel until a topic is selected", () => {
    renderWithClient(<TaxonomyScreen />);

    expect(screen.getByText("taxonomy.subtopics.empty")).toBeInTheDocument();
  });

  it("warns with the usage count before deactivating a topic", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    fireEvent.click(
      await screen.findByLabelText(
        "taxonomy.topics.deactivateAction: Acceso a la justicia",
      ),
    );

    // The count is already in the cache (it loads with the list), so the
    // warning renders without a second round-trip.
    expect(
      await screen.findByText("taxonomy.usageWarning:2"),
    ).toBeInTheDocument();
  });

  it("states that nothing references a topic instead of warning, when its usage is zero", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Ambiente"));
    fireEvent.click(
      await screen.findByLabelText(
        "taxonomy.topics.deactivateAction: Ambiente",
      ),
    );

    // An amber "0 registros usan…" warning would misrepresent a no-op.
    expect(
      await screen.findByText("taxonomy.usageWarningNone"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("taxonomy.usageWarning:0"),
    ).not.toBeInTheDocument();
  });

  it("blocks the topic confirm-deactivate button until the count arrives", async () => {
    deferTopicUsage = true;
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    fireEvent.click(
      await screen.findByLabelText(
        "taxonomy.topics.deactivateAction: Acceso a la justicia",
      ),
    );

    const confirmButton = await screen.findByText(
      "taxonomy.confirmDeactivate",
    );
    // Confirming before the count lands would defeat the confirmation.
    expect(confirmButton).toBeDisabled();
    expect(screen.getByText("taxonomy.usageLoading")).toBeInTheDocument();

    resolveTopicUsage?.({ count: 2 });

    await waitFor(() => {
      expect(confirmButton).not.toBeDisabled();
    });
    expect(screen.getByText("taxonomy.usageWarning:2")).toBeInTheDocument();
  });

  it("creates a new topic from the master panel's add form", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.change(
      await screen.findByLabelText("taxonomy.topics.nameLabel"),
      {
        target: { value: "Vivienda" },
      },
    );
    fireEvent.click(screen.getByText("taxonomy.topics.addAction"));

    // react-query v5's `mutate()` dispatches the mutationFn asynchronously
    // (a microtask beyond the synchronous event-handler tick, verified with
    // a minimal useMutation repro), so the call lands one tick after
    // fireEvent.click returns — `waitFor` is required here, matching the
    // async-settling pattern the usage-warning test above already uses.
    // The pinned react-query version also always calls `mutationFn` with a
    // second `MutationFunctionContext` argument (`{ client, meta,
    // mutationKey }`, see query-core's `MutationFunction` type) alongside
    // the variables — `expect.anything()` tolerates that without caring
    // about its exact shape, which isn't this screen's concern.
    await waitFor(() => {
      expect(createTopicMock).toHaveBeenCalledWith(
        { name: "Vivienda", code: null, order: 3 },
        expect.anything(),
      );
    });
  });

  it("creates a new subtopic under the selected topic from the detail panel's add form", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    fireEvent.change(
      await screen.findByLabelText("taxonomy.subtopics.nameLabel"),
      {
        target: { value: "Nuevo subtema" },
      },
    );
    fireEvent.click(screen.getByText("taxonomy.subtopics.addAction"));

    // Same async-mutation-dispatch and MutationFunctionContext note as the
    // topic-create test above.
    await waitFor(() => {
      expect(createSubtopicMock).toHaveBeenCalledWith(
        {
          topic_id: "t1",
          name: "Nuevo subtema",
          code: null,
          order: 2,
        },
        expect.anything(),
      );
    });
  });

  it("gives each subtopic's action buttons a unique aria-label when multiple subtopics render", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Ambiente"));

    expect(
      await screen.findByLabelText(
        "taxonomy.subtopics.deactivateAction: Espacios verdes",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("taxonomy.subtopics.deactivateAction: Residuos"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        "taxonomy.subtopics.reassignAction: Espacios verdes",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("taxonomy.subtopics.reassignAction: Residuos"),
    ).toBeInTheDocument();
  });

  it("asks for confirmation before deactivating a subtopic, without calling updateSubtopic yet", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    fireEvent.click(
      await screen.findByLabelText(
        "taxonomy.subtopics.deactivateAction: Patrocinio",
      ),
    );

    expect(
      await screen.findByText("taxonomy.subtopics.deactivateConfirmTitle"),
    ).toBeInTheDocument();
    expect(updateSubtopicMock).not.toHaveBeenCalled();
  });

  it("calls updateSubtopic once the deactivate confirmation dialog is confirmed", async () => {
    renderWithClient(<TaxonomyScreen />);

    fireEvent.click(await screen.findByText("Acceso a la justicia"));
    fireEvent.click(
      await screen.findByLabelText(
        "taxonomy.subtopics.deactivateAction: Patrocinio",
      ),
    );

    await screen.findByText("taxonomy.subtopics.deactivateConfirmTitle");
    // Confirm stays disabled until the subtopic's usage count resolves.
    const confirmButton = screen.getByText("taxonomy.confirmDeactivate");
    await waitFor(() => expect(confirmButton).not.toBeDisabled());
    fireEvent.click(confirmButton);

    // Same async-mutation-dispatch note as the topic/subtopic create tests
    // above — `mutate()` dispatches the mutationFn one tick later.
    await waitFor(() => {
      expect(updateSubtopicMock).toHaveBeenCalledWith(
        { id: "s1", active: false },
        expect.anything(),
      );
    });
  });
});
