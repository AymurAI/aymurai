import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { isDefensoriaEnabled } from "@/constants/config";
import { css } from "@/styled/css";
import { HStack } from "@/styled/jsx";

const tab = css({
  textStyle: "label.md.default",
  color: "text.default",
  px: "4",
  py: "2",
  borderRadius: "md",
  _hover: { bg: "bg.primary-highlight" },
});

const LINKS = [
  { to: "/home/settings/server", key: "server", requiresFlag: false },
  { to: "/home/settings/taxonomy", key: "taxonomy", requiresFlag: true },
  { to: "/home/settings/organigram", key: "organigram", requiresFlag: true },
] as const;

export default function SettingsNav() {
  const { t } = useTranslation("settings");
  const visible = LINKS.filter(
    (link) => !link.requiresFlag || isDefensoriaEnabled(),
  );

  // Nothing to navigate between when only "server" would show — matches
  // today's single-screen Configuración exactly when the Defensoría flag is off.
  if (visible.length < 2) return null;

  return (
    <HStack gap="2" data-testid="settings-nav">
      {visible.map((link) => (
        <Link key={link.key} to={link.to} className={tab}>
          {t(`nav.${link.key}`)}
        </Link>
      ))}
    </HStack>
  );
}
