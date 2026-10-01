import { Button } from "@aymurai/ui";
import { useQuery } from "@tanstack/react-query";
import { X } from "phosphor-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  listMacroSectors,
  listSubtopics,
  listTopics,
} from "@/services/aymurai/catalogs";
import { listUnits } from "@/services/aymurai/organigram";
import { css } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import { GCBA_MACRO_SECTOR_CODE } from "@/types/catalogs";
import { normalizeForSearch } from "@/utils/organigram/normalize-for-search";
import { OrganigramCombobox } from "./organigram-combobox";

const drawer = css({
  position: "absolute",
  top: "0",
  right: "0",
  bottom: "0",
  zIndex: "10",
  display: "flex",
  flexDirection: "column",
  width: { base: "full", sm: "panel.sideCompact", desktop: "panel.side" },
  maxWidth: "full",
  minH: "0",
  overflow: "hidden",
  bg: "bg.secondary",
  borderLeft: "card",
  boxShadow: "menu",
});

const panelHeader = css({
  flexShrink: "0",
  p: "5",
  borderBottom: "card",
  bg: "bg.secondary",
});

const panelBody = css({
  flex: "1",
  minH: "0",
  overflowY: "auto",
  p: "5",
  gap: "5",
});
const field = css({
  display: "flex",
  flexDirection: "column",
  gap: "1",
  textStyle: "label.sm.default",
  color: "text.lighter",
});
const control = css({
  width: "full",
  textStyle: "label.md.default",
  color: "text.default",
  bg: "bg.secondary",
  border: "primary",
  rounded: "sm",
  px: "3",
  h: "10",
  "&:focus-visible": {
    outline: "none",
    border: "primary-alt",
    boxShadow: "input-focus",
  },
});

export interface RecommendationsGridFilterValues {
  search: string;
  topicId: string;
  subtopicId: string;
  recipientSector: string;
  situation: string;
  status: string;
  publication: "all" | "yes" | "no" | "unanswered";
  dateFrom: string;
  dateTo: string;
  editedFrom: string;
  editedTo: string;
}

interface RecommendationsGridFiltersProps {
  values: RecommendationsGridFilterValues;
  situations: string[];
  statuses: string[];
  catalogsReady: boolean;
  onChange: (patch: Partial<RecommendationsGridFilterValues>) => void;
  onReset: () => void;
  onClose: () => void;
  isFiltered: boolean;
}

export default function RecommendationsGridFilters({
  values,
  situations,
  statuses,
  catalogsReady,
  onChange,
  onReset,
  onClose,
  isFiltered,
}: RecommendationsGridFiltersProps) {
  const { t } = useTranslation("recommendations");
  const ids = {
    topic: useId(),
    subtopic: useId(),
    dateFrom: useId(),
    dateTo: useId(),
    editedFrom: useId(),
    editedTo: useId(),
  };
  const topics = useQuery(listTopics());
  const subtopics = useQuery(listSubtopics());
  const macros = useQuery(listMacroSectors());
  const units = useQuery(listUnits());
  const sectorOptions = [
    ...(units.data ?? [])
      .filter((unit) => unit.is_sector)
      .map((unit) => ({ id: `sector:${unit.id}`, name: unit.name })),
    ...(macros.data ?? [])
      .filter((macro) => macro.code !== GCBA_MACRO_SECTOR_CODE)
      .map((macro) => ({ id: `macro:${macro.id}`, name: macro.name })),
  ];

  const select = (
    id: string,
    label: string,
    value: string,
    options: Array<{ id: string; name: string }>,
    onValue: (value: string) => void,
    disabled = false,
  ) => (
    <label className={field} htmlFor={id}>
      {label}
      <select
        id={id}
        className={control}
        value={value}
        disabled={disabled}
        onChange={(event) => onValue(event.target.value)}
      >
        <option value="">{t("grilla.filters.all")}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <aside aria-label={t("grilla.filters.title")} className={drawer}>
      <header className={panelHeader}>
        <HStack justify="space-between" alignItems="center" gap="3">
          <styled.h2 textStyle="title.md.strong">
            {t("grilla.filters.title")}
          </styled.h2>
          <HStack gap="2">
            <Button
              variant="tertiary"
              size="sm"
              onClick={onReset}
              disabled={!isFiltered}
            >
              {t("grilla.filters.reset")}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              aria-label={t("grilla.filters.close")}
              onClick={onClose}
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </HStack>
        </HStack>
      </header>

      <Stack className={panelBody} data-testid="recommendations-filter-body">
        {select(
          ids.topic,
          t("grilla.filters.topic"),
          values.topicId,
          (topics.data ?? []).map((topic) => ({
            id: topic.id,
            name: topic.name,
          })),
          (topicId) => onChange({ topicId }),
          topics.isLoading || topics.isError,
        )}
        {select(
          ids.subtopic,
          t("grilla.filters.subtopic"),
          values.subtopicId,
          (subtopics.data ?? []).map((subtopic) => ({
            id: subtopic.id,
            name: subtopic.name,
          })),
          (subtopicId) => onChange({ subtopicId }),
          subtopics.isLoading || subtopics.isError,
        )}

        <OrganigramCombobox
          label={t("grilla.filters.recipientSector")}
          placeholder={t("grilla.filters.sectorPlaceholder")}
          options={sectorOptions}
          emptyPrompt={t("grilla.filters.sectorPlaceholder")}
          selectedLabel={
            sectorOptions.find((option) => option.id === values.recipientSector)
              ?.name ?? null
          }
          hasValue={values.recipientSector !== ""}
          onPick={(recipientSector) => onChange({ recipientSector })}
          onClear={() => onChange({ recipientSector: "" })}
          search={{
            run: (query) =>
              sectorOptions.filter((option) =>
                normalizeForSearch(option.name).includes(
                  normalizeForSearch(query),
                ),
              ),
            isLoading: macros.isLoading || units.isLoading,
            isError: macros.isError || units.isError,
            loadingLabel: t("grilla.filters.catalogLoading"),
            errorLabel: t("grilla.filters.catalogFailed"),
          }}
        />

        {select(
          "recommendation-situation-filter",
          t("grilla.filters.situation"),
          values.situation,
          situations.map((value) => ({ id: value, name: value })),
          (situation) => onChange({ situation }),
          !catalogsReady,
        )}
        {select(
          "recommendation-status-filter",
          t("grilla.filters.status"),
          values.status,
          statuses.map((value) => ({ id: value, name: value })),
          (status) => onChange({ status }),
          !catalogsReady,
        )}

        <label className={field}>
          {t("grilla.filters.publication")}
          <select
            className={control}
            value={values.publication}
            onChange={(event) =>
              onChange({
                publication: event.target
                  .value as RecommendationsGridFilterValues["publication"],
              })
            }
          >
            <option value="all">{t("grilla.filters.all")}</option>
            <option value="yes">{t("grilla.approved.yes")}</option>
            <option value="no">{t("grilla.approved.no")}</option>
            <option value="unanswered">{t("grilla.filters.unanswered")}</option>
          </select>
        </label>

        {(
          [
            ["dateFrom", ids.dateFrom],
            ["dateTo", ids.dateTo],
            ["editedFrom", ids.editedFrom],
            ["editedTo", ids.editedTo],
          ] as const
        ).map(([name, id]) => (
          <label key={name} className={field} htmlFor={id}>
            {t(`grilla.filters.${name}`)}
            <input
              id={id}
              type="date"
              className={control}
              value={values[name]}
              onChange={(event) => onChange({ [name]: event.target.value })}
            />
          </label>
        ))}
      </Stack>
    </aside>
  );
}
