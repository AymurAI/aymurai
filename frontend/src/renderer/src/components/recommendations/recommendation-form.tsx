import {
  Radio,
  Select,
  TextField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@aymurai/ui";
import { Trash } from "phosphor-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import DecisionTabs from "@/components/decision-tabs";
import RadioGroup from "@/components/radio/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useRecommendationForm } from "@/hooks/useRecommendationForm";
import { css } from "@/styled/css";
import { Stack, styled } from "@/styled/jsx";
import type {
  DataExtractionPrediction,
  FormOption,
  RecommendationValidation,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import { RecipientFields } from "./recipient-fields";
import { ValidatedTextField } from "./validated-text-field";

export interface RecommendationFormProps {
  prediction: DataExtractionPrediction;
  validation: RecommendationValidation | null;
  /**
   * Reports the current save payload every time the person edits a field —
   * lets the hosting screen (Task 13's `<RecommendationValidation>`) submit
   * what's actually on screen instead of the raw model inference. Mirrors
   * the historical desktop-app's `onValuesChange` callback
   * (`recomendacion-form.tsx`), which fed the same shape up via an
   * identical `useEffect`.
   */
  onValuesChange?: (payload: RecommendationValidationInput) => void;
}

const removeRecipientButton = css({
  display: "flex",
  alignItems: "center",
  gap: "1",
  alignSelf: "flex-start",
  p: "0",
  border: "[none]",
  bg: "[transparent]",
  color: "system.error",
  textStyle: "label.sm.default",
  cursor: "pointer",
  _focusVisible: { outline: "[2px solid token(colors.text.default)]" },
});

const errorText = css({
  textStyle: "label.sm.default",
  color: "system.error",
});

/**
 * `TextField` narrows `type` to text|number, but forwards the value straight
 * onto its `<input>` -- matches `holder-correct-dialog.tsx`'s identical cast
 * for the same reason (a native date input, not a custom picker).
 */
const DATE_TYPE = "date" as "text";

/** `value` the model returned isn't among `options`' non-flagged entries —
 *  i.e. it's the out-of-catalog extra `useRecommendationForm` appended. */
function isOutOfCatalog(options: FormOption[], value: string | null): boolean {
  if (!value) return false;
  return options.some(
    (option) => option.value === value && option.outOfCatalog,
  );
}

function toSelectOptions(options: FormOption[]) {
  return options.map((option) => ({ id: option.value, text: option.label }));
}

/**
 * The Recomendaciones validation form: owns `useRecommendationForm` (the
 * single source of truth for edits) and renders every field.
 *
 * Ported from the historical desktop-app (`recomendacion-form.tsx` +
 * `destinatario-fields.tsx`, branch `feat/recomendaciones-defensoria`).
 * Per-recipient fields (name/position/the organigram unit selector/
 * is_primary/macro_sector) live in `<RecipientFields>` (Task 12) — Task 11
 * had folded them inline here instead, since its own brief listed only this
 * file and `recipient-fields.tsx` didn't exist yet; Task 12 built that
 * component but, by the same file-list logic, didn't wire it in here either.
 * This fix round closes that gap.
 *
 * `<RecipientFields>` needs the selected recipient's `sector_candidates`
 * (Task 6's `OrganigramCandidate[]`, empty for a non-GCBA recipient by
 * design), which only `prediction.recipients` carries -- `values`/
 * `suggestions` (from the hook) are shaped as `RecipientFormValues` and don't
 * carry it. Looked up by `source_index` (never array position -- a deleted
 * recipient shifts every later index), falling back to `[]` for a hand-added
 * recipient (`source_index === null`) or one whose index no longer resolves.
 *
 * The recommendation date is a single native `type="date"` picker, seeded
 * from the model's raw prose via `parseSpanishProseDate` and overridable by
 * the person -- that override wins over the backend's own auto-parse. The
 * raw prose itself (`recommendation_date_text`) is never re-edited here
 * (PLAN.md §D.3: conserved verbatim) but surfaces as a hover tooltip on the
 * date field for context. `personal_data` is tri-state: `RadioGroup` starts
 * with neither radio marked when it's `null` ("sin responder").
 *
 * The existing `DecisionTabs` (ported earlier, for a different flow) has no
 * remove affordance, so a small dedicated button sits beside it instead of
 * modifying that shared component.
 */
export default function RecommendationForm({
  prediction,
  validation,
  onValuesChange,
}: RecommendationFormProps) {
  const { t } = useTranslation("recommendations");
  const {
    values,
    suggestions,
    setValue,
    setRecipient,
    addRecipient,
    removeRecipient,
    topicOptions,
    subtopicOptions,
    macroSectorOptions,
    toPayload,
  } = useRecommendationForm(prediction, validation);

  // Fires on mount (with the seeded values) and again on every subsequent
  // edit -- `toPayload` (memoized on `values` in `useRecommendationForm`) is
  // a stable dependency, so this only re-runs when the person actually
  // changes something, not on every unrelated re-render.
  useEffect(() => {
    onValuesChange?.(toPayload());
  }, [toPayload, onValuesChange]);

  const [selectedTab, setSelectedTab] = useState(0);
  const selectedIndex = Math.min(selectedTab, values.recipients.length - 1);
  const selectedRecipient = values.recipients[selectedIndex];
  const suggestedRecipient = suggestions.recipients[selectedIndex];

  const handleAddRecipient = () => {
    const newIndex = values.recipients.length;
    addRecipient();
    setSelectedTab(newIndex);
  };

  const handleRemoveRecipient = () => {
    removeRecipient(selectedIndex);
    setSelectedTab((current) =>
      Math.max(0, Math.min(current, values.recipients.length - 2)),
    );
  };

  const topicOutOfCatalog = isOutOfCatalog(topicOptions, values.topic);
  const subtopicOutOfCatalog = isOutOfCatalog(subtopicOptions, values.subtopic);

  // `RecipientFields` needs the raw `sector_candidates` for the selected
  // recipient -- absent from `values`/`suggestions` (`RecipientFormValues`
  // has no candidates field), so this reads `prediction` directly, paired by
  // `source_index` per the hook's own pairing rule (never array position).
  const selectedRecipientCandidates = selectedRecipient
    ? (prediction.recipients[selectedRecipient.source_index ?? -1]
        ?.sector_candidates ?? [])
    : [];

  return (
    <Stack gap="8">
      <ValidatedTextField
        label={t("validation.recommendationNumber")}
        value={values.recommendation_number ?? ""}
        suggestion={suggestions.recommendation_number}
        onChange={(value) => setValue("recommendation_number", value)}
      />

      {(() => {
        const dateField = (
          <TextField
            label={t("validation.recommendationDate")}
            type={DATE_TYPE}
            value={values.recommendation_date ?? ""}
            onChange={(event) =>
              setValue("recommendation_date", event.target.value || null)
            }
          />
        );
        // The raw prose the model returned is never re-edited from here --
        // per PLAN.md §D.3 it's always conserved verbatim -- but it's the
        // whole reason the parsed date looks the way it does, so it's worth
        // surfacing as context rather than a second editable field.
        return values.recommendation_date_text ? (
          <Tooltip>
            <TooltipTrigger asChild>{dateField}</TooltipTrigger>
            <TooltipContent side="top">
              {t("validation.recommendationDateRaw")}:{" "}
              {values.recommendation_date_text}
            </TooltipContent>
          </Tooltip>
        ) : (
          dateField
        );
      })()}

      <Stack gap="4">
        <DecisionTabs
          selected={selectedIndex}
          decisionAmount={values.recipients.length}
          addDecision={handleAddRecipient}
          selectDecision={setSelectedTab}
        />
        {values.recipients.length > 1 && (
          <styled.button
            type="button"
            className={removeRecipientButton}
            onClick={handleRemoveRecipient}
          >
            <Trash size={14} />
            {t("validation.removeRecipient")}
          </styled.button>
        )}

        {selectedRecipient && (
          <RecipientFields
            index={selectedIndex}
            value={selectedRecipient}
            suggestion={suggestedRecipient}
            candidates={selectedRecipientCandidates}
            macroSectorOptions={macroSectorOptions}
            onChange={(patch) => setRecipient(selectedIndex, patch)}
          />
        )}
      </Stack>

      <Stack gap="1">
        <Select
          label={t("validation.topic")}
          options={toSelectOptions(topicOptions)}
          value={values.topic ?? undefined}
          suggestion={suggestions.topic ? { id: suggestions.topic } : undefined}
          onChange={(option) => setValue("topic", option.id)}
        />
        {topicOutOfCatalog && (
          <p className={errorText}>{t("validation.topicOutOfCatalog")}</p>
        )}
      </Stack>

      <Stack gap="1">
        <Select
          label={t("validation.subtopic")}
          options={toSelectOptions(subtopicOptions)}
          value={values.subtopic ?? undefined}
          suggestion={
            suggestions.subtopic ? { id: suggestions.subtopic } : undefined
          }
          onChange={(option) => setValue("subtopic", option.id)}
        />
        {subtopicOutOfCatalog && (
          <p className={errorText}>{t("validation.subtopicOutOfCatalog")}</p>
        )}
      </Stack>

      {/* Tri-state (Task 11 brief, §Step 6): `null` means "sin responder" —
          neither radio marked, not a third selectable option (matching the
          historical form's exact same 2-radio Sí/No pair). */}
      <RadioGroup label={t("validation.personalData")} name="personal-data">
        <Radio
          checked={values.personal_data === true}
          onChange={() => setValue("personal_data", true)}
        >
          {t("validation.personalDataYes")}
        </Radio>
        <Radio
          checked={values.personal_data === false}
          onChange={() => setValue("personal_data", false)}
        >
          {t("validation.personalDataNo")}
        </Radio>
      </RadioGroup>

      <Textarea
        label={t("validation.publishableContent")}
        value={values.publishable_content}
        onChange={(event) =>
          setValue("publishable_content", event.target.value)
        }
      />
    </Stack>
  );
}
