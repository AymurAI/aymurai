import { createFileRoute, redirect } from "@tanstack/react-router";
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
        <div>
          organigram placeholder — replaced by OrganigramScreen in Task 7
        </div>
      </HomeLayout>
    </APIProtected>
  );
}
