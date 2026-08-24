import { describe, expect, it, vi } from "vitest";

const { created, read } = vi.hoisted(() => ({
  created: { worksheets: [{ addRows: vi.fn() }] },
  read: vi.fn(),
}));
vi.mock("@/services/filesystem", () => ({
  default: {
    excel: { read, create: () => created, write: vi.fn() },
  },
}));

import offline from "./offline";

describe("offline submitValidations", () => {
  it("creates a workbook when the browser path returns one with no worksheets", async () => {
    read.mockResolvedValueOnce({ worksheets: [] });

    await offline([[{ name: "n", value: "v" }]] as never);

    expect(created.worksheets[0].addRows).toHaveBeenCalled();
  });
});
