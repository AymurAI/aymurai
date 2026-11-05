import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/home/settings/")({
  beforeLoad: () => {
    throw redirect({ to: "/home/settings/server" });
  },
});
