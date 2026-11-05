import { Button, Search } from "@aymurai/ui";
import { Plus } from "phosphor-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HStack, styled } from "@/styled/jsx";
import type { OrganigramUnit } from "@/types/organigram";
import OrganigramTreeNode from "./organigram-tree-node";
import PanelSurface from "./panel-surface";

interface OrganigramTreeProps {
  units: OrganigramUnit[];
  selectedUnitId: string | null;
  onSelect: (unitId: string) => void;
  /** Opens the create dialog; the new unit hangs off the current selection. */
  onAddUnit: () => void;
}

interface TreeRow {
  unit: OrganigramUnit;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

function matches(unit: OrganigramUnit, needle: string): boolean {
  return (
    unit.name.toLowerCase().includes(needle) ||
    (unit.acronym ?? "").toLowerCase().includes(needle) ||
    (unit.short_name ?? "").toLowerCase().includes(needle)
  );
}

export default function OrganigramTree({
  units,
  selectedUnitId,
  onSelect,
  onAddUnit,
}: OrganigramTreeProps) {
  const { t } = useTranslation("settings");
  const [query, setQuery] = useState("");
  // Expansion is owned by the tree, not by each node: the real organigram is
  // 520 units deep-nested 7 levels, so per-node `useState(true)` would paint
  // every branch open on first render.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { childrenByParent, roots, parentById } = useMemo(() => {
    const byParent = new Map<string, OrganigramUnit[]>();
    const parents = new Map<string, string>();
    for (const unit of units) {
      if (unit.parent_id === null) continue;
      parents.set(unit.id, unit.parent_id);
      const siblings = byParent.get(unit.parent_id) ?? [];
      siblings.push(unit);
      byParent.set(unit.parent_id, siblings);
    }
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return {
      childrenByParent: byParent,
      roots: units.filter((unit) => unit.parent_id === null),
      parentById: parents,
    };
  }, [units]);

  const needle = query.trim().toLowerCase();

  // A search keeps every match plus its ancestors, so a deep hit stays reachable
  // in context instead of appearing as an orphan row.
  const visibleIds = useMemo(() => {
    if (!needle) return null;
    const keep = new Set<string>();
    for (const unit of units) {
      if (!matches(unit, needle)) continue;
      keep.add(unit.id);
      let parent = parentById.get(unit.id);
      while (parent !== undefined && !keep.has(parent)) {
        keep.add(parent);
        parent = parentById.get(parent);
      }
    }
    return keep;
  }, [units, needle, parentById]);

  const rows = useMemo(() => {
    const flat: TreeRow[] = [];
    const walk = (siblings: OrganigramUnit[], depth: number) => {
      for (const unit of siblings) {
        if (visibleIds && !visibleIds.has(unit.id)) continue;
        const children = (childrenByParent.get(unit.id) ?? []).filter(
          (child) => !visibleIds || visibleIds.has(child.id),
        );
        // Depth 0 and 1 open by default: the whole first level is visible
        // without pushing 520 rows at the reader. A search force-opens the path.
        const isExpanded = visibleIds ? true : (expanded[unit.id] ?? depth < 1);
        flat.push({
          unit,
          depth,
          hasChildren: children.length > 0,
          expanded: isExpanded,
        });
        if (children.length > 0 && isExpanded) walk(children, depth + 1);
      }
    };
    walk(roots, 0);
    return flat;
  }, [roots, childrenByParent, expanded, visibleIds]);

  const parentIds = useMemo(
    () =>
      units.filter((unit) => childrenByParent.has(unit.id)).map((u) => u.id),
    [units, childrenByParent],
  );
  const allExpanded =
    parentIds.length > 0 && parentIds.every((id) => expanded[id] ?? false);

  return (
    <PanelSurface
      title={t("organigram.tree.title")}
      headerAside={
        <HStack gap="1">
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            onClick={onAddUnit}
          >
            <Plus size={16} />
            {t("organigram.tree.addAction")}
          </Button>
          <Button
            type="button"
            variant="tertiary"
            size="sm"
            disabled={parentIds.length === 0}
            onClick={() =>
              setExpanded(
                allExpanded
                  ? {}
                  : Object.fromEntries(parentIds.map((id) => [id, true])),
              )
            }
          >
            {allExpanded
              ? t("organigram.tree.collapseAllAction")
              : t("organigram.tree.expandAllAction")}
          </Button>
        </HStack>
      }
      toolbar={
        <Search
          value={query}
          aria-label={t("organigram.tree.searchLabel")}
          placeholder={t("organigram.tree.searchPlaceholder")}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
        />
      }
    >
      <styled.div
        role="tree"
        aria-label={t("organigram.tree.title")}
        display="contents"
      >
        {rows.map((row) => (
          <OrganigramTreeNode
            key={row.unit.id}
            unit={row.unit}
            depth={row.depth}
            hasChildren={row.hasChildren}
            expanded={row.expanded}
            // While filtering, every branch is force-open and the caret would
            // toggle hidden state with no visible effect — so it is not shown.
            canToggle={visibleIds === null}
            childCount={(childrenByParent.get(row.unit.id) ?? []).length}
            selected={row.unit.id === selectedUnitId}
            onToggle={() =>
              setExpanded((current) => ({
                ...current,
                [row.unit.id]: !(current[row.unit.id] ?? row.depth < 1),
              }))
            }
            onSelect={() => onSelect(row.unit.id)}
          />
        ))}
      </styled.div>

      {rows.length === 0 && (
        <styled.p textStyle="paragraph.sm.default" color="text.lighter">
          {needle ? t("organigram.tree.noMatches") : t("organigram.tree.empty")}
        </styled.p>
      )}
    </PanelSurface>
  );
}
