import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Route } from "./server";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to: _to, children }: { to: string; children: React.ReactNode }) =>
    children,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/services/aymurai", () => ({
  useConnectToHost: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  serverService: {
    healthcheck: () => ({
      queryKey: ["server-healthcheck", undefined],
      queryFn: async () => ({ status: "ok" }),
      enabled: false,
      retry: false,
    }),
  },
}));

// No saved host: the first-run state, which is the one this route has to serve
// without `APIProtected` — and the one where `HomeLayout` leaves the header
// off, since there is no app to go back to yet.
vi.mock("@/store/useLocal", () => ({
  useServerHost: () => null,
  useServerHostActions: () => ({ setServerHost: vi.fn() }),
  getServerHost: () => null,
}));

vi.mock("@/services/api", () => ({
  default: { defaults: { baseURL: undefined } },
  getApiBaseUrl: () => undefined,
}));

function renderRoute() {
  const RouteComponent = Route.options.component;
  if (!RouteComponent) throw new Error("Server route has no component");

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RouteComponent />
    </QueryClientProvider>,
  );
}

describe("/home/settings/server — unified server screen", () => {
  it("shows the server-address form directly, with no Local/Servidor choice", () => {
    renderRoute();

    expect(
      screen.getByText("home.host.connectServerExplanation"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "home.host.connectServerSubmit" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/¿Cómo deseas conectarte/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("carries the same Configuración title as the other two tabs", () => {
    renderRoute();

    // The tab row itself is `SettingsNav`'s business and renders nothing while
    // the Defensoría flag is off (one screen has nothing to navigate between);
    // the title is what makes this look like the same Configuración page.
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("leaves the app header off while no server is configured", () => {
    renderRoute();

    expect(screen.queryByAltText("AymurAI")).not.toBeInTheDocument();
  });
});
