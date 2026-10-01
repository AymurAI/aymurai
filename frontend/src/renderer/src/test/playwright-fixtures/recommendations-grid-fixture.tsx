import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Header from "@/components/layout/header";
import MainContent from "@/components/layout/main-content";
import RecommendationsGrid from "@/components/recommendations/recommendations-grid";
import { Stack } from "@/styled/jsx";
import type { RecommendationRow } from "@/types/dataExtraction";

const PUBLISHABLE_CONTENT =
  "La Defensoría recomienda garantizar la atención integral, publicar los resultados del seguimiento y comunicar las medidas adoptadas a todas las personas afectadas.";

export function RecommendationsGridFixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const items: RecommendationRow[] = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    document_id: `d${i}`,
    recommendation_number: `REC-${i + 1}`,
    recommendation_date_text: null,
    recommendation_date: "2026-09-01",
    topic: "Salud",
    subtopic: "Atención",
    personal_data: false,
    publishable_content: PUBLISHABLE_CONTENT,
    recipients: [
      {
        id: `p${i}`,
        source_index: null,
        name: "Agustín Federico F.",
        position: "Secretario",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: null,
        unit_name: null,
        sector_id: "s1",
        sector_name: "Secretaría de Innovación y Transformación Digital",
      },
      {
        id: `s${i}`,
        source_index: null,
        name: "Ana Pérez",
        position: "Directora",
        is_primary: false,
        macro_sector: "Empresa",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
      },
    ],
    file_number: "EX-2026",
    recommendation_detail: "En análisis",
    recommendation_situation: "En análisis",
    status: "Abierta",
    approved_for_publication: false,
    link: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: null,
  }));
  client.setQueryDefaults(["recommendations-list"], {
    initialData: { items, total: 20, page: 1, page_size: 20 },
  });
  client.setQueryDefaults(["recommendation-enums"], {
    initialData: { situations: ["En análisis"], statuses: ["Abierta"] },
  });
  client.setQueryDefaults(["topics"], {
    initialData: [{ id: "t1", name: "Salud", active: true }],
  });
  client.setQueryDefaults(["subtopics"], {
    initialData: [
      { id: "st1", topic_id: "t1", name: "Atención", active: true },
    ],
  });
  client.setQueryDefaults(["macro-sectors"], {
    initialData: [
      { id: "m1", name: "GCBA", code: "GCBA", active: true },
      { id: "m2", name: "Empresa", code: "EMPRESA", active: true },
    ],
  });
  client.setQueryDefaults(["organigram-units"], { initialData: [] });
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Stack width="full" height="[100dvh]" gap="0">
          <Header title="Recomendaciones · Seguimiento" />
          <MainContent full>
            <Stack
              gap="6"
              p={{ base: "4", md: "8" }}
              height="[calc(100dvh - 96px)]"
              minH="0"
            >
              <RecommendationsGrid search={{}} onSearchChange={() => {}} />
            </Stack>
          </MainContent>
        </Stack>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
