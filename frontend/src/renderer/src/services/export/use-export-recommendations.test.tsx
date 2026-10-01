import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import api from "@/services/api";
import { downloadBlob } from "./download-blob";
import { useExportRecommendations } from "./use-export-recommendations";

vi.mock("@/constants/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/config")>()),
  USE_MOCK_DATA_EXTRACTION: false,
}));
vi.mock("./download-blob", () => ({ downloadBlob: vi.fn() }));

function renderExporter() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(useExportRecommendations, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

const response = {
  data: new Blob(["workbook"]),
  headers: {
    "content-disposition":
      'attachment; filename="recomendaciones_20260928120000.xlsx"',
  },
};

describe("recommendation export lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(downloadBlob).mockReset();
  });

  it("stays pending while downloading and preserves the server filename", async () => {
    let resolveRequest!: (value: typeof response) => void;
    const get = vi.spyOn(api, "get").mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { result } = renderExporter();
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.download();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(downloadBlob).not.toHaveBeenCalled();
    await act(async () => {
      resolveRequest(response);
      await pending;
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(get).toHaveBeenCalledWith("/llm/data-extraction/export", {
      params: { format: "xlsx" },
      responseType: "blob",
    });
    expect(downloadBlob).toHaveBeenCalledWith(
      response.data,
      "recomendaciones_20260928120000.xlsx",
    );
  });

  it("clears a failed request on retry and completes the download", async () => {
    let resolveRetry!: (value: typeof response) => void;
    vi.spyOn(api, "get")
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRetry = resolve;
        }),
      );
    const { result } = renderExporter();
    await act(async () => {
      await result.current.download();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(downloadBlob).not.toHaveBeenCalled();
    let retry!: Promise<void>;
    act(() => {
      retry = result.current.download();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.isError).toBe(false);
    await act(async () => {
      resolveRetry(response);
      await retry;
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.isError).toBe(false);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("reports a browser download failure even after the server succeeds", async () => {
    vi.spyOn(api, "get").mockResolvedValue(response);
    vi.mocked(downloadBlob).mockImplementationOnce(() => {
      throw new Error("browser download failed");
    });
    const { result } = renderExporter();
    await act(async () => {
      await result.current.download();
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });
});
