import {
  Avatar,
  AvatarPill,
  Button,
  Callout,
  Switch,
  TextField,
} from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "phosphor-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { organigramService } from "@/services/aymurai";
import { css } from "@/styled/css";
import { Divider, HStack, Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";
import { holderDate, holderInitials } from "./holder-format";

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
}

export default function OrganigramDetailPanel({
  unit,
  ancestors,
}: OrganigramDetailPanelProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [newHolderName, setNewHolderName] = useState("");

  // Invalidate via the factory's own queryKey rather than a hardcoded literal
  // array — the real `organigramService.listUnits`/`unitHolders` key on
  // `["organigram-units", api.defaults.baseURL]` /
  // `["organigram-units", api.defaults.baseURL, unitId, "holders"]` (see
  // services/aymurai/organigram.ts), so a hand-typed `["units"]`/`["holders",
  // unitId]` literal would silently fail to prefix-match those real keys in
  // production — a defect found and fixed once already; do not repeat it.
  const holdersQueryKey = organigramService.unitHolders(
    unit?.id ?? "",
  ).queryKey;

  const { data: holders = [] } = useQuery({
    ...organigramService.unitHolders(unit?.id ?? ""),
    enabled: unit !== null,
  });

  const { mutate: updateUnit } = useMutation({
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

  const { mutate: addHolder } = useMutation({
    ...organigramService.addHolder(),
    onSuccess: (holder) => {
      queryClient.invalidateQueries({ queryKey: holdersQueryKey });
      setNewHolderName("");
      showToast(
        t("organigram.detail.holderAddedToast", { name: holder.name }),
        "success",
      );
    },
  });

  if (unit === null) {
    return (
      <Stack className={panel} justify="center">
        <styled.div className={column} maxW="[480px]">
          <Callout variant="info" message={t("organigram.detail.empty")} />
        </styled.div>
      </Stack>
    );
  }

  const currentHolder = holders.find((holder) => holder.is_current);
  // "Historial" is past holders only — the current holder has its own card
  // above, and listing it twice renders the same name twice in the DOM.
  const pastHolders = holders.filter((holder) => !holder.is_current);
  const breadcrumb = ancestors
    .map((ancestor) => ancestor.acronym ?? ancestor.name)
    .join(" › ");

  const submitNewHolder = () => {
    const name = newHolderName.trim();
    if (!name) return;
    addHolder({ unit_id: unit.id, name });
  };

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

        <HStack className={sectorRow} justify="space-between">
          <styled.span textStyle="paragraph.sm.default">
            {t("organigram.detail.isSectorLabel")}
          </styled.span>
          <Switch
            checked={unit.is_sector}
            aria-label={t("organigram.detail.isSectorLabel")}
            onCheckedChange={(checked) =>
              updateUnit({ id: unit.id, is_sector: checked })
            }
          />
        </HStack>

        <Divider color="[token(colors.brand.secondary)]" />

        <Stack gap="4">
          <styled.h3 textStyle="subtitle.md.strong">
            {t("organigram.detail.currentHolderLabel")}
          </styled.h3>
          {currentHolder ? (
            <HStack className={card} gap="2">
              <Avatar size="md" initials={holderInitials(currentHolder.name)} />
              <Stack gap="0.5" minW="0">
                <styled.span
                  textStyle="paragraph.sm.strong"
                  overflow="hidden"
                  textOverflow="ellipsis"
                  whiteSpace="nowrap"
                >
                  {currentHolder.name}
                </styled.span>
                <styled.span
                  textStyle="subtitle.sm.default"
                  color="text.lighter"
                >
                  {t("organigram.detail.holderSince", {
                    date: holderDate(currentHolder.created_at),
                  })}
                </styled.span>
              </Stack>
            </HStack>
          ) : (
            <Callout variant="info" message={t("organigram.detail.noHolder")} />
          )}
        </Stack>

        <Stack gap="4">
          <HStack justify="space-between" alignItems="baseline" gap="2">
            <styled.h3 textStyle="subtitle.md.strong">
              {t("organigram.detail.holderHistoryTitle")}
            </styled.h3>
            <styled.span textStyle="label.sm.default" color="text.lighter">
              {t("organigram.detail.holderHistoryCount", {
                count: pastHolders.length,
              })}
            </styled.span>
          </HStack>
          {pastHolders.length > 0 ? (
            <Stack gap="2">
              {pastHolders.map((holder) => (
                <HStack key={holder.id} justify="space-between" gap="2">
                  <AvatarPill
                    initials={holderInitials(holder.name)}
                    name={holder.name}
                    color="secondary"
                  />
                  <styled.span
                    textStyle="subtitle.sm.default"
                    color="text.lighter"
                    flexShrink="0"
                  >
                    {t("organigram.detail.holderSince", {
                      date: holderDate(holder.created_at),
                    })}
                  </styled.span>
                </HStack>
              ))}
            </Stack>
          ) : (
            <styled.p textStyle="paragraph.sm.default" color="text.lighter">
              {t("organigram.detail.noHistory")}
            </styled.p>
          )}
        </Stack>

        <Divider color="[token(colors.brand.secondary)]" />

        <Stack gap="4">
          <styled.h3 textStyle="subtitle.md.strong">
            {t("organigram.detail.newHolderLabel")}
          </styled.h3>
          <TextField
            label={t("organigram.detail.newHolderNameLabel")}
            placeholder={t("organigram.detail.newHolderPlaceholder")}
            helper={t("organigram.detail.newHolderHelper")}
            value={newHolderName}
            onChange={(event) => setNewHolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNewHolder();
            }}
          />
          {/* Wrapper rather than `alignSelf` on `Button`: its props are
              `ButtonHTMLAttributes`, so a style prop would leak to the DOM. */}
          <styled.div alignSelf="flex-start">
            <Button
              type="button"
              onClick={submitNewHolder}
              disabled={!newHolderName.trim()}
            >
              <Plus size={16} />
              {t("organigram.detail.newHolderAction")}
            </Button>
          </styled.div>
        </Stack>
      </Stack>
    </Stack>
  );
}
