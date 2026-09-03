import { Button, TextField } from "@aymurai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { organigramService } from "@/services/aymurai";
import { Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";

interface UnitIdentityFormProps {
  unit: OrganigramUnit;
}

/** Renames a unit and edits the labels the tree renders it by. */
export default function UnitIdentityForm({ unit }: UnitIdentityFormProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();

  const [name, setName] = useState(unit.name);
  const [acronym, setAcronym] = useState(unit.acronym ?? "");
  const [shortName, setShortName] = useState(unit.short_name ?? "");

  // Selecting another unit must reload the fields rather than keep the
  // previous unit's half-typed edits.
  useEffect(() => {
    setName(unit.name);
    setAcronym(unit.acronym ?? "");
    setShortName(unit.short_name ?? "");
  }, [unit.id, unit.name, unit.acronym, unit.short_name]);

  const { mutate: updateUnit, isPending } = useMutation({
    ...organigramService.updateUnit(),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: organigramService.listUnits().queryKey,
      });
      showToast(
        t("organigram.unitForm.updatedToast", { name: updated.name }),
        "success",
      );
    },
  });

  const trimmedName = name.trim();
  const nextAcronym = acronym.trim() || null;
  const nextShortName = shortName.trim() || null;
  const isDirty =
    trimmedName !== unit.name ||
    nextAcronym !== unit.acronym ||
    nextShortName !== unit.short_name;

  return (
    <Stack gap="4">
      <styled.h3 textStyle="subtitle.md.strong">
        {t("organigram.unitForm.saveAction")}
      </styled.h3>
      <TextField
        label={t("organigram.unitForm.nameLabel")}
        placeholder={t("organigram.unitForm.namePlaceholder")}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <TextField
        label={t("organigram.unitForm.acronymLabel")}
        placeholder={t("organigram.unitForm.acronymPlaceholder")}
        value={acronym}
        onChange={(event) => setAcronym(event.target.value)}
      />
      <TextField
        label={t("organigram.unitForm.shortNameLabel")}
        placeholder={t("organigram.unitForm.shortNamePlaceholder")}
        value={shortName}
        onChange={(event) => setShortName(event.target.value)}
      />
      <styled.div alignSelf="flex-start">
        <Button
          type="button"
          size="sm"
          isLoading={isPending}
          disabled={!trimmedName || !isDirty}
          onClick={() =>
            updateUnit({
              id: unit.id,
              name: trimmedName,
              acronym: nextAcronym,
              short_name: nextShortName,
            })
          }
        >
          {t("organigram.unitForm.saveAction")}
        </Button>
      </styled.div>
    </Stack>
  );
}
