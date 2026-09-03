import { Button, Callout, Switch } from "@aymurai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { organigramService } from "@/services/aymurai";
import { css } from "@/styled/css";
import { Divider, HStack, Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";
import EmptySelection from "./empty-selection";
import UnitDeactivateDialog from "./unit-deactivate-dialog";
import UnitHoldersSection from "./unit-holders-section";
import UnitIdentityForm from "./unit-identity-form";

/** Grey detail surface with white cards — `SidePanel`'s composition in `@aymurai/ui`. */
const panel = css({
  bg: "bg.primary",
  border: "card",
  borderRadius: "lg",
  p: "6",
  gap: "6",
  alignItems: "center",
  overflowY: "auto",
  minH: "0",
  minW: "0",
});

/** Detail content tracks `sizes.panel.form`, so it stays readable on a wide pane. */
const column = css({ w: "full", maxW: "[token(sizes.panel.form)]", gap: "6" });

const card = css({
  bg: "bg.secondary",
  borderRadius: "md",
  px: "4",
  py: "3",
  gap: "1",
  w: "full",
});

const sectorRow = css({
  bg: "bg.secondary",
  borderRadius: "sm",
  h: "10",
  px: "4",
  gap: "2",
  w: "full",
});

const acronymChip = css({
  textStyle: "label.sm.strong",
  color: "brand.primary",
  bg: "bg.primary-alternative",
  borderRadius: "full",
  px: "2",
  py: "0.5",
  flexShrink: "0",
});

interface OrganigramDetailPanelProps {
  unit: OrganigramUnit | null;
  /** Root-first ancestors of `unit`, used for the breadcrumb caption. */
  ancestors: OrganigramUnit[];
  /** Units anywhere below `unit`; deactivation leaves them active. */
  dependentCount: number;
}

export default function OrganigramDetailPanel({
  unit,
  ancestors,
  dependentCount,
}: OrganigramDetailPanelProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [isDeactivating, setIsDeactivating] = useState(false);

  const { mutate: setSector } = useMutation({
    ...organigramService.updateUnit(),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: organigramService.listUnits().queryKey,
      });
      showToast(
        updated.is_sector
          ? t("organigram.detail.sectorOnToast", { name: updated.name })
          : t("organigram.detail.sectorOffToast", { name: updated.name }),
        "success",
      );
    },
  });

  const { mutate: setActive, isPending: isSettingActive } = useMutation({
    ...organigramService.updateUnit(),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: organigramService.listUnits().queryKey,
      });
      setIsDeactivating(false);
      showToast(
        updated.active
          ? t("organigram.detail.reactivatedToast", { name: updated.name })
          : t("organigram.detail.deactivatedToast", { name: updated.name }),
        "success",
      );
    },
  });

  if (unit === null) {
    return <EmptySelection message={t("organigram.detail.empty")} />;
  }

  const breadcrumb = ancestors
    .map((ancestor) => ancestor.acronym ?? ancestor.name)
    .join(" › ");

  return (
    <Stack className={panel}>
      <Stack className={column}>
        <Stack className={card}>
          <styled.p
            textStyle="subtitle.sm.default"
            color="text.lighter"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {breadcrumb || t("organigram.detail.rootUnit")}
          </styled.p>
          <HStack gap="2">
            <styled.h2 textStyle="subtitle.md.strong">{unit.name}</styled.h2>
            {unit.acronym && (
              <styled.span className={acronymChip}>{unit.acronym}</styled.span>
            )}
          </HStack>
        </Stack>

        {!unit.active && (
          <Callout
            variant="warning"
            message={t("organigram.detail.inactiveNotice")}
          />
        )}

        <HStack className={sectorRow} justify="space-between">
          <styled.span textStyle="paragraph.sm.default">
            {t("organigram.detail.isSectorLabel")}
          </styled.span>
          <Switch
            checked={unit.is_sector}
            aria-label={t("organigram.detail.isSectorLabel")}
            onCheckedChange={(checked) =>
              setSector({ id: unit.id, is_sector: checked })
            }
          />
        </HStack>

        <Divider color="[token(colors.brand.secondary)]" />

        <UnitIdentityForm key={unit.id} unit={unit} />

        <styled.div alignSelf="flex-start">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            isLoading={isSettingActive}
            onClick={() =>
              unit.active
                ? setIsDeactivating(true)
                : setActive({ id: unit.id, active: true })
            }
          >
            {unit.active
              ? t("organigram.detail.deactivateAction")
              : t("organigram.detail.reactivateAction")}
          </Button>
        </styled.div>

        <Divider color="[token(colors.brand.secondary)]" />

        <UnitHoldersSection unit={unit} />
      </Stack>

      <UnitDeactivateDialog
        open={isDeactivating}
        onOpenChange={setIsDeactivating}
        dependentCount={dependentCount}
        isPending={isSettingActive}
        onConfirm={() => setActive({ id: unit.id, active: false })}
      />
    </Stack>
  );
}
