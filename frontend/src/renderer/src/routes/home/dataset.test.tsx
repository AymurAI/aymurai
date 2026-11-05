import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { validateGridSearch } from "@/components/recommendations/recommendations-grid-search";
import { Route } from "./dataset";

// Same shape as `routes/home/features.test.tsx`: the route module is exercised
// on its own, so `createFileRoute` just hands its options straight back.
const { mockSearch, mockNavigate, gridProps } = vi.hoisted(() => ({
  mockSearch: { topicId: "t1", page: 2 },
  mockNavigate: vi.fn(),
  gridProps: [] as {
    search: unknown;
    onSearchChange: (search: unknown) => void;
  }[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({
    options,
    useSearch: () => mockSearch,
    useNavigate: () => mockNavigate,
  }),
  Navigate: () => <div data-testid="navigate-away" />,
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/api", () => ({
  default: { defaults: { baseURL: "http://localhost:8899" } },
}));

vi.mock("@/components/recommendations/recommendations-grid", () => ({
  default: (props: {
    search: unknown;
    onSearchChange: (search: unknown) => void;
  }) => {
    gridProps.push(props);
    return <div data-testid="recommendations-grid" />;
  },
}));

vi.mock("@/hooks/useConnectedHost", () => ({
  useConnectedHost: () => "http://localhost:8899",
}));

function renderRoute() {
  const RouteComponent = Route.options.component;
  if (!RouteComponent) throw new Error("/home/dataset has no component");
  return render(<RouteComponent />);
}

describe("/home/dataset — the grilla route", () => {
  it("mounts seguimiento with its own functional header", () => {
    const { container } = renderRoute();

    expect(screen.getByTestId("recommendations-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate-away")).not.toBeInTheDocument();
    expect(screen.getByText("grilla.headerTitle")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("bg_bg.primary-highlight");
  });

  // The Defensoría flag gates the *entry points* (Task 6), not the route --
  // the same criterion every other `/home/*` route follows.
  it("does not gate itself behind a feature flag", () => {
    expect(Route.options.beforeLoad).toBeUndefined();
  });

  // Filters, sort, page and tab live in the URL, so the trip to the
  // correction screen and back does not lose them.
  it("validates its search and hands it to the grilla, replacing on change", () => {
    renderRoute();

    expect(Route.options.validateSearch).toBe(validateGridSearch);
    expect(gridProps.at(-1)?.search).toBe(mockSearch);
    gridProps.at(-1)?.onSearchChange({ status: "Cerrada" });
    expect(mockNavigate).toHaveBeenCalledWith({
      search: { status: "Cerrada" },
      replace: true,
    });
  });
});
