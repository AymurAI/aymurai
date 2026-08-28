import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomeLayout from "./home";

describe("HomeLayout", () => {
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
});
