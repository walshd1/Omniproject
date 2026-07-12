import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArtifactFrame } from "./ArtifactFrame";

describe("ArtifactFrame", () => {
  it("renders children bare when the style is empty", () => {
    render(<ArtifactFrame testId="frame"><span>content</span></ArtifactFrame>);
    // No <figure> wrapper — just a passthrough div carrying the testId.
    const el = screen.getByTestId("frame");
    expect(el.tagName.toLowerCase()).toBe("div");
    expect(el.textContent).toBe("content");
  });

  it("applies title, font, text colour and background from the spec", () => {
    render(
      <ArtifactFrame testId="frame" style={{ title: "Velocity", fontFamily: "serif", textColor: "#112233", background: "#eeeeee" }}>
        <span>chart</span>
      </ArtifactFrame>,
    );
    const frame = screen.getByTestId("frame");
    expect(frame.tagName.toLowerCase()).toBe("figure");
    expect(screen.getByTestId("frame-title").textContent).toBe("Velocity");
    expect(frame.style.color).toBe("rgb(17, 34, 51)");
    expect(frame.style.background).toContain("rgb(238, 238, 238)");
    expect(frame.style.fontFamily).toContain("serif");
    // Background present ⇒ padded.
    expect(frame.className).toContain("p-3");
  });

  it("renders a title-only frame without padding when there is no background", () => {
    render(<ArtifactFrame testId="frame" style={{ title: "Just a title" }}><span>x</span></ArtifactFrame>);
    const frame = screen.getByTestId("frame");
    expect(frame.tagName.toLowerCase()).toBe("figure");
    expect(frame.className).not.toContain("p-3");
  });

  it("centres the heading when align is center", () => {
    render(<ArtifactFrame testId="frame" style={{ title: "T", align: "center" }}><span>x</span></ArtifactFrame>);
    expect(screen.getByTestId("frame").querySelector("figcaption")!.className).toContain("text-center");
  });
});
