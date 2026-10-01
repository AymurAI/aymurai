import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Route } from "./onboarding";

const state = vi.hoisted(() => ({ feature: "DATA_SET", tutorialSeen: true }));
const dispatch = vi.fn();
vi.mock("@/hooks", () => ({ useFileDispatch: () => dispatch }));

const navigate = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useParams: () => ({ feature: state.feature }),
  createFileRoute: () => (options: unknown) => ({ options }),
}));

vi.mock("@/store/useLocal", () => ({
  useTutorialSeen: () => state.tutorialSeen,
  useSetTutorialSeen: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ removeQueries: vi.fn() }),
}));

vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));
vi.mock("@/components/layout/main-content", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));
vi.mock("@/components/layout/footer", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <footer>{children}</footer>
  ),
}));
vi.mock("@/components/layout/file-selection-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

describe("Dataset onboarding — single file enforcement", () => {
  beforeEach(() => {
    dispatch.mockClear();
    navigate.mockClear();
  });

  it("clears any previous selection before adding the newly dropped file", () => {
    const RouteComponent = Route.options.component;
    if (!RouteComponent) throw new Error("Onboarding route has no component");
    render(<RouteComponent />);

    const dropZone = screen.getByRole("button", {
      name: /onboarding\.dropAreaTitle/,
    });
    const file = new File(["x"], "a.docx");
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({ type: "REMOVE_ALL_FILES" }),
    );
    expect(dispatch.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        type: "ADD",
        payload: { newFiles: [file] },
      }),
    );
  });
});

vi.mock("@/components/how-it-works", () => ({
  default: () => <div>Tutorial</div>,
}));

describe("Recommendations onboarding — seguimiento", () => {
  afterEach(() => {
    state.feature = "DATA_SET";
    state.tutorialSeen = true;
    vi.unstubAllEnvs();
  });
  it.each([false, true])(
    "opens seguimiento without loading a document (tutorial seen: %s)",
    (seen) => {
      state.feature = "RECOMMENDATIONS";
      state.tutorialSeen = seen;
      vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");
      const Component = Route.options.component;
      if (!Component) throw new Error("Onboarding route has no component");
      render(<Component />);
      fireEvent.click(
        screen.getByRole("button", { name: "finish.viewGrilla" }),
      );
      expect(navigate).toHaveBeenCalledWith({ to: "/home/dataset" });
    },
  );
  it("does not show seguimiento when disabled", () => {
    state.feature = "RECOMMENDATIONS";
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    const Component = Route.options.component;
    if (!Component) throw new Error("Onboarding route has no component");
    render(<Component />);
    expect(
      screen.queryByRole("button", { name: "finish.viewGrilla" }),
    ).not.toBeInTheDocument();
  });
});
