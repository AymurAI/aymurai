import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./dataset";

// Same shape as `routes/home/features.test.tsx`: the route module is exercised
// on its own, so `createFileRoute` just hands its options straight back.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
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
  default: () => <div data-testid="recommendations-grid" />,
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
});
