import { Callout, Radio } from "@aymurai/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import RadioGroup from "@/components/radio/radio-group";
import { listUnits } from "@/services/aymurai/organigram";
import { Stack } from "@/styled/jsx";
import { GCBA_MACRO_SECTOR_CODE } from "@/types/catalogs";
import type {
  FormOption,
  OrganigramCandidate,
  OrganigramUnitCandidate,
  RecipientFormValues,
} from "@/types/dataExtraction";
import { hasSectorMismatch } from "@/utils/recommendations/recipient-sector-consistency";
import { RecipientSectorCombobox } from "./recipient-sector-combobox";
import { RecipientUnitCombobox } from "./recipient-unit-combobox";
import { ValidatedSelectField } from "./validated-select-field";
import { ValidatedTextField } from "./validated-text-field";

export interface RecipientFieldsProps {
  /** Index into `values.recipients` -- used only to key the `is_primary`
   *  radio group's `name` so several recipients rendered together (or
   *  reordered) never collide, matching the historical `principal-${id}`
   *  convention. */
  index: number;
  value: RecipientFormValues;
  /** Frozen inference for this same recipient, if any -- a hand-added
   *  recipient has none (`useRecommendationForm`'s empty stand-in). */
  suggestion?: RecipientFormValues;
  /** This recipient's `sector_candidates` (Task 6) -- already consistent
   *  (unit, sector) pairs by construction. Empty for a non-GCBA recipient,
   *  by design (server never ranks organigram units outside GCBA). */
  candidates: OrganigramCandidate[];
  /** The cargo's ranked units, uncollapsed -- used to order the unit field
   *  once a sector narrows it. */
  unitCandidates?: OrganigramUnitCandidate[];
  /** Active macro sectors + any out-of-catalog value, from
   *  `useRecommendationForm`. */
  macroSectorOptions: FormOption[];
  onChange: (patch: Partial<RecipientFormValues>) => void;
}

/**
 * Editable fields for a single recipient, in display order: `macro_sector`,
 * `name`, `position`, the organigram unit, then `is_primary`.
 *
 * Ported from the historical desktop-app's `DestinatarioFields`
 * (`destinatario-fields.tsx`, branch `feat/recomendaciones-defensoria`,
 * post-`fdabef8` -- the commit that removed the two independent
 * `OrganigramPicker`s wired to `name`/`position` after the product owner
 * found they added no value: each wrote plain text back into a free-text
 * field, with no way to keep `unit_id`/`sector_id` consistent (ADR-0009).
 * `<RecipientUnitCombobox>` replaces that removed affordance with a single
 * reference-emitting combobox instead of reintroducing it -- rendered only
 * for a GCBA recipient (the only sector the organigram cross-check covers),
 * hidden rather than cleared otherwise so a prior pick survives an
 * accidental sector toggle.
 *
 * `sectores.ts`'s hardcoded `SECTOR_OPTIONS` is replaced by
 * `macroSectorOptions` (from `useRecommendationForm`, backed by
 * `listMacroSectors()`) -- the same keep-and-flag treatment the historical
 * form gave an out-of-list `sector`.
 *
 * `is_primary` stays a plain boolean radio pair (matching the historical
 * `destinatario_principal`), scoped `name={`is-primary-${index}`}` per
 * recipient so marking one recipient principal never un-marks another --
 * several recipients may be primary at once, as in the historical form.
 */
export function RecipientFields({
  index,
  value,
  suggestion,
  candidates,
  unitCandidates,
  macroSectorOptions,
  onChange,
}: RecipientFieldsProps) {
  const { t } = useTranslation("recommendations");
  const unitsQuery = useQuery(listUnits());

  // What the Ámbito field currently OFFERS, not what has been validated:
  // like every other field here it starts blank with the model's guess on a
  // clickable mark, and gating the organigram fields on the validated value
  // alone would hide them until that one mark was clicked -- an ordering
  // this form doesn't impose anywhere else. Validating a non-GCBA ámbito
  // takes over immediately and hides them (the prior pick survives hidden,
  // per the note above, rather than being cleared).
  const isGcba =
    (value.macro_sector ?? suggestion?.macro_sector) === GCBA_MACRO_SECTOR_CODE;
  const sectorMismatch = hasSectorMismatch(value, unitsQuery.data);

  return (
    <Stack gap="4">
      <ValidatedSelectField
        label={t("validation.macroSector")}
        options={macroSectorOptions}
        value={value.macro_sector}
        suggestion={suggestion?.macro_sector}
        outOfCatalogMessage={t("validation.macroSectorOutOfCatalog")}
        onChange={(macro_sector) => onChange({ macro_sector })}
      />

      <ValidatedTextField
        label={t("validation.name")}
        value={value.name ?? ""}
        suggestion={suggestion?.name}
        onChange={(name) => onChange({ name })}
      />

      <ValidatedTextField
        label={t("validation.position")}
        value={value.position ?? ""}
        suggestion={suggestion?.position}
        onChange={(position) => onChange({ position })}
      />

      {isGcba && (
        <>
          <RecipientUnitCombobox
            label={t("validation.unit")}
            candidates={candidates}
            unitId={value.unit_id}
            suggestion={
              suggestion?.unit_id
                ? {
                    unit_id: suggestion.unit_id,
                    sector_id: suggestion.sector_id,
                  }
                : undefined
            }
            unitCandidates={unitCandidates}
            // The sector leads: once there is one, the unit is chosen inside
            // it. That keeps every pair consistent by construction, and makes
            // the mismatch state reachable only by editing the sector after
            // the unit -- which is exactly when the warning below fires.
            restrictToSectorId={value.sector_id}
            onChange={(picked) =>
              onChange({ unit_id: picked.unit_id, sector_id: picked.sector_id })
            }
          />

          <Stack gap="1">
            <RecipientSectorCombobox
              label={t("validation.sector")}
              candidates={candidates}
              sectorId={value.sector_id}
              suggestedSectorId={suggestion?.sector_id}
              // Validating a sector by hand never rewrites the unit -- that
              // would silently discard what the cargo actually said. The pair
              // is reported as inconsistent instead, and the unit picker
              // narrows until the person resolves it themselves.
              onChange={(sector_id) => onChange({ sector_id })}
            />
            {sectorMismatch && (
              <Callout
                message={t("validation.sectorMismatch")}
                variant="warning"
                role="alert"
              />
            )}
          </Stack>
        </>
      )}

      <RadioGroup
        label={t("validation.isPrimary")}
        name={`is-primary-${index}`}
      >
        <Radio
          checked={value.is_primary === true}
          onChange={() => onChange({ is_primary: true })}
        >
          {t("validation.isPrimaryYes")}
        </Radio>
        <Radio
          checked={value.is_primary === false}
          onChange={() => onChange({ is_primary: false })}
        >
          {t("validation.isPrimaryNo")}
        </Radio>
      </RadioGroup>
    </Stack>
  );
}
