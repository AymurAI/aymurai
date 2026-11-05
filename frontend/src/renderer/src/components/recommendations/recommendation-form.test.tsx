import { TooltipProvider } from "@aymurai/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  DataExtractionPrediction,
  OrganigramCandidate,
  RecommendationValidationInput,
} from "@/types/dataExtraction";
import RecommendationForm from "./recommendation-form";

// `topic`/`subtopic`/`macro_sector` each mount `@aymurai/ui`'s `Select`,
// whose option `description` wraps each option in a Radix Tooltip -- it
// throws without a `TooltipProvider` ancestor even before the dropdown
// opens, the same wrapping `app.tsx` does for real, matching
// `recipient-fields.test.tsx`'s identical need.

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Radix Tooltip's positioning measures the trigger's size via
// ResizeObserver, which jsdom doesn't implement -- stubbed the same way
// `turn-side-panel.test.tsx` already does for the identical underlying
// reason.
vi.stubGlobal(
  "ResizeObserver",
  class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

// A small fixture that does NOT contain "Tema inexistente" — matching
// `taxonomy-screen.test.tsx`'s convention of mocking the whole catalogs
// service module rather than driving `api` directly.
vi.mock("@/services/aymurai/catalogs", () => ({
  listTopics: () => ({
    queryKey: ["topics"],
    queryFn: async () => [
      {
        id: "t1",
        code: null,
        name: "Salud",
        active: true,
        order: 1,
        created_at: "x",
        updated_at: "x",
      },
    ],
  }),
  listSubtopics: (topicId: string) => ({
    queryKey: ["subtopics", topicId],
    queryFn: async () => [],
  }),
  listMacroSectors: () => ({
    queryKey: ["macro-sectors"],
    queryFn: async () => [
      {
        id: "m1",
        code: "GCBA",
        name: "GCBA",
        active: true,
        order: 0,
        created_at: "x",
        updated_at: "x",
      },
    ],
  }),
}));

function aPrediction(
  partial: Partial<DataExtractionPrediction> = {},
): DataExtractionPrediction {
  return {
    document_id: "doc-1",
    recommendation_number: "123/2026",
    recommendation_date: "22 de noviembre",
    recipients: [
      {
        name: "Ana Pérez",
        position: "Directora",
        is_primary: true,
        macro_sector: "GCBA",
        unit_id: null,
        unit_name: null,
        sector_id: null,
        sector_name: null,
        match_method: null,
        unit_candidates: [],
        sector_candidates: [],
      },
    ],
    topic: "Salud",
    subtopic: null,
    personal_data: null,
    publishable_content: "Contenido publicable.",
    config: { model: "m", options: {}, catalogs_hash: "hash" },
    catalogs_stale: false,
    ...partial,
  };
}

function renderWithClient(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

// A candidate IS a sector (ADR-0008): `unit_id === sector_id`, and the unit
// the cargo matched travels in `source_unit_*`.
const A_CANDIDATE: OrganigramCandidate = {
  unit_id: "s1",
  unit_name: "Secretaría de Gobierno y Vínculo Ciudadano",
  sector_id: "s1",
  sector_name: "Secretaría de Gobierno y Vínculo Ciudadano",
  ruta_organigrama: "Jefatura de Gabinete > Secretaría de Gobierno",
  score: 87.6,
  source_unit_id: "u1",
  source_unit_name: "Dirección General de Coordinación",
};

describe("RecommendationForm — unified date field", () => {
  it("shows the raw detected text as a hover tooltip on the date field", async () => {
    vi.useFakeTimers();
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ recommendation_date: "10 de julio de 2024" })}
        validation={null}
      />,
    );

    // `pointerenter`/`pointerleave` don't bubble, and Radix's `asChild`
    // merges its listeners onto whatever DOM node `TextField` renders as
    // its own root (its outer container, not the `<input>` itself) --
    // firing a pointer event on the input found via `getByLabelText` would
    // never reach that listener. Focus does bubble via React's `onFocus`
    // delegation (`focusin` under the hood) regardless of which node it
    // landed on, and Radix Tooltip opens on focus the same as on hover.
    fireEvent.focus(screen.getByLabelText("validation.recommendationDate"));
    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "10 de julio de 2024",
    );
    vi.useRealTimers();
  });

  it("does not wrap the date field in a tooltip when there is no raw text", async () => {
    vi.useFakeTimers();
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ recommendation_date: null })}
        validation={null}
      />,
    );

    fireEvent.focus(screen.getByLabelText("validation.recommendationDate"));
    act(() => {
      vi.advanceTimersByTime(700);
    });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("editing the date field's value calls onValuesChange with the new date", () => {
    const onValuesChange = vi.fn();
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction()}
        validation={null}
        onValuesChange={onValuesChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("validation.recommendationDate"), {
      target: { value: "2024-07-10" },
    });

    expect(onValuesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ recommendation_date: "2024-07-10" }),
    );
  });
});

describe("RecommendationForm — is_primary is independent per recipient", () => {
  it("shows each recipient's own is_primary when switching tabs, not whichever was checked first", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({
          recipients: [
            {
              name: "Ana Pérez",
              position: "Directora",
              is_primary: true,
              macro_sector: "GCBA",
              unit_id: null,
              unit_name: null,
              sector_id: null,
              sector_name: null,
              match_method: null,
              unit_candidates: [],
              sector_candidates: [],
            },
            {
              name: "Beto Gómez",
              position: "Subdirector",
              is_primary: false,
              macro_sector: "GCBA",
              unit_id: null,
              unit_name: null,
              sector_id: null,
              sector_name: null,
              match_method: null,
              unit_candidates: [],
              sector_candidates: [],
            },
          ],
        })}
        validation={null}
      />,
    );

    // Destinatario 1 (Ana): Sí checked, No unchecked.
    expect(
      screen.getByRole("radio", { name: "validation.isPrimaryYes" }),
    ).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "validation.isPrimaryNo" }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByText("Destinatario 2"));

    // Destinatario 2 (Beto) must show its OWN is_primary (false), not
    // Ana's -- this is the exact regression `RadioGroup`'s stale internal
    // `selected` state caused: re-rendering the same tree position with a
    // different recipient's `checked` props kept showing whichever radio
    // was checked when the group first mounted.
    expect(
      screen.getByRole("radio", { name: "validation.isPrimaryYes" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "validation.isPrimaryNo" }),
    ).toBeChecked();
  });
});

describe("RecommendationForm", () => {
  it("offers the catalog fields as clickable suggestions on mount", () => {
    // Consistency across the whole form: every field the model answered
    // presents that answer as a violet mark to accept, not as a value that
    // already looks settled. (The subtopic's own fallback -- its list
    // following the SUGGESTED topic until a topic is validated -- is
    // exercised in `useRecommendationForm.test.ts`, which has a taxonomy
    // with real subtopics; this file's catalog mock has none.)
    renderWithClient(
      <RecommendationForm prediction={aPrediction()} validation={null} />,
    );

    expect(screen.getByRole("button", { name: "Salud" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GCBA" })).toBeInTheDocument();
  });

  it("offers an out-of-catalog topic as a suggestion anyway, with its error inline", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ topic: "Tema inexistente" })}
        validation={null}
      />,
    );

    // §keep-and-flag: never silently dropped — offered on the suggestion
    // mark like any other guess (the mark resolves the suggestion id against
    // the option list, so a hit here means the hook actually added it as an
    // extra option)...
    expect(
      screen.getByRole("button", { name: "Tema inexistente" }),
    ).toBeInTheDocument();
    // ...and flagged with the inline error message before it is accepted,
    // not only after.
    expect(
      screen.getByText("validation.topicOutOfCatalog"),
    ).toBeInTheDocument();
  });

  it("starts personal_data's radios unmarked when the value is null", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({ personal_data: null })}
        validation={null}
      />,
    );

    expect(
      screen.getByRole("radio", { name: "validation.personalDataYes" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("radio", { name: "validation.personalDataNo" }),
    ).not.toBeChecked();
  });

  // These mirror `recipient-fields.test.tsx`'s identical GCBA-gating tests,
  // but here confirming the *integration*: that `RecommendationForm` actually
  // threads the selected recipient's `macro_sector`/`sector_candidates` down,
  // rather than re-testing `RecipientUnitCombobox`'s own logic again.
  it("shows the organigram unit combobox for a GCBA recipient, with or without candidates", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({
          recipients: [
            {
              name: "Ana Pérez",
              position: "Directora",
              is_primary: true,
              macro_sector: "GCBA",
              unit_id: null,
              unit_name: null,
              sector_id: null,
              sector_name: null,
              match_method: null,
              unit_candidates: [],
              sector_candidates: [A_CANDIDATE],
            },
          ],
        })}
        validation={null}
      />,
    );

    // 5 comboboxes: macro_sector, topic, subtopic, plus the unit and sector
    // pickers (both always present for a GCBA recipient -- see the
    // empty-candidates fixture default in `aPrediction`, exercised by the
    // next test).
    expect(screen.getAllByRole("combobox")).toHaveLength(5);
  });

  it("does not show the organigram unit combobox for a non-GCBA recipient", () => {
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction({
          recipients: [
            {
              name: "Ana Pérez",
              position: "Directora",
              is_primary: true,
              macro_sector: "Organismos Nacionales",
              unit_id: null,
              unit_name: null,
              sector_id: null,
              sector_name: null,
              match_method: null,
              unit_candidates: [],
              sector_candidates: [],
            },
          ],
        })}
        validation={null}
      />,
    );

    expect(screen.getAllByRole("combobox")).toHaveLength(3);
  });

  // Task 13 added `onValuesChange` so `<RecommendationValidation>` can read
  // live form values (to feed the document highlight), but nothing exercised
  // it against the real component -- every existing test either mounts this
  // form without the prop, or (in `recommendation-validation.test.tsx`)
  // mocks this whole module out. This mounts the real
  // `useRecommendationForm` + effect wiring end to end.
  it("reports the current payload via onValuesChange on mount and after an edit, without looping", () => {
    const onValuesChange = vi.fn();
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction()}
        validation={null}
        onValuesChange={onValuesChange}
      />,
    );

    // Fires once on mount with the seeded values -- `recommendation_number`
    // starts blank (the model's guess only lives in the suggestion mark
    // until accepted or overridden, see `blankTextFields`).
    expect(onValuesChange).toHaveBeenCalledTimes(1);
    expect(onValuesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ recommendation_number: null }),
    );

    fireEvent.change(screen.getByLabelText("validation.recommendationNumber"), {
      target: { value: "999/2026" },
    });

    // Exactly one more call for the one edit -- not a handful, not a loop.
    expect(onValuesChange).toHaveBeenCalledTimes(2);
    expect(onValuesChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ recommendation_number: "999/2026" }),
    );
  });

  // The test above uses a bare `vi.fn()` spy, which never feeds back into a
  // re-render of `RecommendationForm` -- it can't actually exercise the
  // failure mode `toPayload`'s `useCallback` memoization
  // (`hooks/useRecommendationForm.ts`) guards against. `<RecommendationValidation>`
  // instead passes its own `setPayload` (a real `useState` setter) as
  // `onValuesChange`, so calling it DOES re-render the form's parent, which
  // re-renders `RecommendationForm` itself. If `toPayload` ever goes back to
  // being a plain function declaration (a new reference every render, even
  // when `values` hasn't changed), the mount effect's dependency list would
  // see a "changed" `toPayload` on every one of those parent-triggered
  // re-renders and re-fire indefinitely -- `setPayload` again, re-render
  // again, forever (React's own "Maximum update depth exceeded" safety net
  // is what would actually stop it, as a thrown error). This wrapper mirrors
  // that real wiring (`onValuesChange={setPayload}`, not an inline callback)
  // to pin the settled, non-looping behavior.
  it("settles after a bounded number of renders when onValuesChange is a real state setter (regression guard for toPayload's memoization)", async () => {
    const renderCount = { current: 0 };

    function Wrapper() {
      const [payload, setPayload] =
        useState<RecommendationValidationInput | null>(null);
      renderCount.current += 1;
      return (
        <>
          <RecommendationForm
            prediction={aPrediction()}
            validation={null}
            onValuesChange={setPayload}
          />
          {/* `publishable_content` isn't one of `blankValidatedFields`'
              blanked fields, so unlike `recommendation_number` it reliably
              distinguishes "the mount effect fired" (a real value) from "it
              hasn't yet" (`payload` still null) -- `recommendation_number`
              starts blank either way, which is exactly what's being changed
              here. `topic` used to serve this role and no longer can: it is
              blanked too now, so the suggestion mark on Tema can render. */}
          <div data-testid="reported-content">
            {payload?.publishable_content}
          </div>
          <div data-testid="reported-number">
            {payload?.recommendation_number}
          </div>
        </>
      );
    }

    renderWithClient(<Wrapper />);

    await waitFor(() =>
      expect(screen.getByTestId("reported-content")).toHaveTextContent(
        "Contenido publicable",
      ),
    );
    expect(screen.getByTestId("reported-number")).toHaveTextContent("");
    // Steady state is 2: Wrapper's own mount render, plus exactly one more
    // from the mount effect's `setPayload` call. A non-memoized `toPayload`
    // would keep climbing well past this on its own, with no edit at all.
    const rendersAfterMount = renderCount.current;
    expect(rendersAfterMount).toBeLessThanOrEqual(2);

    fireEvent.change(screen.getByLabelText("validation.recommendationNumber"), {
      target: { value: "999/2026" },
    });

    await waitFor(() =>
      expect(screen.getByTestId("reported-number")).toHaveTextContent(
        "999/2026",
      ),
    );
    // One more settled render for the one edit -- not runaway.
    expect(renderCount.current).toBeLessThanOrEqual(rendersAfterMount + 2);
  });

  it("reports the fields still awaiting validation, and drops one once it is filled", () => {
    const onPendingFieldsChange = vi.fn();
    renderWithClient(
      <RecommendationForm
        prediction={aPrediction()}
        validation={null}
        onPendingFieldsChange={onPendingFieldsChange}
      />,
    );

    // `aPrediction()` suggests a recommendation_number, so it starts pending.
    expect(onPendingFieldsChange).toHaveBeenCalledTimes(1);
    expect(onPendingFieldsChange).toHaveBeenLastCalledWith(
      expect.arrayContaining([{ labelKey: "recommendationNumber" }]),
    );

    fireEvent.change(screen.getByLabelText("validation.recommendationNumber"), {
      target: { value: "999/2026" },
    });

    expect(onPendingFieldsChange).toHaveBeenLastCalledWith(
      expect.not.arrayContaining([{ labelKey: "recommendationNumber" }]),
    );
  });
});
