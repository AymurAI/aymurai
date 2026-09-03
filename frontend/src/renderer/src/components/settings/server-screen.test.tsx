import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ServerScreen from "./server-screen";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const connectMock = vi.fn();
let healthcheckFails = false;

vi.mock("@/features/showToast", () => ({ showToast: vi.fn() }));

vi.mock("@/services/aymurai", () => ({
  useConnectToHost: () => ({
    mutate: connectMock,
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
  serverService: {
    healthcheck: () => ({
      queryKey: ["server-healthcheck", storedHost],
      queryFn: async () => {
        if (healthcheckFails) throw new Error("down");
        return { status: "ok" };
      },
      // Mirrors the real factory: no host, no probe.
      enabled: Boolean(storedHost),
      retry: false,
    }),
  },
}));

let storedHost: string | null = null;
const clearServerHostMock = vi.fn();

vi.mock("@/store/useLocal", () => ({
  useServerHost: () => storedHost,
  useServerHostActions: () => ({
    setServerHost: vi.fn(),
    clearServerHost: clearServerHostMock,
  }),
  getServerHost: () => storedHost,
}));

// `useConnectedHost` reads the live axios base URL, which the store mock above
// cannot reach — this keeps the two in step so the card and the buttons see
// the same connection the test set up.
vi.mock("@/services/api", () => ({
  default: { defaults: { baseURL: undefined } },
  getApiBaseUrl: () => (storedHost ? `${storedHost}/api` : undefined),
  resetApiBaseUrl: vi.fn(),
}));

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ServerScreen />
    </QueryClientProvider>,
  );
}

describe("ServerScreen — the Servidor tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storedHost = null;
    healthcheckFails = false;
  });

  it("shows the server-address form directly, with no Local/Servidor choice", () => {
    renderScreen();

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

  it("reports no saved server, and does not probe, before anything is connected", () => {
    renderScreen();

    expect(screen.getByTestId("connection-status")).toHaveAttribute(
      "data-state",
      "none",
    );
    expect(screen.getByText("server.status.noneDetail")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "server.disconnectAction" }),
    ).not.toBeInTheDocument();
  });

  it("names the connected server once the probe succeeds", async () => {
    storedHost = "https://aymurai.example.org";
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveAttribute(
        "data-state",
        "connected",
      ),
    );
    expect(screen.getByText("https://aymurai.example.org")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "server.reconnectSubmit" }),
    ).toBeInTheDocument();
  });

  it("reports a saved server that is not answering", async () => {
    storedHost = "https://aymurai.example.org";
    healthcheckFails = true;
    renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId("connection-status")).toHaveAttribute(
        "data-state",
        "error",
      ),
    );
    expect(screen.getByText("server.status.errorDetail")).toBeInTheDocument();
  });

  it("offers Desconectar only with a saved host, and clears it", async () => {
    storedHost = "https://aymurai.example.org";
    renderScreen();

    fireEvent.click(
      await screen.findByRole("button", { name: "server.disconnectAction" }),
    );

    expect(clearServerHostMock).toHaveBeenCalled();
  });
});
