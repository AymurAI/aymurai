import { createFileRoute, redirect } from "@tanstack/react-router";
import SettingsNav from "@/components/settings/settings-nav";
import TaxonomyScreen from "@/components/settings/taxonomy-screen";
import { isDefensoriaEnabled } from "@/constants/config";
import APIProtected from "@/features/APIProtected";
import HomeLayout from "@/layout/home";

export const Route = createFileRoute("/home/settings/taxonomy")({
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
        <TaxonomyScreen />
      </HomeLayout>
    </APIProtected>
  );
}
