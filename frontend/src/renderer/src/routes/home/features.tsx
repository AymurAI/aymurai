import { CardTool } from "@aymurai/ui";
import {
  createFileRoute,
  Link,
  type LinkComponentProps,
} from "@tanstack/react-router";
import type { Icon } from "phosphor-react";
import { useTranslation } from "react-i18next";
import AppCredits from "@/components/brand/app-credits";
import Header from "@/components/layout/header";
import MainContent from "@/components/layout/main-content";
import { FEATURE_ICON, isDefensoriaEnabled } from "@/constants/config";
import APIProtected from "@/features/APIProtected";
import { css, cx } from "@/styled/css";
import { Grid, Stack, styled } from "@/styled/jsx";
import { FeatureFlowEnum } from "@/types/features";

const featureCard = css({ minH: "[195px]" });

const cardLink = css({ display: "block", h: "full" });

interface FeatureCardLinkProps extends LinkComponentProps {
  title: string;
  subtitle: string;
  icon: Icon;
  /** Extra class on the `<Link>` wrapper -- e.g. `gridColumn: "1 / -1"` to
   * span the grid, without disturbing the fixed `display: block; h: full`
   * every card needs. */
  className?: string;
}
function FeatureCardLink({
  title,
  subtitle,
  icon: Icon,
  className,
  ...props
}: FeatureCardLinkProps) {
  return (
    <Link className={cx(cardLink, className)} {...props}>
      <CardTool
        className={featureCard}
        icon={<Icon />}
        title={title}
        description={subtitle}
        interactive
      />
    </Link>
  );
}

const homeViewport = css({
  display: "flex",
  flexDirection: "column",
  minH: "full",
  width: "full",
  px: { base: "4", sm: "6", md: "8" },
  pt: { base: "6", xl: "16" },
});

const homeContent = css({
  display: "flex",
  flexDirection: "column",
  flex: "1",
  width: "full",
  maxWidth: "5xl",
  mx: "auto",
  gap: "6",
});

const featureGrid = css({
  width: "full",
  gridAutoRows: "fr",
  gridTemplateColumns: {
    base: "minmax(0, 1fr)",
    md: "repeat(2, minmax(0, 1fr))",
  },
});

// `AppCredits` centres its own contents, so this only has to place the block:
// pushed to the bottom of the content column, clear of the feature grid.
const builtBy = css({
  mt: "auto",
  pt: "16",
  pb: "8",
});

export const Route = createFileRoute("/home/features")({
  component: RouteComponent,
});

function RouteComponent() {
  const { t } = useTranslation([
    "common",
    "dataset",
    "anonymizer",
    "voice-to-text",
    "summarizer",
    "recommendations",
  ]);

  return (
    <APIProtected>
      <Stack width="full" height="[100dvh]" gap="0">
        <Header />
        <MainContent full>
          <div className={homeViewport}>
            <div className={homeContent}>
              <styled.h1 textStyle="title.md.strong">
                {t("home.features.greeting")}
              </styled.h1>
              <Grid gap="6" className={featureGrid}>
                {isDefensoriaEnabled() ? (
                  <FeatureCardLink
                    to="/$feature"
                    params={{ feature: FeatureFlowEnum.Recommendations }}
                    title={t("dataset:title")}
                    subtitle={t("recommendations:subtitle")}
                    icon={FEATURE_ICON.DATA_SET}
                  />
                ) : (
                  <FeatureCardLink
                    to="/$feature"
                    params={{ feature: FeatureFlowEnum.Dataset }}
                    title={t("dataset:title")}
                    subtitle={t("dataset:subtitle")}
                    icon={FEATURE_ICON.DATA_SET}
                  />
                )}
                <FeatureCardLink
                  to="/$feature"
                  params={{ feature: FeatureFlowEnum.Anonymizer }}
                  title={t("anonymizer:title")}
                  subtitle={t("anonymizer:subtitle")}
                  icon={FEATURE_ICON.ANONYMIZER}
                />
                <FeatureCardLink
                  to="/$feature"
                  params={{ feature: FeatureFlowEnum.VoiceToText }}
                  title={t("voice-to-text:title")}
                  subtitle={t("voice-to-text:subtitle")}
                  icon={FEATURE_ICON.VOICE_TO_TEXT}
                />
                <FeatureCardLink
                  to="/$feature"
                  params={{ feature: FeatureFlowEnum.Summarizer }}
                  title={t("summarizer:title")}
                  subtitle={t("summarizer:subtitle")}
                  icon={FEATURE_ICON.SUMMARIZER}
                />
                {isDefensoriaEnabled() && (
                  <FeatureCardLink
                    to="/home/dataset"
                    title={t("recommendations:grilla.title")}
                    subtitle={t("recommendations:grilla.cardSubtitle")}
                    icon={FEATURE_ICON.DATA_SET}
                    className={css({ gridColumn: "1 / -1" })}
                  />
                )}
              </Grid>
              <AppCredits className={builtBy} />
            </div>
          </div>
        </MainContent>
      </Stack>
    </APIProtected>
  );
}
