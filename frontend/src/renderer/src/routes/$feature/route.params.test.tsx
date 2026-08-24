import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";
import { FeatureFlowEnum } from "@/types/features";

// The root route is created with `createRootRouteWithContext<RouterContext>`
// (RouterContext = { queryClient }), so `createRouter` requires a context
// even though nothing in this test touches react-query.
const context = { queryClient: new QueryClient() };

// This is the one assumption in this task worth pinning down: that a
// `params.parse`/`stringify` pair declared on the "/$feature" layout route is
// applied when TanStack builds links/matches for its *children*
// ("/$feature/onboarding" etc), so no call site ever converts the enum to a
// slug itself.
//
// `router.buildLocation` is the exact function `<Link>` delegates to
// internally to compute `href` (see RouterProvider/useLinkProps in
// @tanstack/react-router) — asserting on it directly is equivalent to
// asserting on a rendered `<Link>`'s href, without needing to mount a full
// page. A full-DOM version was tried first and abandoned: every real matched
// route (e.g. "/home/features") supplies its own `component`, so it can't
// host an injected probe `<Link>` via `defaultComponent`/
// `defaultNotFoundComponent`, and "/$feature" itself greedily matches any
// single (or even multi-segment, via TanStack's not-found bubbling) path that
// doesn't hit an existing static route, running its own `parse` and
// redirecting to "/home/features" before a probe component ever mounts.
function buildHref(feature: FeatureFlowEnum) {
  const router = createRouter({
    routeTree,
    context,
    history: createMemoryHistory({ initialEntries: ["/home/features"] }),
  });
  return router.buildLocation({
    to: "/$feature/onboarding",
    params: { feature },
  }).href;
}

describe("$feature params mapping", () => {
  it("stringifies the enum to a slug in generated hrefs", () => {
    expect(buildHref(FeatureFlowEnum.Dataset)).toBe("/dataset/onboarding");
  });

  it("parses a slug from the URL back to the enum", async () => {
    const router = createRouter({
      routeTree,
      context,
      history: createMemoryHistory({
        initialEntries: ["/voice-to-text/onboarding"],
      }),
    });
    await router.load();
    expect(router.state.matches.at(-1)?.params).toMatchObject({
      feature: FeatureFlowEnum.VoiceToText,
    });
  });
});
