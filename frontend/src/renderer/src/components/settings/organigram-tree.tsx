import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import SidePanelColumn from "@/components/layout/side-panel-column";
import { Stack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";
import OrganigramTreeNode from "./organigram-tree-node";

interface OrganigramTreeProps {
  units: OrganigramUnit[];
  selectedUnitId: string | null;
  onSelect: (unitId: string) => void;
}

export default function OrganigramTree({
  units,
  selectedUnitId,
  onSelect,
}: OrganigramTreeProps) {
  const { t } = useTranslation("settings");

  const { roots, childrenByParent } = useMemo(() => {
    const byParent = new Map<string, OrganigramUnit[]>();
    for (const unit of units) {
      if (unit.parent_id === null) continue;
      const siblings = byParent.get(unit.parent_id) ?? [];
      siblings.push(unit);
      byParent.set(unit.parent_id, siblings);
    }
    return {
      roots: units.filter((u) => u.parent_id === null),
      childrenByParent: byParent,
    };
  }, [units]);

  return (
    <SidePanelColumn>
      <Stack gap="4" p="4">
        <styled.h2 textStyle="subtitle.md.strong">
          {t("organigram.tree.title")}
        </styled.h2>
        {roots.length === 0 && <p>{t("organigram.tree.empty")}</p>}
        {roots.map((root) => (
          <OrganigramTreeNode
            key={root.id}
            unit={root}
            childrenByParent={childrenByParent}
            selectedUnitId={selectedUnitId}
            onSelect={onSelect}
          />
        ))}
      </Stack>
    </SidePanelColumn>
  );
}
