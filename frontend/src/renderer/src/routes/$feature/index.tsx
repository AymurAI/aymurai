import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$feature/")({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/$feature/onboarding",
      params: { feature: params.feature },
    });
  },
});
