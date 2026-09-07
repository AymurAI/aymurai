import { Radio, Select, TextField } from "@aymurai/ui";
import { Trash } from "phosphor-react";
import { useState } from "react";
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
} from "@/types/dataExtraction";

export interface RecommendationFormProps {
  prediction: DataExtractionPrediction;
  validation: RecommendationValidation | null;
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
 * `destinatario-fields.tsx`, branch `feat/recomendaciones-defensoria`), with
 * the per-recipient fields folded into this one file rather than split into
 * a sibling component — Task 11's brief lists only this file, and recipients
 * here are addressed by array index (the hook's `setRecipient(index, patch)`)
 * rather than the historical per-recipient local id.
 *
 * `date` stays free text (the model returns prose like "22 de noviembre"),
 * never a date picker. `personal_data` is tri-state: `RadioGroup` starts
 * with neither radio marked when it's `null` ("sin responder").
 *
 * The existing `DecisionTabs` (ported earlier, for a different flow) has no
 * remove affordance, so a small dedicated button sits beside it instead of
 * modifying that shared component.
 */
export default function RecommendationForm({
  prediction,
  validation,
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
  } = useRecommendationForm(prediction, validation);

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
  const macroSectorOutOfCatalog = selectedRecipient
    ? isOutOfCatalog(macroSectorOptions, selectedRecipient.macro_sector)
    : false;

  return (
    <Stack gap="8">
      <TextField
        label={t("validation.recommendationNumber")}
        value={values.recommendation_number ?? ""}
        suggestion={suggestions.recommendation_number ?? undefined}
        onChange={(event) =>
          setValue("recommendation_number", event.target.value)
        }
      />

      <TextField
        label={t("validation.recommendationDate")}
        value={values.recommendation_date_text ?? ""}
        suggestion={suggestions.recommendation_date_text ?? undefined}
        onChange={(event) =>
          setValue("recommendation_date_text", event.target.value)
        }
      />

      <Stack gap="4">
        <Stack direction="row" gap="2" alignItems="center">
          <DecisionTabs
            selected={selectedIndex}
            decisionAmount={values.recipients.length}
            addDecision={handleAddRecipient}
            selectDecision={setSelectedTab}
          />
        </Stack>
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
          <Stack gap="4">
            <TextField
              label={t("validation.name")}
              value={selectedRecipient.name ?? ""}
              suggestion={suggestedRecipient?.name ?? undefined}
              onChange={(event) =>
                setRecipient(selectedIndex, { name: event.target.value })
              }
            />

            <TextField
              label={t("validation.position")}
              value={selectedRecipient.position ?? ""}
              suggestion={suggestedRecipient?.position ?? undefined}
              onChange={(event) =>
                setRecipient(selectedIndex, { position: event.target.value })
              }
            />

            <RadioGroup
              label={t("validation.isPrimary")}
              name={`is-primary-${selectedIndex}`}
            >
              <Radio
                checked={selectedRecipient.is_primary === true}
                onChange={() =>
                  setRecipient(selectedIndex, { is_primary: true })
                }
              >
                {t("validation.isPrimaryYes")}
              </Radio>
              <Radio
                checked={selectedRecipient.is_primary === false}
                onChange={() =>
                  setRecipient(selectedIndex, { is_primary: false })
                }
              >
                {t("validation.isPrimaryNo")}
              </Radio>
            </RadioGroup>

            <Stack gap="1">
              <Select
                label={t("validation.macroSector")}
                options={toSelectOptions(macroSectorOptions)}
                value={selectedRecipient.macro_sector ?? undefined}
                suggestion={
                  suggestedRecipient?.macro_sector
                    ? { id: suggestedRecipient.macro_sector }
                    : undefined
                }
                onChange={(option) =>
                  setRecipient(selectedIndex, { macro_sector: option.id })
                }
              />
              {/* `Select` (@aymurai/ui) has no `error` prop, unlike
                  `TextField` — render the out-of-catalog notice as its own
                  text instead of silently discarding the model's value. */}
              {macroSectorOutOfCatalog && (
                <p className={errorText}>
                  {t("validation.macroSectorOutOfCatalog")}
                </p>
              )}
            </Stack>
          </Stack>
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
