import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganigramHolder } from "@/types/organigram";
import HolderCorrectDialog from "./holder-correct-dialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const holder: OrganigramHolder = {
  id: "h1",
  unit_id: "u1",
  name: "Pérez, Ana",
  start_date: "2024-03-11",
  is_current: true,
  created_at: "2026-08-28T00:00:00Z",
  updated_at: null,
};

const onConfirm = vi.fn();

function renderDialog(subject: OrganigramHolder | null = holder) {
  return render(
    <HolderCorrectDialog
      holder={subject}
      onOpenChange={vi.fn()}
      isPending={false}
      onConfirm={onConfirm}
    />,
  );
}

const nameField = () => screen.getByDisplayValue("Pérez, Ana");
const dateField = () =>
  document.querySelector('input[type="date"]') as HTMLInputElement;

describe("HolderCorrectDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the term date as a real date input", () => {
    // `TextField` types `type` as text|number and this passes "date" through a
    // cast — if the library ever stops forwarding it, this fails rather than
    // silently degrading to a free-text field.
    renderDialog();

    expect(dateField()).toBeInTheDocument();
    expect(dateField().value).toBe("2024-03-11");
  });

  it("sends only the name when only the name was corrected", () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: "Pérez, Ana María" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "organigram.detail.renameHolderSubmit",
      }),
    );

    expect(onConfirm).toHaveBeenCalledWith({ name: "Pérez, Ana María" });
  });

  it("sends only the date when only the date was corrected", () => {
    // The API rejects an empty body and treats an omitted field as "leave it
    // alone", so a date-only correction must not resend the unchanged name.
    renderDialog();

    fireEvent.change(dateField(), { target: { value: "2020-01-15" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "organigram.detail.renameHolderSubmit",
      }),
    );

    expect(onConfirm).toHaveBeenCalledWith({ start_date: "2020-01-15" });
  });

  it("sends both when both were corrected", () => {
    renderDialog();

    fireEvent.change(nameField(), { target: { value: "Otra persona" } });
    fireEvent.change(dateField(), { target: { value: "2020-01-15" } });
    fireEvent.click(
      screen.getByRole("button", {
        name: "organigram.detail.renameHolderSubmit",
      }),
    );

    expect(onConfirm).toHaveBeenCalledWith({
      name: "Otra persona",
      start_date: "2020-01-15",
    });
  });

  it("cannot be submitted when nothing was corrected", () => {
    renderDialog();

    expect(
      screen.getByRole("button", {
        name: "organigram.detail.renameHolderSubmit",
      }),
    ).toBeDisabled();
  });

  it("falls back to the record's own date for a holder with no term date", () => {
    // Rows written before term dates existed: the field opens on the date the
    // screen has always shown for them, so saving does not invent a new one.
    renderDialog({ ...holder, start_date: null });

    expect(dateField().value).toBe("2026-08-28");
  });
});
