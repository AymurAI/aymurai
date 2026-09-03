import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { catalogsService } from "@/services/aymurai";
import { Grid } from "@/styled/jsx";
import SubtopicsPanel from "./subtopics-panel";
import TopicsPanel from "./topics-panel";

export default function TaxonomyScreen() {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  // Shares the panel's cache entry (same query key), so naming the selected
  // topic in the detail header costs no extra request.
  const { data: topics = [] } = useQuery(catalogsService.listTopics());
  const selectedTopicName =
    topics.find((topic) => topic.id === selectedTopicId)?.name ?? null;

  return (
    <Grid
      // `gridTemplateColumns` has no token category in this preset
      // (plain CssProperties, per `.claude/rules/panda-css.md` and
      // `styled/types/style-props.d.ts`), so `strictTokens` doesn't force
      // the bracket escape here the way it does for `color`/`width`/etc —
      // it's used anyway so `token()` resolves inside the multi-value CSS
      // list, matching `validate-dataset/index.tsx:74-87`'s
      // `token(sizes.panel.form)` precedent.
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
      <TopicsPanel
        selectedTopicId={selectedTopicId}
        onSelectTopic={setSelectedTopicId}
      />
      <SubtopicsPanel topicId={selectedTopicId} topicName={selectedTopicName} />
    </Grid>
  );
}
