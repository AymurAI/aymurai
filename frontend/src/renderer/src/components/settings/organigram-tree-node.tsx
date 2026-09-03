import { CaretUp } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { css, cx } from "@/styled/css";
import { HStack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";

const caret = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  w: "5",
  h: "5",
  p: "0",
  flexShrink: "0",
  border: "[none]",
  bg: "[transparent]",
  color: "text.lighter",
  borderRadius: "sm",
  cursor: "pointer",
  transition: "transform",
  transitionDuration: "[0.2s]",
  transitionTimingFunction: "[ease]",
  _hover: { bg: "bg.secondary-highlight" },
});

const nodeRow = css({
  flex: "1",
  minW: "0",
  minH: "8",
  px: "2",
  py: "1",
  gap: "2",
  borderRadius: "sm",
  borderLeft: "[4px solid transparent]",
  cursor: "pointer",
  transition: "[background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "bg.primary-alternative" },
});

const selectedRow = css({
  bg: "bg.primary-alternative",
  borderLeftColor: "brand.primary",
});

const sectorChip = css({
  textStyle: "paragraph.xsm.strong",
  textTransform: "uppercase",
  letterSpacing: "[0.04em]",
  color: "brand.primary",
  bg: "bg.primary-alternative",
  borderRadius: "full",
  px: "2",
  py: "0.5",
  flexShrink: "0",
});

/** Indent per tree level, in px — matches the 20px caret column. */
const INDENT_STEP = 20;

interface OrganigramTreeNodeProps {
  unit: OrganigramUnit;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  canToggle: boolean;
  childCount: number;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

/**
 * One flattened row of the organigram tree. Expansion state lives in
 * `organigram-tree.tsx`, so this stays presentational.
 */
export default function OrganigramTreeNode({
  unit,
  depth,
  hasChildren,
  expanded,
  canToggle,
  childCount,
  selected,
  onToggle,
  onSelect,
}: OrganigramTreeNodeProps) {
  const { t } = useTranslation("settings");
  const label = unit.short_name ?? unit.name;
  const showCaret = hasChildren && canToggle;

  return (
    <HStack gap="1" flexShrink="0" style={{ paddingLeft: depth * INDENT_STEP }}>
      {showCaret ? (
        <styled.button
          type="button"
          className={caret}
          style={{ transform: expanded ? "rotate(0deg)" : "rotate(180deg)" }}
          aria-label={`${
            expanded
              ? t("organigram.tree.collapseAction")
              : t("organigram.tree.expandAction")
          }: ${label}`}
          onClick={onToggle}
        >
          <CaretUp size={16} />
        </styled.button>
      ) : (
        <styled.span w="5" h="5" flexShrink="0" />
      )}

      <HStack
        justify="space-between"
        className={cx(nodeRow, selected && selectedRow)}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
      >
        {/* Unit names reach ~104 characters and the tree indents 7 levels
            deep, so rows stay single-line and truncate; the full name is in
            the `title` and in the detail panel once selected. */}
        <styled.span
          textStyle={selected ? "paragraph.sm.strong" : "paragraph.sm.default"}
          color="text.default"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          title={unit.name}
        >
          {unit.acronym ? `${label} (${unit.acronym})` : label}
        </styled.span>

        <HStack gap="2" flexShrink="0">
          {unit.is_sector && (
            <styled.span className={sectorChip}>
              {t("organigram.tree.sectorChip")}
            </styled.span>
          )}
          {hasChildren && !expanded && (
            <styled.span textStyle="label.sm.default" color="text.lighter">
              {childCount}
            </styled.span>
          )}
        </HStack>
      </HStack>
    </HStack>
  );
}
