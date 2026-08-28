import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { organigramService } from "@/services/aymurai";
import { Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";

interface OrganigramDetailPanelProps {
  unit: OrganigramUnit | null;
}

export default function OrganigramDetailPanel({
  unit,
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
  // production — this was a defect found and fixed in Task 6's
  // topics-panel.tsx/subtopics-panel.tsx and must not be repeated here.
  const holdersQueryKey = organigramService.unitHolders(
    unit?.id ?? "",
  ).queryKey;

  const { data: holders = [] } = useQuery({
    ...organigramService.unitHolders(unit?.id ?? ""),
    enabled: unit !== null,
  });

  const { mutate: updateUnit } = useMutation({
    ...organigramService.updateUnit(),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: organigramService.listUnits().queryKey,
      }),
  });

  const { mutate: addHolder } = useMutation({
    ...organigramService.addHolder(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: holdersQueryKey });
      setNewHolderName("");
    },
  });

  if (unit === null) {
    return <Stack p="4">{t("organigram.detail.empty")}</Stack>;
  }

  const currentHolder = holders.find((h) => h.is_current);

  return (
    <Stack gap="4" p="4">
      <styled.h2 textStyle="subtitle.md.strong">{unit.name}</styled.h2>

      <label>
        {t("organigram.detail.isSectorLabel")}
        <input
          type="checkbox"
          aria-label={t("organigram.detail.isSectorLabel")}
          checked={unit.is_sector}
          onChange={(e) =>
            updateUnit({ id: unit.id, is_sector: e.target.checked })
          }
        />
      </label>

      <Stack gap="2">
        <styled.h3 textStyle="label.md.strong">
          {t("organigram.detail.currentHolderLabel")}
        </styled.h3>
        <p>{currentHolder?.name ?? t("organigram.detail.noHolder")}</p>

        <styled.h3 textStyle="label.md.strong">
          {t("organigram.detail.holderHistoryTitle")}
        </styled.h3>
        {/* "Historial" is past holders only — the current holder already has
            its own line above ("Titular actual"), so including it again here
            would render the same name twice in the DOM (confirmed via a
            real test failure: `findByText("María Pérez")` threw "found
            multiple elements" when the fixture's lone holder was both
            current and rendered a second time in this list). */}
        {holders
          .filter((holder) => !holder.is_current)
          .map((holder) => (
            <p key={holder.id}>
              {holder.name} ({holder.created_at})
            </p>
          ))}

        <label>
          {t("organigram.detail.newHolderLabel")}
          <input
            aria-label={t("organigram.detail.newHolderLabel")}
            value={newHolderName}
            onChange={(e) => setNewHolderName(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() =>
            newHolderName &&
            addHolder({ unit_id: unit.id, name: newHolderName })
          }
        >
          {t("organigram.detail.newHolderAction")}
        </button>
      </Stack>
    </Stack>
  );
}
