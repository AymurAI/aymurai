import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  TextField,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@aymurai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowsLeftRight, Plus } from "phosphor-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { showToast } from "@/features/showToast";
import { catalogsService } from "@/services/aymurai";
import { css } from "@/styled/css";
import { HStack, styled } from "@/styled/jsx";
import type { Subtopic } from "@/types/catalogs";
import CategoryRow from "./category-row";
import DeactivateDialog from "./deactivate-dialog";
import EmptySelection from "./empty-selection";
import PanelSurface from "./panel-surface";

// See deactivate-dialog.tsx for why the primitives come from `@aymurai/ui`.

/** `ToolButton`'s square, per `@aymurai/ui`'s 28px/6px-radius action button. */
const reassignButton = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  w: "[28px]",
  h: "[28px]",
  p: "0.5",
  borderRadius: "[6px]",
  bg: "brand.primary",
  color: "text.onbutton-alternative",
  cursor: "pointer",
  transition: "[background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "action.hover" },
  _focusVisible: { outline: "[2px solid token(colors.text.default)]" },
});

const NO_TARGET = "none";

interface SubtopicsPanelProps {
  topicId: string | null;
  topicName: string | null;
}

export default function SubtopicsPanel({
  topicId,
  topicName,
}: SubtopicsPanelProps) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();

  const { data: subtopics = [] } = useQuery({
    ...catalogsService.listSubtopics(topicId ?? ""),
    enabled: topicId !== null,
  });

  const [reassigning, setReassigning] = useState<Subtopic | null>(null);
  const [reassignTarget, setReassignTarget] = useState<string>(NO_TARGET);
  const [newSubtopicName, setNewSubtopicName] = useState("");
  const [pendingDeactivation, setPendingDeactivation] =
    useState<Subtopic | null>(null);

  // One usage query serves both dialogs — only one can be open at a time, and
  // both need the same number for the same subtopic. See topics-panel.tsx on
  // `isLoading` vs `isPending`.
  const usageSubtopic = pendingDeactivation ?? reassigning;
  const { data: usage, isLoading: isUsageLoading } = useQuery({
    ...catalogsService.subtopicUsage(usageSubtopic?.id ?? ""),
    enabled: usageSubtopic !== null,
  });

  // Invalidate via the factory's own queryKey rather than a hardcoded
  // `["subtopics", topicId]` literal — the real `catalogsService.listSubtopics`
  // keys on `["subtopics", api.defaults.baseURL, topicId]` (see
  // services/aymurai/catalogs.ts), so a two-element literal would silently fail
  // to partial-match that three-element key and never invalidate in production.
  const subtopicsQueryKey = catalogsService.listSubtopics(
    topicId ?? "",
  ).queryKey;
  const invalidateSubtopics = () =>
    queryClient.invalidateQueries({ queryKey: subtopicsQueryKey });

  const { mutate: updateSubtopic } = useMutation({
    ...catalogsService.updateSubtopic(),
    onSuccess: (subtopic) => {
      invalidateSubtopics();
      setPendingDeactivation(null);
      showToast(
        subtopic.active
          ? t("taxonomy.subtopics.reactivatedToast", { name: subtopic.name })
          : t("taxonomy.subtopics.deactivatedToast", { name: subtopic.name }),
        "success",
      );
    },
  });

  const { mutate: reassignSubtopic } = useMutation({
    ...catalogsService.reassignSubtopic(),
    // The response carries how many rows actually moved, so the toast reports
    // the server's number rather than the count the dialog happened to show.
    onSuccess: (result) => {
      invalidateSubtopics();
      const target = subtopics.find((s) => s.id === reassignTarget);
      showToast(
        t("taxonomy.subtopics.reassignedToast", {
          count: result.reassigned,
          name: target?.name ?? "",
        }),
        "success",
      );
      setReassigning(null);
      setReassignTarget(NO_TARGET);
    },
  });

  const { mutate: createSubtopic } = useMutation({
    ...catalogsService.createSubtopic(),
    onSuccess: (subtopic) => {
      invalidateSubtopics();
      setNewSubtopicName("");
      showToast(
        t("taxonomy.subtopics.createdToast", { name: subtopic.name }),
        "success",
      );
    },
  });

  const submitNewSubtopic = () => {
    const name = newSubtopicName.trim();
    if (!name || !topicId) return;
    createSubtopic({
      topic_id: topicId,
      name,
      code: null,
      order: subtopics.length + 1,
    });
  };

  if (topicId === null) {
    return <EmptySelection message={t("taxonomy.subtopics.empty")} />;
  }

  const reassignOptions = subtopics
    .filter((s) => s.id !== reassigning?.id && s.active)
    .map((s) => ({ id: s.id, text: s.name }));

  return (
    <PanelSurface
      title={t("taxonomy.subtopics.title")}
      subtitle={topicName ?? undefined}
      headerAside={
        <styled.span
          textStyle="label.sm.default"
          color="text.lighter"
          whiteSpace="nowrap"
        >
          {t("taxonomy.subtopics.count", { count: subtopics.length })}
        </styled.span>
      }
      footer={
        <HStack gap="2" alignItems="flex-end">
          <TextField
            aria-label={t("taxonomy.subtopics.nameLabel")}
            placeholder={t("taxonomy.subtopics.newPlaceholder")}
            value={newSubtopicName}
            onChange={(event) => setNewSubtopicName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitNewSubtopic();
            }}
          />
          <Button
            type="button"
            onClick={submitNewSubtopic}
            disabled={!newSubtopicName.trim()}
          >
            <Plus size={16} />
            {t("taxonomy.subtopics.addAction")}
          </Button>
        </HStack>
      }
    >
      <TooltipProvider>
        {subtopics.map((subtopic) => (
          <CategoryRow
            key={subtopic.id}
            name={subtopic.name}
            active={subtopic.active}
            inactiveLabel={t("inactiveChip")}
            toggleLabel={`${
              subtopic.active
                ? t("taxonomy.subtopics.deactivateAction")
                : t("taxonomy.subtopics.reactivateAction")
            }: ${subtopic.name}`}
            onToggle={(next) =>
              next
                ? updateSubtopic({ id: subtopic.id, active: true })
                : setPendingDeactivation(subtopic)
            }
            actions={
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className={reassignButton}
                    aria-label={`${t("taxonomy.subtopics.reassignAction")}: ${subtopic.name}`}
                    onClick={() => {
                      setReassignTarget(NO_TARGET);
                      setReassigning(subtopic);
                    }}
                  >
                    <ArrowsLeftRight size={20} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {t("taxonomy.subtopics.reassignAction")}
                </TooltipContent>
              </Tooltip>
            }
          />
        ))}
      </TooltipProvider>

      {subtopics.length === 0 && (
        <styled.p textStyle="paragraph.sm.default" color="text.lighter">
          {t("taxonomy.subtopics.none")}
        </styled.p>
      )}

      <Dialog
        open={reassigning !== null}
        onOpenChange={(open) => !open && setReassigning(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("taxonomy.subtopics.reassignAction")}</DialogTitle>
            <styled.p textStyle="subtitle.sm.default" color="text.lighter">
              {isUsageLoading || usage === undefined
                ? t("taxonomy.usageLoading")
                : t("taxonomy.subtopics.reassignSubtitle", {
                    count: usage.count,
                    name: reassigning?.name ?? "",
                  })}
            </styled.p>
          </DialogHeader>

          <TooltipProvider>
            <Select
              label={t("taxonomy.subtopics.reassignTargetLabel")}
              placeholder={t("taxonomy.subtopics.reassignPlaceholder")}
              clearable={false}
              options={reassignOptions}
              value={reassignTarget}
              onChange={(option) => setReassignTarget(option.id)}
            />
          </TooltipProvider>

          <DialogFooter>
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              onClick={() => setReassigning(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={reassignTarget === NO_TARGET}
              onClick={() =>
                reassigning &&
                reassignTarget !== NO_TARGET &&
                reassignSubtopic({
                  id: reassigning.id,
                  target_subtopic_id: reassignTarget,
                })
              }
            >
              {t("taxonomy.subtopics.confirmReassign")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeactivateDialog
        open={pendingDeactivation !== null}
        onOpenChange={(open) => !open && setPendingDeactivation(null)}
        title={t("taxonomy.subtopics.deactivateConfirmTitle")}
        name={pendingDeactivation?.name ?? ""}
        usageCount={usage?.count}
        isUsageLoading={isUsageLoading}
        body={t("taxonomy.subtopics.deactivateBody")}
        onConfirm={() =>
          pendingDeactivation &&
          updateSubtopic({ id: pendingDeactivation.id, active: false })
        }
      />
    </PanelSurface>
  );
}
