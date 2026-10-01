import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./features";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({
    options: opts,
  }),
  Link: ({
    to,
    params = {},
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
    // Simple template substitution: /$feature + { feature: "SUMMARIZER" } => /SUMMARIZER
    let href = to;
    if (params && to.includes("$")) {
      Object.entries(params).forEach(([key, value]) => {
        href = href.replace(`$${key}`, String(value));
      });
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  Navigate: () => null,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/services/api", () => ({
  default: {
    defaults: {
      baseURL: "http://localhost:3000",
    },
  },
}));

describe("home/features — Summarizer card", () => {
  it("renders the Summarizer card as an enabled link to /SUMMARIZER", () => {
    const RouteComponent = Route.options.component as React.FC;
    render(<RouteComponent />);

    const link = screen.getByText("summarizer:title").closest("a");
    expect(link).toHaveAttribute("href", expect.stringContaining("SUMMARIZER"));
  });

  it("sizes the outer Stack with viewport-safe units, not 100vw/100vh", () => {
    const RouteComponent = Route.options.component as React.FC;
    const { container } = render(<RouteComponent />);

    const stack = container.firstElementChild;
    expect(stack?.className).toContain("w_full");
    expect(stack?.className).toContain("h_[100dvh]");
    expect(stack?.className).not.toContain("w_screen");
    expect(stack?.className).not.toContain("h_screen");
  });
});

describe("recommendations feature replaces Set de Datos card", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows Set de Datos linking to Dataset when the flag is off", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    const RouteComponent = Route.options.component as React.FC;
    render(<RouteComponent />);

    const link = screen.getByText("dataset:title").closest("a");
    expect(link).toHaveAttribute("href", expect.stringContaining("DATA_SET"));
    expect(screen.queryByText("recommendations:title")).not.toBeInTheDocument();
    expect(screen.getByText("dataset:subtitle")).toBeInTheDocument();
  });

  it("keeps the Set de Datos name but routes to Recommendations when the flag is on", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");
    const RouteComponent = Route.options.component as React.FC;
    render(<RouteComponent />);

    const link = screen.getByText("dataset:title").closest("a");
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("RECOMMENDATIONS"),
    );
    expect(screen.queryByText("recommendations:title")).not.toBeInTheDocument();
    expect(screen.queryByText("dataset:subtitle")).not.toBeInTheDocument();
    expect(screen.getByText("recommendations:subtitle")).toBeInTheDocument();
  });
});

describe("home/features — grilla card", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not render the grilla card when the flag is off", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");
    const RouteComponent = Route.options.component as React.FC;
    render(<RouteComponent />);

    expect(
      screen.queryByText("recommendations:grilla.title"),
    ).not.toBeInTheDocument();
  });

  it("keeps seguimiento inside recommendations when the flag is on", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");
    const RouteComponent = Route.options.component as React.FC;
    render(<RouteComponent />);
    expect(
      screen.queryByText("recommendations:grilla.title"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("dataset:title").closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining("RECOMMENDATIONS"),
    );
  });
});
