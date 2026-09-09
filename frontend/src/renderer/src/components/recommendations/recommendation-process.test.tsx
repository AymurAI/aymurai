import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import RecommendationProcess from "./recommendation-process";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockFiles = [{ data: new File(["x"], "acta.pdf") }];
vi.mock("@/hooks", () => ({
  useFiles: () => mockFiles,
  useFileDispatch: () => vi.fn(),
}));

const retry = vi.fn();
const abort = vi.fn();
let mockExtraction: {
  status: string;
  origin: string | null;
  error: string | null;
  isScannedPdf: boolean;
  retry: typeof retry;
  abort: typeof abort;
};
vi.mock("@/hooks/useDataExtraction", () => ({
  useDataExtraction: () => mockExtraction,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Header/BackButton compose Radix `Link`/`createLink` from
// `@tanstack/react-router`, which needs a real router context — stub them
// like the sibling summarizer/voice-to-text process tests do.
vi.mock("@/components/layout/header", () => ({
  default: () => <header />,
}));
vi.mock("@/components/ui/back-button", () => ({
  default: () => <button type="button">back</button>,
}));

vi.mock("@/services/taskbar", () => ({
  default: { notify: vi.fn() },
}));

vi.mock("@/features/RequireFile", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function setStatus(overrides: Partial<typeof mockExtraction> = {}) {
  mockExtraction = {
    status: "processing",
    origin: null,
    error: null,
    isScannedPdf: false,
    retry,
    abort,
    ...overrides,
  };
}

describe("RecommendationProcess", () => {
  it("shows a spinner while extracting, not a checkmark", () => {
    setStatus({ status: "extracting" });
    render(<RecommendationProcess />);
    expect(
      screen.getByRole("button", { name: "process.stop" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("process.completedAria"),
    ).not.toBeInTheDocument();
  });

  it("shows the checkmark and hides Detener once ready", () => {
    setStatus({ status: "ready" });
    render(<RecommendationProcess />);
    expect(screen.getByLabelText("process.completedAria")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "process.stop" }),
    ).not.toBeInTheDocument();
  });

  it("Detener calls abort", () => {
    setStatus({ status: "checking" });
    render(<RecommendationProcess />);
    fireEvent.click(screen.getByRole("button", { name: "process.stop" }));
    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("shows the stored-inference callout only once ready from a cached extraction", () => {
    setStatus({ status: "ready", origin: "stored-inference" });
    render(<RecommendationProcess />);
    expect(
      screen.getByText("process.storedInference"),
    ).toBeInTheDocument();
  });

  it("does not show the stored-inference callout for a fresh extraction", () => {
    setStatus({ status: "ready", origin: "inference" });
    render(<RecommendationProcess />);
    expect(
      screen.queryByText("process.storedInference"),
    ).not.toBeInTheDocument();
  });

  it("does not show the stored-inference callout before the extraction is ready", () => {
    setStatus({ status: "checking", origin: "stored-inference" });
    render(<RecommendationProcess />);
    expect(
      screen.queryByText("process.storedInference"),
    ).not.toBeInTheDocument();
  });

  it("disables 'Siguiente' until the extraction is ready", () => {
    setStatus({ status: "extracting" });
    render(<RecommendationProcess />);
    expect(screen.getByRole("button", { name: "process.next" })).toBeDisabled();
  });

  it("enables 'Siguiente' once the extraction is ready", () => {
    setStatus({ status: "ready" });
    render(<RecommendationProcess />);
    expect(
      screen.getByRole("button", { name: "process.next" }),
    ).not.toBeDisabled();
  });

  it("Reintentar re-triggers the extraction on a plain error", () => {
    setStatus({ status: "error", isScannedPdf: false });
    render(<RecommendationProcess />);

    fireEvent.click(screen.getByRole("button", { name: "process.retry" }));

    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("process.errorText")).toBeInTheDocument();
  });

  it("Reintentar is offered and works after a manual Stop, with no error banner", () => {
    setStatus({ status: "stopped" });
    render(<RecommendationProcess />);

    // Stop is not an error: it must not use the error copy/banner.
    expect(screen.queryByText("process.errorText")).not.toBeInTheDocument();

    // `retry` is a shared module-level mock across this file's tests (not
    // cleared between them) -- reset it here so this assertion is about
    // THIS click, not however many other tests happened to run first.
    retry.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "process.retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("never shows Reintentar for the scanned-PDF terminal error", () => {
    setStatus({ status: "error", isScannedPdf: true });
    render(<RecommendationProcess />);

    expect(screen.getByText("process.noTextError")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "process.retry" }),
    ).not.toBeInTheDocument();
  });
});
