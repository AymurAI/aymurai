import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  TextField,
} from "@aymurai/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { styled } from "@/styled/jsx";

// See deactivate-dialog.tsx for why the primitives come from `@aymurai/ui`.

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Reassurance line: the record keeps its id, so tagged documents follow it. */
  body: string;
  label: string;
  /** Current name, and the value the field opens on. */
  currentName: string;
  isPending: boolean;
  /** Set when the API refused the new name — a sibling already carries it. */
  error?: string;
  onConfirm: (name: string) => void;
}

/**
 * Shared rename for a taxonomy category. Correcting a name in place is the
 * whole point: deactivating the old record and creating a new one would leave
 * every document tagged with the old id pointing at a retired category.
 */
export default function RenameDialog({
  open,
  onOpenChange,
  title,
  body,
  label,
  currentName,
  isPending,
  error,
  onConfirm,
}: RenameDialogProps) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState(currentName);

  // The dialog stays mounted between openings, so the field has to be reset
  // when it reopens on a different row — otherwise it shows the last edit.
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const unchanged = trimmed === currentName;
  const submit = () => {
    if (!trimmed || unchanged) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {/* `DialogHeader` lays title and aside out in a row, which squeezes a
            long title into a narrow column — the explanation goes here. */}
        <styled.p textStyle="paragraph.sm.default" color="text.lighter" mb="4">
          {body}
        </styled.p>

        <TextField
          label={label}
          value={name}
          error={error}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />

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
            disabled={!trimmed || unchanged}
            onClick={submit}
          >
            {t("renameSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
