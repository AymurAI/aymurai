import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isUsableOrigin,
  normalizeServerHost,
  toApiBaseUrl,
} from "./api-base-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isUsableOrigin", () => {
  // A packaged Electron renderer loads from file://, and Chromium serializes
  // that opaque origin as the literal string "null". Feeding it to new URL()
  // throws. This guard is what keeps services/api.ts from crashing at import.
  it("rejects the opaque origin a file:// page reports", () => {
    expect(isUsableOrigin("null")).toBe(false);
    expect(isUsableOrigin("")).toBe(false);
  });

  it("accepts a real origin", () => {
    expect(isUsableOrigin("https://example.org")).toBe(true);
    expect(isUsableOrigin("http://localhost:8899")).toBe(true);
  });
});

describe("normalizeServerHost", () => {
  it("keeps a bare origin unchanged", () => {
    expect(normalizeServerHost("https://example.org")).toBe(
      "https://example.org",
    );
  });

  it("drops trailing slashes", () => {
    expect(normalizeServerHost("https://example.org/")).toBe(
      "https://example.org",
    );
    expect(normalizeServerHost("https://example.org///")).toBe(
      "https://example.org",
    );
  });

  // The 1.x desktop app required users to type the /api suffix. Those values
  // are already in localStorage; they must converge on the bare host.
  it("strips a trailing /api so stored 1.x values migrate cleanly", () => {
    expect(normalizeServerHost("https://example.org/api")).toBe(
      "https://example.org",
    );
    expect(normalizeServerHost("https://example.org/api/")).toBe(
      "https://example.org",
    );
  });

  it("does not strip a path that merely starts with api", () => {
    expect(normalizeServerHost("https://example.org/apiary")).toBe(
      "https://example.org/apiary",
    );
  });

  it("preserves a mount path and a non-default port", () => {
    expect(normalizeServerHost("https://example.org:8443/aymurai/api")).toBe(
      "https://example.org:8443/aymurai",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerHost("  https://example.org  ")).toBe(
      "https://example.org",
    );
  });

  it("assumes http:// for a scheme-less host in the desktop app", () => {
    vi.stubEnv("VITE_APP_MODE", "electron");
    expect(normalizeServerHost("192.168.1.20:8899")).toBe(
      "http://192.168.1.20:8899",
    );
  });

  it("rejects an empty or unparseable value", () => {
    expect(() => normalizeServerHost("")).toThrow(TypeError);
    expect(() => normalizeServerHost("   ")).toThrow(TypeError);
    expect(() => normalizeServerHost("http://")).toThrow(TypeError);
  });

  // A scheme-less value starting with "/" is a path, not a host. Prefixing it
  // with "scheme://" would produce three-plus slashes, which the WHATWG URL
  // parser reads as an authority — so it silently returns a garbage base URL
  // (e.g. just "http:") instead of throwing. Reject this class up front.
  it("rejects a scheme-less value that starts with a slash", () => {
    expect(() => normalizeServerHost("/api")).toThrow(TypeError);
    expect(() => normalizeServerHost("/settings")).toThrow(TypeError);
    expect(() => normalizeServerHost("//evil.com")).toThrow(TypeError);
  });
});

describe("toApiBaseUrl", () => {
  it("appends exactly one /api", () => {
    expect(toApiBaseUrl("https://example.org")).toBe("https://example.org/api");
  });

  it("is idempotent — never produces /api/api", () => {
    expect(toApiBaseUrl("https://example.org/api")).toBe(
      "https://example.org/api",
    );
    expect(toApiBaseUrl(toApiBaseUrl("https://example.org"))).toBe(
      "https://example.org/api",
    );
  });

  it("keeps the mount path ahead of /api", () => {
    expect(toApiBaseUrl("https://example.org/aymurai")).toBe(
      "https://example.org/aymurai/api",
    );
  });
});
