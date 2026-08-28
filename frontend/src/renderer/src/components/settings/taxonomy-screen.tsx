import { useState } from "react";
import { Grid } from "@/styled/jsx";
import SubtopicsPanel from "./subtopics-panel";
import TopicsPanel from "./topics-panel";

export default function TaxonomyScreen() {
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  return (
    <Grid
      // `gridTemplateColumns` has no token category in this preset
      // (plain CssProperties, per `.claude/rules/panda-css.md` and
      // `styled/types/style-props.d.ts`), so `strictTokens` doesn't force
      // the bracket escape here the way it does for `color`/`width`/etc —
      // it's used anyway so `token()` resolves inside the multi-value CSS
      // list, matching `validate-dataset/index.tsx:74-87`'s
      // `token(sizes.panel.form)` precedent.
      gridTemplateColumns="[token(sizes.panel.side) minmax(0, 1fr)]"
      gap="6"
      width="full"
      flex="1"
    >
      <TopicsPanel
        selectedTopicId={selectedTopicId}
        onSelectTopic={setSelectedTopicId}
      />
      <SubtopicsPanel topicId={selectedTopicId} />
    </Grid>
  );
}
