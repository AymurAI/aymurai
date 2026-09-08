import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
});
