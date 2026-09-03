import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Switch,
  TextField,
} from "@aymurai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { organigramService } from "@/services/aymurai";
import { HStack, Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";

// See deactivate-dialog.tsx for why the primitives come from `@aymurai/ui`.

interface UnitCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The new unit hangs off this one; `null` creates another root. */
  parent: OrganigramUnit | null;
  /** Existing children of `parent`, to place the new unit last. */
  siblings: OrganigramUnit[];
  onCreated: (unitId: string) => void;
}

/**
 * Creates a unit anywhere in the tree. The parent is whatever is selected, so
 * there is one "Agregar unidad" affordance rather than a per-row control, and
 * the dialog states where the unit will land instead of asking the reader to
 * pick from 520 options.
 */
export default function UnitCreateDialog({
  open,
  onOpenChange,
  parent,
  siblings,
  onCreated,
}: UnitCreateDialogProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [acronym, setAcronym] = useState("");
  const [isSector, setIsSector] = useState(false);

  const reset = () => {
    setName("");
    setAcronym("");
    setIsSector(false);
  };

  const { mutate: createUnit, isPending } = useMutation({
    ...organigramService.createUnit(),
    onSuccess: (unit) => {
      queryClient.invalidateQueries({
        queryKey: organigramService.listUnits().queryKey,
      });
      showToast(
        t("organigram.unitForm.createdToast", { name: unit.name }),
        "success",
      );
      reset();
      onOpenChange(false);
      onCreated(unit.id);
    },
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    createUnit({
      parent_id: parent?.id ?? null,
      name: trimmed,
      acronym: acronym.trim() || null,
      short_name: null,
      is_sector: isSector,
      // Last among its siblings; `order` drives the tree's sibling sort.
      order:
        siblings.reduce((max, unit) => Math.max(max, unit.order ?? 0), 0) + 1,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("organigram.unitForm.createTitle")}</DialogTitle>
          <styled.p textStyle="subtitle.sm.default" color="text.lighter">
            {parent
              ? t("organigram.unitForm.parentIs", {
                  name: parent.acronym ?? parent.name,
                })
              : t("organigram.unitForm.parentRoot")}
          </styled.p>
        </DialogHeader>

        <Stack gap="4">
          <TextField
            label={t("organigram.unitForm.nameLabel")}
            placeholder={t("organigram.unitForm.namePlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <TextField
            label={t("organigram.unitForm.acronymLabel")}
            placeholder={t("organigram.unitForm.acronymPlaceholder")}
            value={acronym}
            onChange={(event) => setAcronym(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
          <HStack justify="space-between" gap="2">
            <styled.span textStyle="paragraph.sm.default">
              {t("organigram.detail.isSectorLabel")}
            </styled.span>
            <Switch
              checked={isSector}
              onCheckedChange={setIsSector}
              aria-label={t("organigram.detail.isSectorLabel")}
            />
          </HStack>
        </Stack>

        <DialogFooter>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            size="sm"
            isLoading={isPending}
            disabled={!name.trim()}
            onClick={submit}
          >
            {t("organigram.unitForm.submitCreate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
