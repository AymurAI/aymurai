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

// `FileProcessing` reaches for `useQueryClient`/`useFileDispatch` for its
// replace/stop affordances — irrelevant to this screen's own status/ticker
// logic, and no `QueryClientProvider` is set up here (matching
// `routes/$feature/process.test.tsx`'s same stub for the identical reason).
vi.mock("@/components", () => ({
  FileProcessing: ({
    fileName,
    status,
  }: {
    fileName: string;
    status: string;
  }) => <div data-testid={`file-status-${fileName}`}>{status}</div>,
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
  it("shows the elapsed-time ticker while the extraction is running, not before or after", () => {
    setStatus({ status: "extracting" });
    render(<RecommendationProcess />);
    expect(screen.getByText(/process.extracting/)).toBeInTheDocument();
  });

  it("does not show the ticker while only parsing/checking, or once ready", () => {
    setStatus({ status: "checking" });
    const { rerender } = render(<RecommendationProcess />);
    expect(screen.queryByText(/process.extracting/)).not.toBeInTheDocument();

    setStatus({ status: "ready" });
    rerender(<RecommendationProcess />);
    expect(screen.queryByText(/process.extracting/)).not.toBeInTheDocument();
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

  it("never shows Reintentar for the scanned-PDF terminal error", () => {
    setStatus({ status: "error", isScannedPdf: true });
    render(<RecommendationProcess />);

    expect(screen.getByText("process.noTextError")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "process.retry" }),
    ).not.toBeInTheDocument();
  });
});
