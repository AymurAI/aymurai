import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeaturesMenu from "./features-menu";

const dispatch = vi.fn();
vi.mock("@/hooks/useFiles", () => ({
  useFileDispatch: () => dispatch,
}));

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("react-i18next", () => ({
  useTranslation: (namespace?: string) => ({
    t: (key: string, options?: { ns?: string }) =>
      `${options?.ns ?? namespace ?? "common"}:${key}`,
  }),
}));

describe("FeaturesMenu", () => {
  beforeEach(() => {
    dispatch.mockClear();
    navigate.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("clears files and navigates to the selected feature only after the navigation resolves", async () => {
    // The "dataset:title" slot routes to Dataset or Recommendations
    // depending on the flag (see the "recommendations replaces Set de
    // Datos" describe block below) -- stub it off so this test's target
    // doesn't silently depend on the ambient VITE_DEFENSORIA_ENABLED env
    // var (e.g. a developer's local frontend/.env).
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    let resolveNavigate: () => void = () => {};
    navigate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveNavigate = resolve;
        }),
    );

    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    fireEvent.click(screen.getByText("dataset:title"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/$feature/onboarding",
      params: { feature: "DATA_SET" },
      viewTransition: false,
    });
    expect(dispatch).not.toHaveBeenCalled();

    resolveNavigate();

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  });

  it("navigates to /home/settings/server and clears files only after the navigation resolves", async () => {
    let resolveNavigate: () => void = () => {};
    navigate.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveNavigate = resolve;
        }),
    );

    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    fireEvent.click(screen.getByText("common:settings"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/home/settings/server",
      viewTransition: false,
    });
    expect(dispatch).not.toHaveBeenCalled();

    resolveNavigate();

    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  });
});

describe("FeaturesMenu — Summarizer", () => {
  beforeEach(() => {
    dispatch.mockClear();
    navigate.mockClear();
  });

  it("navigates to the Summarizer flow with the short label and clears files on click", async () => {
    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    fireEvent.click(screen.getByText("common:featuresMenu.summary"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/$feature/onboarding",
      params: { feature: "SUMMARIZER" },
      viewTransition: false,
    });
    await waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  });

  it("does not render the full Summarizer title in the menu", () => {
    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    expect(screen.queryByText("summarizer:title")).toBeNull();
  });
});

describe("FeaturesMenu — recommendations replaces Set de Datos", () => {
  beforeEach(() => {
    dispatch.mockClear();
    navigate.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists Set de Datos linking to Dataset when the flag is off", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    fireEvent.click(screen.getByText("dataset:title"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/$feature/onboarding",
      params: { feature: "DATA_SET" },
      viewTransition: false,
    });
  });

  it("keeps the Set de Datos label but routes to Recommendations when the flag is on", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");
    render(<FeaturesMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Ir al inicio" }));
    fireEvent.click(screen.getByText("dataset:title"));

    expect(navigate).toHaveBeenCalledWith({
      to: "/$feature/onboarding",
      params: { feature: "RECOMMENDATIONS" },
      viewTransition: false,
    });
    expect(screen.queryByText("recommendations:title")).toBeNull();
  });

  it("keeps Set de Datos in the first grid slot whichever feature it routes to", () => {
    for (const flag of ["false", "true"]) {
      vi.stubEnv("VITE_DEFENSORIA_ENABLED", flag);
      const { unmount } = render(<FeaturesMenu />);
      const trigger = screen.getByRole("button", { name: "Ir al inicio" });
      fireEvent.click(trigger);

      const [firstItem] = screen
        .getAllByRole("button")
        .filter((button) => button !== trigger);
      expect(firstItem).toHaveTextContent("dataset:title");

      unmount();
      vi.unstubAllEnvs();
    }
  });
});
