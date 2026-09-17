import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RecommendationFinish from "./recommendation-finish";

// Real (but scoped) strings for the two keys the tests assert against by
// visible/accessible text, identity fallback for the rest -- same pattern
// `file-preview/index.test.tsx` uses, needed here because the brief's tests
// match the download button by a `/descargar/i` name rather than the raw key.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "finish.download")
        return "Descargar la base de recomendaciones";
      if (key === "finish.restart") return "Procesar otro documento";
      return key;
    },
  }),
}));

const mockFiles = [
  {
    data: new File(["x"], "acta.pdf"),
    paragraphs: [],
    selected: true,
    validationObject: {},
  },
];
vi.mock("@/hooks", () => ({ useFiles: () => mockFiles }));

const { mockDownload, mockDownloadBlob } = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockDownloadBlob: vi.fn(),
}));
vi.mock("@/services/aymurai/dataExtraction", () => ({
  downloadRecommendationsExport: () => ({ mutationFn: mockDownload }),
}));
vi.mock("@/services/export/download-blob", () => ({
  downloadBlob: mockDownloadBlob,
}));

function renderFinish(onRestart = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RecommendationFinish onRestart={onRestart} />
    </QueryClientProvider>,
  );
}

describe("RecommendationFinish", () => {
  beforeEach(() => {
    mockDownload.mockReset();
    mockDownload.mockResolvedValue(new Blob(["xlsx"]));
    mockDownloadBlob.mockClear();
    // biome-ignore lint/performance/noDelete: restoring the browser shape
    delete (window as { filesystem?: unknown }).filesystem;
  });

  it("downloads the export from the server", async () => {
    renderFinish();
    fireEvent.click(screen.getByRole("button", { name: /descargar/i }));
    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(mockDownload).toHaveBeenCalledWith("xlsx", expect.anything());
  });

  it("never writes a local workbook", async () => {
    // The local .xlsx is no longer the source of truth (ANALYSIS §C.2/§C.3).
    window.filesystem = {
      excel: { write: vi.fn() },
    } as unknown as Window["filesystem"];
    renderFinish();
    fireEvent.click(screen.getByRole("button", { name: /descargar/i }));
    await waitFor(() => expect(mockDownloadBlob).toHaveBeenCalled());
    expect(window.filesystem?.excel?.write).not.toHaveBeenCalled();
  });

  it("shows the validated file", () => {
    renderFinish();
    expect(screen.getByText("acta.pdf")).toBeInTheDocument();
  });

  it("calls onRestart when the restart action is clicked", () => {
    const onRestart = vi.fn();
    renderFinish(onRestart);
    fireEvent.click(
      screen.getByRole("button", { name: "Procesar otro documento" }),
    );
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("shows an error and lets the person retry when the download fails", async () => {
    mockDownload.mockRejectedValueOnce(new Error("500"));
    renderFinish();
    fireEvent.click(screen.getByRole("button", { name: /descargar/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: /descargar/i }),
    ).not.toBeDisabled();
  });
});
