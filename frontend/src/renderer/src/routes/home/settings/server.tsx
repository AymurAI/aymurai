import { createFileRoute } from "@tanstack/react-router";
import ConnectToHost from "@/components/home/connect-to-host";
import SettingsNav from "@/components/settings/settings-nav";
import HomeLayout from "@/layout/home";
import { Stack } from "@/styled/jsx";

export const Route = createFileRoute("/home/settings/server")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <HomeLayout variant="narrow">
      <Stack align="center" gap="8">
        <SettingsNav />
        <ConnectToHost />
      </Stack>
    </HomeLayout>
  );
}
