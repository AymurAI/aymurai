import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { organigramService } from "@/services/aymurai";
import { Grid } from "@/styled/jsx";
import OrganigramDetailPanel from "./organigram-detail-panel";
import OrganigramTree from "./organigram-tree";

export default function OrganigramScreen() {
  const { data: units = [] } = useQuery(organigramService.listUnits());
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () => units.find((u) => u.id === selectedUnitId) ?? null,
    [units, selectedUnitId],
  );

  return (
    <Grid
      // `gridTemplateColumns` has no token category in this preset (plain
      // CssProperties, per `.claude/rules/panda-css.md` and
      // `styled/types/style-props.d.ts`), so `strictTokens` doesn't force the
      // bracket escape here the way it does for `color`/`width`/etc — it's
      // used anyway so `token()` resolves inside the multi-value CSS list,
      // matching taxonomy-screen.tsx's precedent for this exact same
      // side-panel + detail layout shape.
      gridTemplateColumns="[token(sizes.panel.side) minmax(0, 1fr)]"
      gap="6"
      width="full"
      flex="1"
    >
      <OrganigramTree
        units={units}
        selectedUnitId={selectedUnitId}
        onSelect={setSelectedUnitId}
      />
      <OrganigramDetailPanel unit={selectedUnit} />
    </Grid>
  );
}
