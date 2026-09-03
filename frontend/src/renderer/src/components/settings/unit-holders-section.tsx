import {
  Avatar,
  AvatarPill,
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
} from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilSimple, Plus } from "phosphor-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { organigramService } from "@/services/aymurai";
import { css } from "@/styled/css";
import { Divider, HStack, Stack, styled } from "@/styled/jsx";
import type { OrganigramHolder, OrganigramUnit } from "@/types/organigram";
import { holderDate, holderInitials } from "./holder-format";

const card = css({
  bg: "bg.secondary",
  borderRadius: "md",
  px: "4",
  py: "3",
  gap: "2",
  w: "full",
});

const editButton = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  w: "8",
  h: "8",
  p: "0",
  flexShrink: "0",
  border: "[none]",
  bg: "[transparent]",
  color: "text.lighter",
  borderRadius: "sm",
  cursor: "pointer",
  transition: "[background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "bg.primary-alternative", color: "text.default" },
});

interface UnitHoldersSectionProps {
  unit: OrganigramUnit;
}

/**
 * Who holds the office now, who held it before, and the two ways that changes:
 * succession (a new holder supersedes the current one) and correction
 * (renaming a holder in place, for a typo — `PATCH /organigram/holders/{id}`).
 */
export default function UnitHoldersSection({ unit }: UnitHoldersSectionProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [newHolderName, setNewHolderName] = useState("");
  const [editing, setEditing] = useState<OrganigramHolder | null>(null);
  const [editedName, setEditedName] = useState("");

  // Invalidate via the factory's own queryKey rather than a hardcoded literal
  // array — `unitHolders` keys on `["organigram-units", api.defaults.baseURL,
  // unitId, "holders"]` (see services/aymurai/organigram.ts), so a hand-typed
  // `["holders", unitId]` would silently fail to prefix-match it in production.
  const holdersQueryKey = organigramService.unitHolders(unit.id).queryKey;
  const invalidateHolders = () =>
    queryClient.invalidateQueries({ queryKey: holdersQueryKey });

  const { data: holders = [] } = useQuery(
    organigramService.unitHolders(unit.id),
  );

  const { mutate: addHolder, isPending: isAdding } = useMutation({
    ...organigramService.addHolder(),
    onSuccess: (holder) => {
      invalidateHolders();
      setNewHolderName("");
      showToast(
        t("organigram.detail.holderAddedToast", { name: holder.name }),
        "success",
      );
    },
  });

  const { mutate: updateHolder, isPending: isRenaming } = useMutation({
    ...organigramService.updateHolder(),
    onSuccess: (holder) => {
      invalidateHolders();
      setEditing(null);
      showToast(
        t("organigram.detail.holderRenamedToast", { name: holder.name }),
        "success",
      );
    },
  });

  const currentHolder = holders.find((holder) => holder.is_current);
  // "Historial" is past holders only — the current holder has its own card
  // above, and listing it twice renders the same name twice in the DOM.
  const pastHolders = holders.filter((holder) => !holder.is_current);

  const submitNewHolder = () => {
    const name = newHolderName.trim();
    if (!name) return;
    addHolder({ unit_id: unit.id, name });
  };

  const startEditing = (holder: OrganigramHolder) => {
    setEditedName(holder.name);
    setEditing(holder);
  };

  const renameButton = (holder: OrganigramHolder) => (
    <styled.button
      type="button"
      className={editButton}
      aria-label={`${t("organigram.detail.renameHolderAction")}: ${holder.name}`}
      onClick={() => startEditing(holder)}
    >
      <PencilSimple size={16} />
    </styled.button>
  );

  return (
    <>
      <Stack gap="4">
        <styled.h3 textStyle="subtitle.md.strong">
          {t("organigram.detail.currentHolderLabel")}
        </styled.h3>
        {currentHolder ? (
          <HStack className={card} justify="space-between">
            <HStack gap="2" minW="0">
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
            {renameButton(currentHolder)}
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
                <HStack gap="2" flexShrink="0">
                  <styled.span
                    textStyle="subtitle.sm.default"
                    color="text.lighter"
                  >
                    {t("organigram.detail.holderSince", {
                      date: holderDate(holder.created_at),
                    })}
                  </styled.span>
                  {renameButton(holder)}
                </HStack>
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
            isLoading={isAdding}
            onClick={submitNewHolder}
            disabled={!newHolderName.trim()}
          >
            <Plus size={16} />
            {t("organigram.detail.newHolderAction")}
          </Button>
        </styled.div>
      </Stack>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {t("organigram.detail.renameHolderTitle")}
            </DialogTitle>
          </DialogHeader>

          {/* `DialogHeader` lays title and aside out in a row, which squeezes
              a long title into a narrow column — this explanation is long, so
              it goes in the body instead. */}
          <styled.p
            textStyle="paragraph.sm.default"
            color="text.lighter"
            mb="4"
          >
            {t("organigram.detail.renameHolderBody")}
          </styled.p>

          <TextField
            label={t("organigram.detail.newHolderNameLabel")}
            placeholder={t("organigram.detail.newHolderPlaceholder")}
            value={editedName}
            onChange={(event) => setEditedName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !editing) return;
              const name = editedName.trim();
              if (name) {
                updateHolder({ id: editing.id, unit_id: unit.id, name });
              }
            }}
          />

          <DialogFooter>
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              onClick={() => setEditing(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              isLoading={isRenaming}
              disabled={
                !editedName.trim() || editedName.trim() === editing?.name
              }
              onClick={() =>
                editing &&
                updateHolder({
                  id: editing.id,
                  unit_id: unit.id,
                  name: editedName.trim(),
                })
              }
            >
              {t("organigram.detail.renameHolderSubmit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
