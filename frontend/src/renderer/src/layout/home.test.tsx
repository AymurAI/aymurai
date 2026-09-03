import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HomeLayout from "./home";

// `HomeLayout` mounts the real `AppHeader` once a server is configured, which
// pulls in router links and the features popover — mocked to a marker so these
// tests stay about the layout's own geometry.
vi.mock("@/components/layout/header", () => ({
  default: () => <div data-testid="app-header" />,
}));

let connectedHost: string | null = null;
vi.mock("@/hooks/useConnectedHost", () => ({
  useConnectedHost: () => connectedHost,
}));

describe("HomeLayout", () => {
  beforeEach(() => {
    connectedHost = null;
  });

  it("defaults to the narrow, centered variant (unchanged behavior)", () => {
    render(
      <HomeLayout>
        <div>content</div>
      </HomeLayout>,
    );

    const childrenArea = screen.getByText("content").parentElement;
    expect(childrenArea?.className).toContain("ai_center");
    expect(childrenArea?.className).toContain("jc_center");
  });

  it("stretches to the full width in the wide variant", () => {
    render(
      <HomeLayout variant="wide">
        <div>content</div>
      </HomeLayout>,
    );

    const childrenArea = screen.getByText("content").parentElement;
    expect(childrenArea?.className).not.toContain("ai_center");
    expect(childrenArea?.className).toContain("ai_stretch");
  });

  it("always renders BuiltBy regardless of variant", () => {
    render(
      <HomeLayout variant="wide">
        <div>content</div>
      </HomeLayout>,
    );

    expect(screen.getByAltText("DataGenero isologo")).toBeTruthy();
  });

  it("omits the app header while no server is configured", () => {
    render(
      <HomeLayout variant="wide">
        <div>content</div>
      </HomeLayout>,
    );

    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
  });

  it("puts the app header above the violet frame once connected", () => {
    connectedHost = "https://aymurai.example.org";
    render(
      <HomeLayout variant="wide">
        <div>content</div>
      </HomeLayout>,
    );

    const header = screen.getByTestId("app-header");
    // The frame is the `main` below it, so the header is a sibling — never a
    // child, which is what wrapped it in violet before.
    expect(header.parentElement?.tagName).toBe("DIV");
    expect(header.nextElementSibling?.tagName).toBe("MAIN");
  });
});
