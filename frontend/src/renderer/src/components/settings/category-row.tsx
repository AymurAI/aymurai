import { Switch } from "@aymurai/ui";
import type { ReactNode } from "react";
import { css, cx } from "@/styled/css";
import { HStack, styled } from "@/styled/jsx";

const row = css({
  bg: "bg.secondary",
  borderRadius: "sm",
  borderLeft: "[4px solid transparent]",
  minH: "[40px]",
  // Rows are flex children of a scrolling column: without this they shrink
  // below their content and wrapped names overlap the row beneath.
  flexShrink: "0",
  px: "4",
  py: "2",
  gap: "2",
  transition: "[background-color 150ms cubic-bezier(0.4, 0, 0.2, 1)]",
  _hover: { bg: "bg.primary-alternative" },
});

const selectableRow = css({ cursor: "pointer" });

const selectedRow = css({
  bg: "bg.primary-alternative",
  borderLeftColor: "brand.primary",
});

const inactiveChip = css({
  textStyle: "paragraph.xsm.strong",
  textTransform: "uppercase",
  letterSpacing: "[0.04em]",
  color: "brand.tertiary",
  bg: "bg.secondary-highlight",
  borderRadius: "full",
  px: "2",
  py: "0.5",
  flexShrink: "0",
});

interface CategoryRowProps {
  name: string;
  active: boolean;
  /** Accessible name for the switch — must identify the row, not just "Activo". */
  toggleLabel: string;
  onToggle: (next: boolean) => void;
  inactiveLabel: string;
  selected?: boolean;
  onSelect?: () => void;
  /** Extra controls rendered between the count and the switch. */
  actions?: ReactNode;
}

/**
 * One taxonomy row, following `@aymurai/ui`'s `CategoryItem` (white 40px row +
 * trailing `Switch`). Deactivating is a switch rather than a text button because
 * `active` is a reversible flag on the record, not a delete — see
 * `schema/catalogs.ts`.
 */
export default function CategoryRow({
  name,
  active,
  toggleLabel,
  onToggle,
  inactiveLabel,
  selected = false,
  onSelect,
  actions,
}: CategoryRowProps) {
  const selectable = onSelect !== undefined;

  return (
    <HStack
      justify="space-between"
      className={cx(row, selectable && selectableRow, selected && selectedRow)}
      role={selectable ? "option" : undefined}
      aria-selected={selectable ? selected : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!selectable) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.();
        }
      }}
    >
      <HStack gap="2" alignItems="baseline" minW="0">
        {/* Real category names run to ~106 characters ("Orientación a turista
            en trámites en migraciones, sanidad de fronteras, aduana, AFIP,
            RENAPER y consulados"), so the row wraps rather than truncating —
            an ellipsis would hide the part that distinguishes siblings. */}
        <styled.span
          textStyle={selected ? "paragraph.sm.strong" : "paragraph.sm.default"}
          color={active ? "text.default" : "text.lighter"}
          textWrap="[pretty]"
        >
          {name}
        </styled.span>
      </HStack>

      {/* The row itself is selectable, so the controls stop both click and
          key events from bubbling into it — otherwise Enter on the switch
          would open the confirmation *and* switch the detail panel. */}
      <HStack
        gap="3"
        flexShrink="0"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {!active && (
          <styled.span className={inactiveChip}>{inactiveLabel}</styled.span>
        )}
        {actions}
        <Switch
          checked={active}
          onCheckedChange={onToggle}
          aria-label={toggleLabel}
        />
      </HStack>
    </HStack>
  );
}
