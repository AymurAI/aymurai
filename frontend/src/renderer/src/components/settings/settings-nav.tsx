import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { isDefensoriaEnabled } from "@/constants/config";
import { css } from "@/styled/css";
import { HStack } from "@/styled/jsx";

// Styled as `Button variant="tertiary"`, with the active tab carrying the
// library's own `checked` treatment (solid `action.pressed` + white label).
// The styles live on the `Link` itself rather than wrapping a `Button` inside
// it, so there is no button nested in an anchor.
const tab = css({
  display: "flex",
  alignItems: "center",
  h: "8",
  px: "4",
  py: "2",
  borderRadius: "sm",
  textStyle: "cta.md.strong",
  color: "text.onbutton-default",
  bg: "[transparent]",
  textDecoration: "none",
  transition: "[background-color 300ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "bg.primary-alternative" },
  _focusVisible: { outline: "[2px solid token(colors.text.default)]" },
});

const activeTab = css({
  bg: "action.pressed",
  color: "text.onbutton-alternative",
  _hover: { bg: "action.pressed" },
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
        <Link
          key={link.key}
          to={link.to}
          className={tab}
          activeProps={{ className: activeTab }}
        >
          {t(`nav.${link.key}`)}
        </Link>
      ))}
    </HStack>
  );
}
