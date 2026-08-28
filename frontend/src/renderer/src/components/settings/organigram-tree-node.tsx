import { CaretUp } from "phosphor-react";
import { useState } from "react";
import { css, cx } from "@/styled/css";
import { HStack, Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";

const caret = css({
  transition: "transform",
  transitionDuration: "[0.2s]",
  transitionTimingFunction: "[ease]",
  cursor: "pointer",
  display: "inline-flex",
  border: "[none]",
  bg: "[transparent]",
  p: "0",
  color: "[inherit]",
});

const nodeLabel = css({
  cursor: "pointer",
  px: "2",
  py: "1",
  borderRadius: "sm",
  _hover: { bg: "bg.primary-highlight" },
});

const selectedLabel = css({ bg: "bg.primary-highlight" });

interface OrganigramTreeNodeProps {
  unit: OrganigramUnit;
  childrenByParent: Map<string, OrganigramUnit[]>;
  selectedUnitId: string | null;
  onSelect: (unitId: string) => void;
}

export default function OrganigramTreeNode({
  unit,
  childrenByParent,
  selectedUnitId,
  onSelect,
}: OrganigramTreeNodeProps) {
  const [open, setOpen] = useState(true);
  const children = childrenByParent.get(unit.id) ?? [];

  return (
    <Stack gap="1">
      <HStack gap="1">
        {children.length > 0 ? (
          <styled.button
            type="button"
            className={caret}
            style={{ transform: open ? "rotate(0deg)" : "rotate(180deg)" }}
            aria-label={`${open ? "Contraer" : "Expandir"}: ${unit.short_name ?? unit.name}`}
            onClick={() => setOpen((v) => !v)}
          >
            <CaretUp size={16} />
          </styled.button>
        ) : (
          <div style={{ width: 16 }} />
        )}
        <styled.span
          className={cx(nodeLabel, unit.id === selectedUnitId && selectedLabel)}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(unit.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(unit.id);
            }
          }}
        >
          {unit.short_name ?? unit.name}
        </styled.span>
      </HStack>
      {open && children.length > 0 && (
        <Stack gap="1" pl="6">
          {children.map((child) => (
            <OrganigramTreeNode
              key={child.id}
              unit={child}
              childrenByParent={childrenByParent}
              selectedUnitId={selectedUnitId}
              onSelect={onSelect}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
