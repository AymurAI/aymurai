import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import type { RecommendationRow } from "@/types/dataExtraction";

// The real route tree and the real grilla/correction components: the point is
// the round trip through the router itself — the Editar link carrying the
// grilla's URL search in, and the correction screen handing it back out.
// Only the edges are stubbed (network, auth gate, chrome).

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/features/APIProtected", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));
vi.mock("@/components/layout/footer", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <footer>{children}</footer>
  ),
}));

const ROW: RecommendationRow = {
  id: "r1",
  document_id: "d1",
  recommendation_number: "REC-001",
  recommendation_date_text: null,
  recommendation_date: "2026-01-20",
  topic: "Salud",
  subtopic: null,
  personal_data: false,
  publishable_content: "contenido",
  recipients: [],
  file_number: null,
  recommendation_detail: null,
  recommendation_situation: null,
  status: null,
  approved_for_publication: null,
  link: null,
  created_at: "2026-01-01T09:00:00",
  updated_at: null,
};

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));

vi.mock("@/services/aymurai/dataExtraction", () => ({
  recommendationsList: (params: unknown) => ({
    queryKey: ["recommendations-list", params],
    queryFn: () => mockList(params),
  }),
  recommendationEnums: () => ({
    queryKey: ["recommendation-enums"],
    queryFn: async () => ({ situations: [], statuses: [] }),
  }),
  patchRecommendationSeguimiento: () => ({ mutationFn: vi.fn() }),
  // The detail failing to load is the shortest path to the correction
  // screen's own way back — the same `goBack` its Cancelar and Guardar use.
  recommendationDetail: (id: string) => ({
    queryKey: ["recommendation-detail", id],
    queryFn: async () => {
      throw new Error("offline");
    },
  }),
  correctRecommendation: () => ({ mutationFn: vi.fn() }),
}));
vi.mock("@/services/aymurai/catalogs", () => ({
  listTopics: () => ({ queryKey: ["topics"], queryFn: async () => [] }),
  listSubtopics: () => ({ queryKey: ["subtopics"], queryFn: async () => [] }),
  listMacroSectors: () => ({
    queryKey: ["macro-sectors"],
    queryFn: async () => [],
  }),
}));
vi.mock("@/services/aymurai/organigram", () => ({
  listUnits: () => ({ queryKey: ["units"], queryFn: async () => [] }),
}));
vi.mock("@/services/export/use-export-recommendations", () => ({
  useExportRecommendations: () => ({
    download: vi.fn(),
    isPending: false,
    isError: false,
  }),
}));

const TOPIC = "8f14e45f-ceea-4e7a-9b1c-2d3e4f5a6b7c";

const GRID_SEARCH = {
  topicId: TOPIC,
  status: "Cerrada",
  page: 2,
  orderBy: "recommendation_number",
  orderDir: "asc",
  view: "recipients",
} as const;

function renderAt(search: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ["/home/dataset"] }),
  });
  return { queryClient, router, search };
}

describe("grilla → corrección → grilla", () => {
  it("comes back to the same filters, sort, page and tab", async () => {
    mockList.mockResolvedValue({ items: [ROW], total: 45 });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createRouter({
      routeTree,
      context: { queryClient },
      history: createMemoryHistory({ initialEntries: ["/home/dataset"] }),
    });
    await act(() =>
      router.navigate({ to: "/home/dataset", search: GRID_SEARCH }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    const expectedListParams = expect.objectContaining({
      topicId: TOPIC,
      status: "Cerrada",
      page: 2,
      orderBy: "recommendation_number",
      orderDir: "asc",
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expectedListParams),
    );

    fireEvent.click(
      await screen.findByRole("link", { name: "grilla.columns.edit" }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/home/dataset/r1"),
    );
    expect(router.state.location.search).toEqual(GRID_SEARCH);

    mockList.mockClear();
    fireEvent.click(
      await screen.findByRole("button", { name: "correction.back" }),
    );

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/home/dataset"),
    );
    expect(router.state.location.search).toEqual(GRID_SEARCH);
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(expectedListParams),
    );
    expect(
      await screen.findByRole("tab", { name: "grilla.tabs.recipients" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("never sends a malformed URL value on to the list request", async () => {
    mockList.mockResolvedValue({ items: [ROW], total: 45 });
    const { queryClient, router } = renderAt({});
    await act(() =>
      router.navigate({
        to: "/home/dataset",
        search: {
          topicId: "t1",
          editedFrom: "ayer",
          recipientSector: "sector:s1",
          status: "Cerrada",
        } as never,
      }),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const params = mockList.mock.lastCall?.[0];
    expect(params).toMatchObject({ status: "Cerrada" });
    expect(params.topicId).toBeUndefined();
    expect(params.editedFrom).toBeUndefined();
    expect(params.sectorId).toBeUndefined();
  });
});
