import { PageTitle } from "@aymurai/ui";
import { useTranslation } from "react-i18next";
import { Stack } from "@/styled/jsx";
import SettingsNav from "./settings-nav";

/**
 * Page title + tab row, shared by the Configuración screens. `SettingsNav`
 * renders nothing when the Defensoría flag is off (a single screen has nothing
 * to navigate between), leaving just the title.
 */
export default function SettingsHeader() {
  const { t } = useTranslation("settings");

  return (
    <Stack gap="4">
      <PageTitle>{t("title")}</PageTitle>
      <SettingsNav />
    </Stack>
  );
}
