import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/home/host")({
  beforeLoad: () => {
    throw redirect({ to: "/home/settings/server" });
  },
});
