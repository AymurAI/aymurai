import {
  Button,
  FeaturesMenu as FeaturesMenuGrid,
  FeaturesMenuItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@aymurai/ui";
import { useNavigate } from "@tanstack/react-router";
import { DotsNine, Gear } from "phosphor-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { FEATURE_ICON, isDefensoriaEnabled } from "@/constants/config";
import { useFileDispatch } from "@/hooks/useFiles";
import { removeAllFiles } from "@/reducers/file/actions";
import { FeatureFlowEnum, featureNamespace } from "@/types/features";

interface FeaturesMenuProps {
  trigger?: ReactElement;
}

export default function FeaturesMenu({ trigger }: FeaturesMenuProps) {
  const { t } = useTranslation();
  const dispatch = useFileDispatch();
  const navigate = useNavigate();
  const features = Object.values(FeatureFlowEnum).filter((feature) => {
    if (feature === FeatureFlowEnum.Recommendations)
      return isDefensoriaEnabled();
    if (feature === FeatureFlowEnum.Dataset) return !isDefensoriaEnabled();
    return true;
  });

  const handleClearFiles = () => {
    dispatch(removeAllFiles());
  };

  // Navigate before clearing files, and skip the view transition: RequireFile
  // redirects to onboarding the moment files.length hits 0. Clearing first
  // let that race the intended navigation outright; awaiting `navigate()`
  // alone isn't enough either, because with the router's default view
  // transition on, the actual route/match swap runs inside
  // `document.startViewTransition()`, which resolves *after* `navigate()`'s
  // own promise — so the old, still-mounted route could still see the
  // cleared files and fire its guard. `viewTransition: false` makes this
  // specific navigation commit synchronously, closing that gap.
  //
  // Target onboarding directly (not `/$feature`, whose own `beforeLoad`
  // redirects there): a `redirect()` thrown from `beforeLoad` starts a new
  // commit that doesn't inherit this call's `viewTransition: false`, which
  // would reopen the exact gap this fix closes.
  const goToFeature = async (feature: FeatureFlowEnum) => {
    await navigate({
      to: "/$feature/onboarding",
      params: { feature },
      viewTransition: false,
    });
    handleClearFiles();
  };

  const goToSettings = async () => {
    await navigate({ to: "/home/settings/server", viewTransition: false });
    handleClearFiles();
  };

  // Same pattern as `goToSettings` above, not `goToFeature`: the grilla is a
  // `/home/*` route (not a `/$feature/onboarding` wizard entry), reached the
  // same way Configuración is. This still clears in-progress files on
  // navigation -- issue #58 confirms that's expected, the same known
  // property the four feature items and Configuración already have.
  const goToDataset = async () => {
    await navigate({ to: "/home/dataset", viewTransition: false });
    handleClearFiles();
  };

  // Reuses the Set de Datos icon (same choice `routes/home/features.tsx`
  // makes for the grilla card) -- there's no dedicated grilla icon.
  const GrillaIcon = FEATURE_ICON[FeatureFlowEnum.Dataset];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            size="icon-sm"
            style={{ padding: 2 }}
            aria-label="Ir al inicio"
          >
            <DotsNine size={32} />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" surface={false}>
        <FeaturesMenuGrid>
          {features.map((feature) => {
            const Icon =
              feature === FeatureFlowEnum.Recommendations
                ? FEATURE_ICON[FeatureFlowEnum.Dataset]
                : FEATURE_ICON[feature];
            const label =
              feature === FeatureFlowEnum.Summarizer
                ? t("featuresMenu.summary")
                : feature === FeatureFlowEnum.Recommendations
                  ? t("title", { ns: "dataset" })
                  : t("title", { ns: featureNamespace[feature] });
            return (
              <FeaturesMenuItem
                key={feature}
                icon={<Icon size={24} />}
                label={label}
                onClick={() => goToFeature(feature)}
              />
            );
          })}
          {isDefensoriaEnabled() && (
            <FeaturesMenuItem
              icon={<GrillaIcon size={24} />}
              label={t("grilla.title", { ns: "recommendations" })}
              onClick={goToDataset}
            />
          )}
          <FeaturesMenuItem
            icon={<Gear size={24} />}
            label={t("settings")}
            fullWidth
            onClick={goToSettings}
          />
        </FeaturesMenuGrid>
      </PopoverContent>
    </Popover>
  );
}
