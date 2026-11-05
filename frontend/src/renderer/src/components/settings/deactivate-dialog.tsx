import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@aymurai/ui";
import { useTranslation } from "react-i18next";
import { styled } from "@/styled/jsx";

// `Dialog`/`Callout`/`Button` come from `@aymurai/ui` (which wraps
// `@radix-ui/react-dialog` internally) rather than a local `@/components/ui/*`
// module — that module doesn't exist in this repo, and `.claude/CLAUDE.md`
// documents Dialog as one of the primitives "consumed straight from
// `@aymurai/ui`". `@radix-ui/react-dialog` isn't a direct dependency here.

interface DeactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Name of the topic/subtopic being deactivated, quoted in the warning. */
  name: string;
  /** `undefined` while the usage request is in flight. */
  usageCount: number | undefined;
  isUsageLoading: boolean;
  /** Reassurance line explaining that existing records are untouched. */
  body: string;
  onConfirm: () => void;
}

/**
 * Shared confirmation for taking a taxonomy category out of use. The record
 * count is a `Callout` in `warning` only when something actually references the
 * category — at zero it is a plain line, since an amber warning reading
 * "0 registros" reads as alarming for a no-op.
 */
export default function DeactivateDialog({
  open,
  onOpenChange,
  title,
  name,
  usageCount,
  isUsageLoading,
  body,
  onConfirm,
}: DeactivateDialogProps) {
  const { t } = useTranslation("settings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {isUsageLoading || usageCount === undefined ? (
          <styled.p textStyle="paragraph.sm.default" color="text.lighter">
            {t("taxonomy.usageLoading")}
          </styled.p>
        ) : usageCount > 0 ? (
          <Callout
            variant="warning"
            message={t("taxonomy.usageWarning", { count: usageCount, name })}
          />
        ) : (
          <styled.p textStyle="paragraph.sm.default" color="text.default">
            {t("taxonomy.usageWarningNone", { name })}
          </styled.p>
        )}

        <styled.p textStyle="paragraph.sm.default" color="text.lighter" mt="4">
          {body}
        </styled.p>

        <DialogFooter>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t("cancel")}
          </Button>
          {/* Confirming before the count lands would defeat the point of the
              confirmation, so the action waits for it. */}
          <Button
            type="button"
            size="sm"
            disabled={isUsageLoading || usageCount === undefined}
            onClick={onConfirm}
          >
            {t("confirmDeactivate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
