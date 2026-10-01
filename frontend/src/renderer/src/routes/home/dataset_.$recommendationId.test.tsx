import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "./dataset_.$recommendationId";

// Same shape as `routes/home/dataset.test.tsx`: the route module is exercised
// on its own, so `createFileRoute` just hands its options straight back. The
// `$recommendationId` segment is the only difference — `Route.useParams` is a
// real method on the object `createFileRoute` returns in the app, so the stub
// has to supply it too.
const mockParams = { recommendationId: "rec-1" };
const { routeIds } = vi.hoisted(() => ({ routeIds: [] as string[] }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: (id: string) => {
    routeIds.push(id);
    return (options: unknown) => ({
      options,
      useParams: () => mockParams,
    });
  },
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

vi.mock("@/components/recommendations/recommendation-correction", () => ({
  default: ({ recommendationId }: { recommendationId: string }) => (
    <div data-testid="recommendation-correction">{recommendationId}</div>
  ),
}));

vi.mock("@/hooks/useConnectedHost", () => ({
  useConnectedHost: () => "http://localhost:8899",
}));

/**
 * `HomeLayout` is mocked purely to capture the props it was handed. The
 * `variant` is what this route has to get right, and asserting it at the prop
 * seam is what keeps the test from depending on the Panda class name the
 * variant happens to compile to today — a restyle would break that assertion
 * with a failure that says nothing about the layout choice.
 */
const { homeLayoutProps } = vi.hoisted(() => ({
  homeLayoutProps: [] as { variant?: string }[],
}));
vi.mock("@/layout/home", () => ({
  default: (props: { variant?: string; children: React.ReactNode }) => {
    homeLayoutProps.push({ variant: props.variant });
    return <div data-testid="home-layout">{props.children}</div>;
  },
}));

function renderRoute() {
  const RouteComponent = Route.options.component;
  if (!RouteComponent) {
    throw new Error("/home/dataset/$recommendationId has no component");
  }
  return render(<RouteComponent />);
}

describe("/home/dataset/$recommendationId — the correction route", () => {
  beforeEach(() => {
    homeLayoutProps.length = 0;
  });

  it("passes the id from the URL down to the correction screen", () => {
    renderRoute();

    expect(screen.getByTestId("recommendation-correction")).toHaveTextContent(
      "rec-1",
    );
    expect(screen.queryByTestId("navigate-away")).not.toBeInTheDocument();
    expect(screen.queryByTestId("home-layout")).not.toBeInTheDocument();
    expect(homeLayoutProps).toEqual([]);
  });

  // Same criterion as `/home/dataset`: the Defensoría flag gates the entry
  // points into this screen, not the screen itself.
  it("does not gate itself behind a feature flag", () => {
    expect(Route.options.beforeLoad).toBeUndefined();
  });

  // The trailing `_` is what stops TanStack Router's flat routing from making
  // this a CHILD of `/home/dataset` — which renders the grilla and no
  // `<Outlet />`, so a nested child would never appear on screen at all. It
  // affects nesting only: the URL stays `/home/dataset/<id>` (see
  // `routeTree.gen.ts`, where this route's `path`/`fullPath` carry no `_`).
  it("opts out of nesting under the grilla route", () => {
    expect(routeIds).toEqual(["/home/dataset_/$recommendationId"]);
  });
});
