import { useTranslation } from "react-i18next";
import { APP_VERSION } from "@/constants/version";
import { Stack, styled } from "@/styled/jsx";
import BuiltBy from "./built-by";

interface AppCreditsProps {
  className?: string;
}

/**
 * The DataGénero credit with the install's version beneath it — the footer
 * block of the screens a user lands on, rather than works in. `Footer`'s own
 * `BuiltBy` stays bare: the version belongs where someone goes looking for it,
 * not on every step of every feature flow.
 */
export default function AppCredits({ className }: AppCreditsProps) {
  const { t } = useTranslation();

  return (
    <Stack align="center" gap="2" className={className}>
      <BuiltBy />
      {/* The git tag CI builds from, so a support conversation can start with
          a version the user can read off the screen. */}
      <styled.p textStyle="label.sm.default" color="text.lighter">
        {t("appVersion", { version: APP_VERSION.replace(/^v/, "") })}
      </styled.p>
    </Stack>
  );
}
