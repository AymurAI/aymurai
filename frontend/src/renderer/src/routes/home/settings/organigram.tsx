import { createFileRoute, redirect } from "@tanstack/react-router";
import OrganigramScreen from "@/components/settings/organigram-screen";
import SettingsNav from "@/components/settings/settings-nav";
import { isDefensoriaEnabled } from "@/constants/config";
import APIProtected from "@/features/APIProtected";
import HomeLayout from "@/layout/home";

export const Route = createFileRoute("/home/settings/organigram")({
  beforeLoad: () => {
    if (!isDefensoriaEnabled()) {
      throw redirect({ to: "/home/settings/server" });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <APIProtected>
      <HomeLayout variant="wide">
        <SettingsNav />
        <OrganigramScreen />
      </HomeLayout>
    </APIProtected>
  );
}
