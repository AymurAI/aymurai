import { createFileRoute } from "@tanstack/react-router";
import ConnectToHost from "@/components/home/connect-to-host";
import HomeLayout from "@/layout/home";

export const Route = createFileRoute("/home/host")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <HomeLayout>
      <ConnectToHost />
    </HomeLayout>
  );
}
