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

interface UnitDeactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Units below this one in the tree — deactivation does not cascade. */
  dependentCount: number;
  isPending: boolean;
  onConfirm: () => void;
}

/**
 * Confirms taking a unit out of use. The backend's delete is logical
 * (`active=false`) and deliberately does not cascade, so the dependants stay
 * active under a deactivated parent — which the reader has to be told.
 */
export default function UnitDeactivateDialog({
  open,
  onOpenChange,
  dependentCount,
  isPending,
  onConfirm,
}: UnitDeactivateDialogProps) {
  const { t } = useTranslation("settings");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>
            {t("organigram.detail.deactivateConfirmTitle")}
          </DialogTitle>
        </DialogHeader>

        {dependentCount > 0 ? (
          <Callout
            variant="warning"
            message={t("organigram.detail.deactivateDependents", {
              count: dependentCount,
            })}
          />
        ) : (
          <styled.p textStyle="paragraph.sm.default" color="text.default">
            {t("organigram.detail.deactivateNoDependents")}
          </styled.p>
        )}

        <styled.p textStyle="paragraph.sm.default" color="text.lighter" mt="4">
          {t("organigram.detail.deactivateBody")}
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
          <Button
            type="button"
            size="sm"
            isLoading={isPending}
            onClick={onConfirm}
          >
            {t("confirmDeactivate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
