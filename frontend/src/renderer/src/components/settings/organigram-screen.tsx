import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { organigramService } from "@/services/aymurai";
import { Grid } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";
import OrganigramDetailPanel from "./organigram-detail-panel";
import OrganigramTree from "./organigram-tree";

export default function OrganigramScreen() {
  const { data: units = [] } = useQuery(organigramService.listUnits());
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId],
  );

  /** Root-first ancestor chain of the selection, for the detail breadcrumb. */
  const ancestors = useMemo(() => {
    if (!selectedUnit) return [];
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const chain: OrganigramUnit[] = [];
    let parentId = selectedUnit.parent_id;
    while (parentId !== null) {
      const parent = byId.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      parentId = parent.parent_id;
    }
    return chain;
  }, [units, selectedUnit]);

  return (
    <Grid
      // `gridTemplateColumns` has no token category in this preset (plain
      // CssProperties, per `.claude/rules/panda-css.md` and
      // `styled/types/style-props.d.ts`), so `strictTokens` doesn't force the
      // bracket escape here the way it does for `color`/`width`/etc — it's
      // used anyway so `token()` resolves inside the multi-value CSS list,
      // matching taxonomy-screen.tsx's precedent for this exact same
      // side-panel + detail layout shape.
      //
      // Responsive below `lg`: the master column is `SidePanelColumn`
      // (`components/layout/side-panel-column.tsx`), whose docblock assumes
      // its flex/grid parent switches to a single stacked column below `lg`
      // (Panda breakpoint) — exactly what `file-annotator/index.tsx` already
      // does for its own `SidePanelColumn` consumer via `flexDirection`.
      // Without this, `SidePanelColumn`'s below-`lg` styles (full width, 50%
      // max-height) never engage and the master panel stays pinned at
      // ~479px even on a narrow viewport.
      gridTemplateColumns={{
        base: "[1fr]",
        lg: "[token(sizes.panel.side) minmax(0, 1fr)]",
      }}
      gap="6"
      width="full"
      flex="1"
      minH="0"
    >
      <OrganigramTree
        units={units}
        selectedUnitId={selectedUnitId}
        onSelect={setSelectedUnitId}
      />
      <OrganigramDetailPanel unit={selectedUnit} ancestors={ancestors} />
    </Grid>
  );
}
