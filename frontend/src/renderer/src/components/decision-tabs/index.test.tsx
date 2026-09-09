import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DecisionTabs from "./index";

describe("DecisionTabs", () => {
  it("labels each tab 'Destinatario N' by default", () => {
    render(
      <DecisionTabs
        selected={0}
        decisionAmount={3}
        addDecision={vi.fn()}
        selectDecision={vi.fn()}
      />,
    );
    expect(screen.getByText("Destinatario 1")).toBeInTheDocument();
    expect(screen.getByText("Destinatario 2")).toBeInTheDocument();
    expect(screen.getByText("Destinatario 3")).toBeInTheDocument();
  });

  it("scrolls horizontally instead of overflowing when there are many tabs", () => {
    const { container } = render(
      <DecisionTabs
        selected={0}
        decisionAmount={20}
        addDecision={vi.fn()}
        selectDecision={vi.fn()}
      />,
    );
    // Radix ScrollArea's Root renders with overflow: hidden — the row of
    // tabs is clipped/scrollable inside it instead of pushing the layout
    // wider than its container.
    expect(
      container.querySelector("[data-radix-scroll-area-viewport]"),
    ).not.toBeNull();
  });

  describe("clicking a tab scrolls it into view", () => {
    beforeEach(() => {
      Element.prototype.scrollIntoView = vi.fn();
    });

    it("calls scrollIntoView on the clicked tab, nearest/smooth", () => {
      const selectDecision = vi.fn();
      render(
        <DecisionTabs
          selected={0}
          decisionAmount={10}
          addDecision={vi.fn()}
          selectDecision={selectDecision}
        />,
      );

      const target = screen.getByText("Destinatario 8");
      fireEvent.click(target);

      expect(selectDecision).toHaveBeenCalledWith(7);
      expect(target.closest("button")?.scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
  });
});
