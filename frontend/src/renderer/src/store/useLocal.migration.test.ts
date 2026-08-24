import { beforeEach, describe, expect, it, vi } from "vitest";

describe("local-storage persist migration", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it("strips a legacy /api suffix from a v0 payload", async () => {
    localStorage.setItem(
      "local-storage",
      JSON.stringify({
        state: { serverHost: "http://10.0.0.5:8899/api/", excludedWords: [] },
        version: 0,
      }),
    );

    const { useLocalStore } = await import("./useLocal");
    await useLocalStore.persist.rehydrate();

    expect(useLocalStore.getState().serverHost).toBe("http://10.0.0.5:8899");
  });

  it("leaves an already-normalized host alone", async () => {
    localStorage.setItem(
      "local-storage",
      JSON.stringify({
        state: { serverHost: "https://example.org", excludedWords: [] },
        version: 1,
      }),
    );

    const { useLocalStore } = await import("./useLocal");
    await useLocalStore.persist.rehydrate();

    expect(useLocalStore.getState().serverHost).toBe("https://example.org");
  });

  it("clears a stored host that no longer parses rather than wedging boot", async () => {
    localStorage.setItem(
      "local-storage",
      JSON.stringify({ state: { serverHost: "http://" }, version: 0 }),
    );

    const { useLocalStore } = await import("./useLocal");
    await useLocalStore.persist.rehydrate();

    expect(useLocalStore.getState().serverHost).toBeNull();
  });
});
