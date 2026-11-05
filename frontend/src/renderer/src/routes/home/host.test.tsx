import { redirect } from "@tanstack/react-router";
import { describe, expect, it, vi } from "vitest";
import { Route } from "./host";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
}));

describe("/home/host — redirect stub", () => {
  it("redirects to /home/settings/server", () => {
    expect(() => Route.options.beforeLoad?.({} as never)).toThrow();

    try {
      Route.options.beforeLoad?.({} as never);
    } catch (thrown) {
      expect(thrown).toEqual(redirect({ to: "/home/settings/server" }));
    }
  });
});
