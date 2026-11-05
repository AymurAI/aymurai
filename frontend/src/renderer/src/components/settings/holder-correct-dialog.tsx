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
import { Stack, styled } from "@/styled/jsx";
import type { OrganigramHolder } from "@/types/organigram";
import { holderDateInputValue } from "./holder-format";

// See deactivate-dialog.tsx for why the primitives come from `@aymurai/ui`.

/**
 * `TextField` narrows `type` to text|number, but it forwards the value
 * straight onto its `<input>` — so a native date picker gets the library's
 * exact field styling instead of a bespoke lookalike. Cast at this one site;
 * `holder-correct-dialog.test.tsx` asserts the input really is a date input,
 * so a library change that stops forwarding it fails loudly.
 */
const DATE_TYPE = "date" as "text";

export interface HolderCorrection {
  name?: string;
  start_date?: string;
}

interface HolderCorrectDialogProps {
  /** The holder being corrected; `null` closes the dialog. */
  holder: OrganigramHolder | null;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  /** Receives only the fields that actually changed. */
  onConfirm: (correction: HolderCorrection) => void;
}

/**
 * Corrects a holder's record without implying a change of office: neither the
 * name nor the term date moves the holder in or out of `is_current`, and
 * nothing is added to the history.
 *
 * The date is here because the term start and the row's creation date are
 * different facts — entering a real history means recording when someone
 * actually took charge, years before the record was written.
 */
export default function HolderCorrectDialog({
  holder,
  onOpenChange,
  isPending,
  onConfirm,
}: HolderCorrectDialogProps) {
  const { t } = useTranslation("settings");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");

  // The dialog stays mounted between openings, so both fields have to be
  // reseeded when it reopens on a different holder.
  useEffect(() => {
    if (!holder) return;
    setName(holder.name);
    setStartDate(holderDateInputValue(holder));
  }, [holder]);

  const trimmedName = name.trim();
  const originalDate = holder ? holderDateInputValue(holder) : "";
  const nameChanged = Boolean(trimmedName) && trimmedName !== holder?.name;
  const dateChanged = Boolean(startDate) && startDate !== originalDate;

  const submit = () => {
    if (!nameChanged && !dateChanged) return;
    onConfirm({
      ...(nameChanged ? { name: trimmedName } : {}),
      ...(dateChanged ? { start_date: startDate } : {}),
    });
  };

  return (
    <Dialog open={holder !== null} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t("organigram.detail.renameHolderTitle")}</DialogTitle>
        </DialogHeader>

        {/* `DialogHeader` lays title and aside out in a row, which squeezes a
            long title into a narrow column — this explanation goes in the
            body instead. */}
        <styled.p textStyle="paragraph.sm.default" color="text.lighter" mb="4">
          {t("organigram.detail.renameHolderBody")}
        </styled.p>

        <Stack gap="4">
          <TextField
            label={t("organigram.detail.newHolderNameLabel")}
            placeholder={t("organigram.detail.newHolderPlaceholder")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />

          <TextField
            label={t("organigram.detail.holderStartLabel")}
            helper={t("organigram.detail.holderStartHelper")}
            type={DATE_TYPE}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
          />
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
            disabled={!nameChanged && !dateChanged}
            onClick={submit}
          >
            {t("organigram.detail.renameHolderSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
