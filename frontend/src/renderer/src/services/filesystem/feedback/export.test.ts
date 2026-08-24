import { beforeEach, describe, expect, it, vi } from "vitest";

const { downloadBlob } = vi.hoisted(() => ({ downloadBlob: vi.fn() }));
vi.mock("@/services/export/download-blob", () => ({ downloadBlob }));
vi.mock("./utils", () => ({ joinValidation: () => ({ ok: true }) }));

import exportFeedback from "./export";

const files = [
  { data: { name: "acta 1.docx" }, validationObject: [] },
] as never;

describe("feedback.export without the Electron bridge", () => {
  beforeEach(() => {
    downloadBlob.mockClear();
    // biome-ignore lint/performance/noDelete: restoring the browser shape
    delete (window as { filesystem?: unknown }).filesystem;
  });

  it("downloads one JSON per file instead of throwing", async () => {
    await exportFeedback(files);

    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = downloadBlob.mock.calls[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(name).toMatch(
      /^aymurai--acta_1--\d{4}-\d{2}-\d{2}-\d{2}_\d{2}_\d{2}\.json$/,
    );
  });
});
