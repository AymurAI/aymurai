import { beforeEach, describe, expect, it, vi } from "vitest";

const { downloadBlob } = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("@/services/export/download-blob", () => ({ downloadBlob }));

import write from "./write";

const workbook = {
  xlsx: { writeBuffer: async () => new ArrayBuffer(8) },
} as never;

describe("excel.write without the Electron bridge", () => {
  beforeEach(() => {
    downloadBlob.mockClear();
    // biome-ignore lint/performance/noDelete: restoring the browser shape
    delete (window as { filesystem?: unknown }).filesystem;
  });

  it("downloads the workbook instead of throwing", async () => {
    await write(workbook);

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledWith(
      expect.any(Blob),
      "set_de_datos.xlsx",
    );
  });
});
