import { redirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./index";

// Same pattern as `routes/home/host.test.tsx` — no actual overrides, just
// the real module re-exported through `importOriginal`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
}));

describe("/home/settings/ — unconditional redirect stub", () => {
  it("redirects to /home/settings/server", () => {
    expect(() => Route.options.beforeLoad?.({} as never)).toThrow();

    try {
      Route.options.beforeLoad?.({} as never);
    } catch (thrown) {
      expect(thrown).toEqual(redirect({ to: "/home/settings/server" }));
    }
  });
});
