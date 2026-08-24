import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The baseURL is resolved once at module evaluation, so each case needs a fresh
// module registry.
describe("api — initial baseURL", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/store/useLocal");
  });

  it("defaults to the page origin plus /api in the web app", async () => {
    vi.stubEnv("VITE_APP_MODE", "web");
    vi.doMock("@/store/useLocal", () => ({ getServerHost: () => null }));

    const { default: api } = await import("./api");

    expect(api.defaults.baseURL).toBe(`${window.location.origin}/api`);
  });

  it("prefers a persisted host over the page origin", async () => {
    vi.stubEnv("VITE_APP_MODE", "web");
    vi.doMock("@/store/useLocal", () => ({
      getServerHost: () => "https://custom.example.com",
    }));

    const { default: api } = await import("./api");

    expect(api.defaults.baseURL).toBe("https://custom.example.com/api");
  });

  it("normalizes a persisted 1.x host that already ends in /api", async () => {
    vi.stubEnv("VITE_APP_MODE", "electron");
    vi.doMock("@/store/useLocal", () => ({
      getServerHost: () => "http://10.0.0.5:8899/api/",
    }));

    const { default: api } = await import("./api");

    expect(api.defaults.baseURL).toBe("http://10.0.0.5:8899/api");
  });

  // This is the D2 regression. A packaged Electron renderer loads from file://,
  // where window.location.origin is the literal string "null" — the old code
  // passed that straight to new URL(), which throws during module evaluation and
  // blanks the app before any error boundary mounts. The fix is the `isWebApp()`
  // guard, so asserting the desktop branch never touches the origin *is* the
  // regression test. jsdom 25 makes window.location non-configurable, so the
  // opaque-origin string itself is covered purely by isUsableOrigin's own tests
  // in api-base-url.test.ts rather than by patching the global here.
  it("leaves baseURL unset in the desktop app with nothing stored", async () => {
    vi.stubEnv("VITE_APP_MODE", "electron");
    vi.doMock("@/store/useLocal", () => ({ getServerHost: () => null }));

    const { default: api } = await import("./api");

    expect(api.defaults.baseURL).toBeUndefined();
  });

  it("ignores a persisted host that no longer parses", async () => {
    vi.stubEnv("VITE_APP_MODE", "electron");
    vi.doMock("@/store/useLocal", () => ({ getServerHost: () => "http://" }));

    const { default: api } = await import("./api");

    expect(api.defaults.baseURL).toBeUndefined();
  });
});

describe("apiUrl", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("joins a relative path onto the resolved base", async () => {
    vi.stubEnv("VITE_APP_MODE", "web");
    vi.doMock("@/store/useLocal", () => ({
      getServerHost: () => "https://example.org",
    }));

    const { apiUrl } = await import("./api");

    expect(apiUrl("/asr/transcribe/stream")).toBe(
      "https://example.org/api/asr/transcribe/stream",
    );
  });

  it("throws a user-facing error when no server is selected", async () => {
    vi.stubEnv("VITE_APP_MODE", "electron");
    vi.doMock("@/store/useLocal", () => ({ getServerHost: () => null }));

    const { apiUrl } = await import("./api");

    expect(() => apiUrl("/llm/summarize/stream")).toThrow(/No server selected/);
  });
});
