import { createFileRoute } from "@tanstack/react-router";
import ServerScreen from "@/components/settings/server-screen";
import SettingsHeader from "@/components/settings/settings-header";
import HomeLayout from "@/layout/home";

export const Route = createFileRoute("/home/settings/server")({
  component: RouteComponent,
});

function RouteComponent() {
  // Deliberately not `APIProtected`, unlike its two sibling tabs: this is the
  // screen a user reaches with no server configured at all.
  return (
    <HomeLayout variant="wide">
      <SettingsHeader />
      <ServerScreen />
    </HomeLayout>
  );
}
