import { Dialog, DialogContent, DialogTitle } from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { catalogsService } from "@/services/aymurai";
import { HStack, Stack, styled } from "@/styled/jsx";
import type { Subtopic } from "@/types/catalogs";

// See topics-panel.tsx for why Dialog/DialogContent/DialogTitle come from
// `@aymurai/ui` rather than a local `@/components/ui/dialog` module.

interface SubtopicsPanelProps {
  topicId: string | null;
}

export default function SubtopicsPanel({ topicId }: SubtopicsPanelProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { data: subtopics = [] } = useQuery({
    ...catalogsService.listSubtopics(topicId ?? ""),
    enabled: topicId !== null,
  });
  const [reassigning, setReassigning] = useState<Subtopic | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>("");
  const [newSubtopicName, setNewSubtopicName] = useState("");

  // Invalidate via the factory's own queryKey rather than a hardcoded
  // `["subtopics", topicId]` literal — the real `catalogsService.listSubtopics`
  // keys on `["subtopics", api.defaults.baseURL, topicId]` (see
  // services/aymurai/catalogs.ts, and organigram.ts's identical pattern for
  // `unitHolders`), so a two-element literal would silently fail to
  // partial-match that three-element key and never invalidate in production
  // — only the test's simplified mock shape happens to line up with it.
  const subtopicsQueryKey = catalogsService.listSubtopics(
    topicId ?? "",
  ).queryKey;

  const { mutate: updateSubtopic } = useMutation({
    ...catalogsService.updateSubtopic(),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: subtopicsQueryKey }),
  });
  const { mutate: reassignSubtopic } = useMutation({
    ...catalogsService.reassignSubtopic(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subtopicsQueryKey });
      setReassigning(null);
      setReassignTarget("");
    },
  });
  const { mutate: createSubtopic } = useMutation({
    ...catalogsService.createSubtopic(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: subtopicsQueryKey });
      setNewSubtopicName("");
    },
  });

  if (topicId === null) {
    return <Stack p="4">{t("taxonomy.subtopics.empty")}</Stack>;
  }

  return (
    <Stack gap="4" p="4">
      <styled.h2 textStyle="subtitle.md.strong">
        {t("taxonomy.subtopics.title")}
      </styled.h2>

      <HStack gap="2">
        <input
          aria-label={t("taxonomy.subtopics.nameLabel")}
          value={newSubtopicName}
          onChange={(e) => setNewSubtopicName(e.target.value)}
        />
        <button
          type="button"
          onClick={() =>
            newSubtopicName &&
            topicId &&
            createSubtopic({
              topic_id: topicId,
              name: newSubtopicName,
              code: null,
              order: subtopics.length + 1,
            })
          }
        >
          {t("taxonomy.subtopics.addAction")}
        </button>
      </HStack>

      {subtopics.map((subtopic) => (
        <HStack key={subtopic.id} justify="space-between">
          <span>{subtopic.name}</span>
          <HStack gap="2">
            <button
              type="button"
              aria-label={`${t("taxonomy.subtopics.reassignAction")}: ${subtopic.name}`}
              onClick={() => setReassigning(subtopic)}
            >
              {t("taxonomy.subtopics.reassignAction")}
            </button>
            <button
              type="button"
              aria-label={`${t("taxonomy.subtopics.deactivateAction")}: ${subtopic.name}`}
              onClick={() => updateSubtopic({ id: subtopic.id, active: false })}
            >
              {t("taxonomy.subtopics.deactivateAction")}
            </button>
          </HStack>
        </HStack>
      ))}

      <Dialog
        open={reassigning !== null}
        onOpenChange={(open) => !open && setReassigning(null)}
      >
        <DialogContent size="sm">
          <DialogTitle>{t("taxonomy.subtopics.reassignAction")}</DialogTitle>
          <label>
            {t("taxonomy.subtopics.reassignTargetLabel")}
            <select
              value={reassignTarget}
              onChange={(e) => setReassignTarget(e.target.value)}
            >
              <option value="">{t("taxonomy.subtopics.reassignNone")}</option>
              {subtopics
                .filter((s) => s.id !== reassigning?.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() =>
              reassigning &&
              reassignSubtopic({
                id: reassigning.id,
                target_subtopic_id: reassignTarget || null,
              })
            }
          >
            {t("taxonomy.subtopics.confirmReassign")}
          </button>
        </DialogContent>
      </Dialog>
    </Stack>
  );
}
