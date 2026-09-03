import { Button, Search, TextField } from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "phosphor-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { catalogsService } from "@/services/aymurai";
import { HStack, styled } from "@/styled/jsx";
import type { Topic } from "@/types/catalogs";
import CategoryRow from "./category-row";
import DeactivateDialog from "./deactivate-dialog";
import PanelSurface from "./panel-surface";

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

  const [query, setQuery] = useState("");
  const [pendingDeactivation, setPendingDeactivation] = useState<Topic | null>(
    null,
  );

  // `isLoading` (rather than `isPending`) is TanStack Query v5's "first fetch in
  // progress" flag — `isPending` alone stays true while the query is disabled,
  // which is exactly the closed-dialog case this must not treat as loading.
  const { data: usage, isLoading: isUsageLoading } = useQuery({
    ...catalogsService.topicUsage(pendingDeactivation?.id ?? ""),
    enabled: pendingDeactivation !== null,
  });
  const [newTopicName, setNewTopicName] = useState("");

  const visibleTopics = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return topics;
    return topics.filter(
      (topic) =>
        topic.name.toLowerCase().includes(needle) ||
        (topic.code ?? "").toLowerCase().includes(needle),
    );
  }, [topics, query]);

  const invalidateTopics = () =>
    // Invalidate via the factory's own queryKey rather than a hardcoded
    // literal — `catalogsService.listTopics()` keys on
    // `["topics", api.defaults.baseURL]` (see services/aymurai/catalogs.ts),
    // so a bare `["topics"]` literal would still partial-match today, but
    // reusing the factory's key keeps this correct if that shape changes.
    // The per-topic usage query lives under the same prefix, so its count
    // is refetched too.
    queryClient.invalidateQueries({
      queryKey: catalogsService.listTopics().queryKey,
    });

  const { mutate: updateTopic } = useMutation({
    ...catalogsService.updateTopic(),
    onSuccess: (topic) => {
      invalidateTopics();
      setPendingDeactivation(null);
      showToast(
        topic.active
          ? t("taxonomy.topics.reactivatedToast", { name: topic.name })
          : t("taxonomy.topics.deactivatedToast", { name: topic.name }),
        "success",
      );
    },
  });

  const { mutate: createTopic } = useMutation({
    ...catalogsService.createTopic(),
    onSuccess: (topic) => {
      invalidateTopics();
      setNewTopicName("");
      // Clearing the filter keeps the new row visible — otherwise it is
      // created outside the active search and appears to have vanished.
      setQuery("");
      onSelectTopic(topic.id);
      showToast(
        t("taxonomy.topics.createdToast", { name: topic.name }),
        "success",
      );
    },
  });

  const submitNewTopic = () => {
    const name = newTopicName.trim();
    if (!name) return;
    createTopic({ name, code: null, order: topics.length + 1 });
  };

  const inactiveCount = topics.filter((topic) => !topic.active).length;

  return (
    <PanelSurface
      title={t("taxonomy.topics.title")}
      headerAside={
        <styled.span
          textStyle="label.sm.default"
          color="text.lighter"
          whiteSpace="nowrap"
        >
          {query.trim()
            ? t("taxonomy.topics.filteredCount", {
                shown: visibleTopics.length,
                total: topics.length,
              })
            : t("taxonomy.topics.count", {
                count: topics.length,
                context: inactiveCount > 0 ? "withInactive" : undefined,
                inactive: inactiveCount,
              })}
        </styled.span>
      }
      toolbar={
        <Search
          value={query}
          aria-label={t("taxonomy.topics.searchLabel")}
          placeholder={t("taxonomy.topics.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
        />
      }
      footer={
        <HStack gap="2" alignItems="flex-end">
          <TextField
            aria-label={t("taxonomy.topics.nameLabel")}
            placeholder={t("taxonomy.topics.newPlaceholder")}
            value={newTopicName}
            onChange={(event) => setNewTopicName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNewTopic();
            }}
          />
          <Button
            type="button"
            onClick={submitNewTopic}
            disabled={!newTopicName.trim()}
          >
            <Plus size={16} />
            {t("taxonomy.topics.addAction")}
          </Button>
        </HStack>
      }
    >
      <styled.div
        role="listbox"
        aria-label={t("taxonomy.topics.title")}
        display="contents"
      >
        {visibleTopics.map((topic) => (
          <CategoryRow
            key={topic.id}
            name={topic.name}
            active={topic.active}
            inactiveLabel={t("inactiveChip")}
            toggleLabel={`${
              topic.active
                ? t("taxonomy.topics.deactivateAction")
                : t("taxonomy.topics.reactivateAction")
            }: ${topic.name}`}
            onToggle={(next) =>
              next
                ? updateTopic({ id: topic.id, active: true })
                : setPendingDeactivation(topic)
            }
            selected={topic.id === selectedTopicId}
            onSelect={() => onSelectTopic(topic.id)}
          />
        ))}
      </styled.div>

      {visibleTopics.length === 0 && (
        <styled.p textStyle="paragraph.sm.default" color="text.lighter">
          {query.trim()
            ? t("taxonomy.topics.noMatches")
            : t("taxonomy.topics.empty")}
        </styled.p>
      )}

      <DeactivateDialog
        open={pendingDeactivation !== null}
        onOpenChange={(open) => !open && setPendingDeactivation(null)}
        title={t("taxonomy.topics.deactivateConfirmTitle")}
        name={pendingDeactivation?.name ?? ""}
        usageCount={usage?.count}
        isUsageLoading={isUsageLoading}
        body={t("taxonomy.topics.deactivateBody")}
        onConfirm={() =>
          pendingDeactivation &&
          updateTopic({ id: pendingDeactivation.id, active: false })
        }
      />
    </PanelSurface>
  );
}
