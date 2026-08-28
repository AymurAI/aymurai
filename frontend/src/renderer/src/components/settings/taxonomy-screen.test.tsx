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

const createTopicMock = vi.fn();
const createSubtopicMock = vi.fn();

vi.mock("@/services/aymurai", () => ({
  catalogsService: {
    listTopics: () => ({ queryKey: ["topics"], queryFn: async () => topics }),
    listSubtopics: (topicId: string) => ({
      queryKey: ["subtopics", topicId],
      queryFn: async () => subtopicsByTopic[topicId] ?? [],
    }),
    createTopic: () => ({ mutationFn: createTopicMock }),
    updateTopic: () => ({ mutationFn: vi.fn() }),
    topicUsage: (id: string) => ({
      queryKey: ["usage", id],
      queryFn: async () => ({ count: 2 }),
    }),
    createSubtopic: () => ({ mutationFn: createSubtopicMock }),
    updateSubtopic: () => ({ mutationFn: vi.fn() }),
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

    await waitFor(() => {
      expect(
        screen.getByText("taxonomy.topics.usageWarning:2"),
      ).toBeInTheDocument();
    });
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
});
