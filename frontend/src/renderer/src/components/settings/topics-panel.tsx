import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import SidePanelColumn from "@/components/layout/side-panel-column";
import { catalogsService } from "@/services/aymurai";
import { css, cx } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import type { Topic } from "@/types/catalogs";

// `Dialog`/`DialogContent`/`DialogTitle`/`DialogFooter` come from `@aymurai/ui`
// (which wraps `@radix-ui/react-dialog` internally) rather than a local
// `@/components/ui/dialog` module — that module doesn't exist in this repo.
// Every existing Radix dialog usage in this codebase (label-manager's
// merge/remove dialogs, tag-annotation's replace dialog,
// manual-entity-resolution-dialog) imports the same way, and this repo's
// own `.claude/CLAUDE.md` documents Dialog as one of the primitives
// "consumed straight from `@aymurai/ui`" — `@radix-ui/react-dialog` isn't
// even a direct dependency of this package.

const row = css({
  cursor: "pointer",
  px: "3",
  py: "2",
  borderRadius: "md",
  _hover: { bg: "bg.primary-highlight" },
});

const selectedRow = css({ bg: "bg.primary-highlight" });

interface TopicsPanelProps {
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string) => void;
}

export default function TopicsPanel({
  selectedTopicId,
  onSelectTopic,
}: TopicsPanelProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const { data: topics = [] } = useQuery(catalogsService.listTopics());
  const [pendingDeactivation, setPendingDeactivation] = useState<Topic | null>(
    null,
  );
  const [newTopicName, setNewTopicName] = useState("");

  const { data: usage } = useQuery({
    ...catalogsService.topicUsage(pendingDeactivation?.id ?? ""),
    enabled: pendingDeactivation !== null,
  });

  const { mutate: updateTopic } = useMutation({
    ...catalogsService.updateTopic(),
    onSuccess: () => {
      // Invalidate via the factory's own queryKey rather than a hardcoded
      // literal — `catalogsService.listTopics()` keys on
      // `["topics", api.defaults.baseURL]` (see services/aymurai/catalogs.ts),
      // so a bare `["topics"]` literal would still partial-match today, but
      // reusing the factory's key keeps this correct if that shape changes.
      queryClient.invalidateQueries({
        queryKey: catalogsService.listTopics().queryKey,
      });
      setPendingDeactivation(null);
    },
  });

  const { mutate: createTopic } = useMutation({
    ...catalogsService.createTopic(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: catalogsService.listTopics().queryKey,
      });
      setNewTopicName("");
    },
  });

  return (
    <SidePanelColumn>
      <Stack gap="4" p="4">
        <styled.h2 textStyle="subtitle.md.strong">
          {t("taxonomy.topics.title")}
        </styled.h2>

        <HStack gap="2">
          <input
            aria-label={t("taxonomy.topics.nameLabel")}
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
          />
          <button
            type="button"
            onClick={() =>
              newTopicName &&
              createTopic({
                name: newTopicName,
                code: null,
                order: topics.length + 1,
              })
            }
          >
            {t("taxonomy.topics.addAction")}
          </button>
        </HStack>

        {topics.map((topic) => (
          <HStack
            key={topic.id}
            justify="space-between"
            className={cx(row, topic.id === selectedTopicId && selectedRow)}
            onClick={() => onSelectTopic(topic.id)}
          >
            <span>{topic.name}</span>
            <button
              type="button"
              aria-label={`${t("taxonomy.topics.deactivateAction")}: ${topic.name}`}
              onClick={(e) => {
                e.stopPropagation();
                setPendingDeactivation(topic);
              }}
            >
              {t("taxonomy.topics.deactivateAction")}
            </button>
          </HStack>
        ))}
      </Stack>

      <Dialog
        open={pendingDeactivation !== null}
        onOpenChange={(open) => !open && setPendingDeactivation(null)}
      >
        <DialogContent size="sm">
          <DialogTitle>
            {t("taxonomy.topics.deactivateConfirmTitle")}
          </DialogTitle>
          {usage && (
            <p>{t("taxonomy.topics.usageWarning", { count: usage.count })}</p>
          )}
          <DialogFooter>
            <button type="button" onClick={() => setPendingDeactivation(null)}>
              {t("taxonomy.topics.cancel")}
            </button>
            <button
              type="button"
              onClick={() =>
                pendingDeactivation &&
                updateTopic({ id: pendingDeactivation.id, active: false })
              }
            >
              {t("taxonomy.topics.confirmDeactivate")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidePanelColumn>
  );
}
