import { redirect } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./organigram";

// Same pattern as `routes/home/host.test.tsx` — no actual overrides, just
// the real module re-exported through `importOriginal`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
}));

describe("/home/settings/organigram — ADR-0007 flag-gated redirect", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("redirects to /home/settings/server when the Defensoría flag is off", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "false");

    expect(() => Route.options.beforeLoad?.({} as never)).toThrow();

    try {
      Route.options.beforeLoad?.({} as never);
    } catch (thrown) {
      expect(thrown).toEqual(redirect({ to: "/home/settings/server" }));
    }
  });

  it("does not redirect when the Defensoría flag is on", () => {
    vi.stubEnv("VITE_DEFENSORIA_ENABLED", "true");

    expect(() => Route.options.beforeLoad?.({} as never)).not.toThrow();
  });
});
