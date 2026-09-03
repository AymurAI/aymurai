import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  type RenderResult,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConnectToHost from "./connect-to-host";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mutate = vi.fn();
let mockedError: Error | null = null;
vi.mock("@/services/aymurai", () => ({
  useConnectToHost: () => ({
    mutate,
    isPending: false,
    get error() {
      return mockedError;
    },
    reset: vi.fn(),
  }),
}));

vi.mock("@/features/showToast", () => ({ showToast: vi.fn() }));

vi.mock("@/store/useLocal", () => ({
  useServerHost: () => null,
  useServerHostActions: () => ({
    setServerHost: vi.fn(),
    clearServerHost: vi.fn(),
  }),
  getServerHost: () => null,
}));

vi.mock("@/services/api", () => ({
  default: { defaults: { baseURL: undefined } },
  getApiBaseUrl: () => undefined,
  resetApiBaseUrl: vi.fn(),
}));

// `ConnectToHost` clears the previous server's cached data on disconnect, so
// it needs a client in scope. Declared as a component so `rerender` can mount
// the same tree, provider included.
function Wrapped() {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ConnectToHost />
    </QueryClientProvider>
  );
}

function renderForm(): RenderResult {
  return render(<Wrapped />);
}

describe("ConnectToHost — default server address", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves the brand logo to the app header, rather than repeating it", () => {
    vi.stubEnv("VITE_APP_MODE", "web");

    renderForm();

    // The vertical logo used to sit above this form because the screen had no
    // chrome of its own. `HomeLayout` now carries the full-bleed `AppHeader`,
    // so a second logo here would be the same mark twice on one screen.
    expect(screen.queryByAltText("Logotipo AymurAI")).not.toBeInTheDocument();
  });

  it("prefills the field with the web app's own origin when no host is saved yet", () => {
    vi.stubEnv("VITE_APP_MODE", "web");

    renderForm();

    expect(screen.getByRole("textbox")).toHaveValue(window.location.origin);
  });

  it("leaves the field empty on desktop when no host is saved yet", () => {
    vi.stubEnv("VITE_APP_MODE", "electron");

    renderForm();

    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});

describe("ConnectToHost — error logging", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mutate.mockReset();
    mockedError = null;
  });

  it("logs the failure once via the mutation's onError, when the attempt actually fails", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = new Error("connection failed");
    mutate.mockImplementation(
      (_host: string, options?: { onError?: (err: Error) => void }) => {
        options?.onError?.(failure);
      },
    );

    renderForm();
    fireEvent.click(
      screen.getByRole("button", { name: "home.host.connectServerSubmit" }),
    );

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(failure);
  });

  it("does not log on render, even across repeated re-renders while an error is displayed", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mockedError = new Error("connection failed");

    const { rerender } = renderForm();
    rerender(<Wrapped />);
    rerender(<Wrapped />);

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
