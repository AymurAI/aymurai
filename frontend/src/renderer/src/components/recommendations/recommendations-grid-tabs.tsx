import { Button } from "@aymurai/ui";
import { useTranslation } from "react-i18next";
import { HStack } from "@/styled/jsx";

type GridView = "seguimiento" | "recipients";

export default function RecommendationsGridTabs({
  tabsId,
  view,
  setView,
}: {
  tabsId: string;
  view: GridView;
  setView: (view: GridView) => void;
}) {
  const { t } = useTranslation("recommendations");
  return (
    <HStack role="tablist" aria-label={t("grilla.tabs.label")}>
      {(["seguimiento", "recipients"] as const).map((tab) => (
        <Button
          key={tab}
          role="tab"
          id={`${tabsId}-${tab}`}
          aria-controls={`${tabsId}-panel`}
          tabIndex={view === tab ? 0 : -1}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            const next =
              event.key === "Home"
                ? "seguimiento"
                : event.key === "End"
                  ? "recipients"
                  : tab === "seguimiento"
                    ? "recipients"
                    : "seguimiento";
            setView(next);
            document.getElementById(`${tabsId}-${next}`)?.focus();
          }}
          aria-selected={view === tab}
          variant={view === tab ? "primary" : "tertiary"}
          onClick={() => setView(tab)}
        >
          {t(`grilla.tabs.${tab}`)}
        </Button>
      ))}
    </HStack>
  );
}
