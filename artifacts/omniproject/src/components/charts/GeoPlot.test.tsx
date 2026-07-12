import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GeoPlot, type GeoPoint } from "./GeoPlot";

const points: GeoPoint[] = [
  { label: "London", lat: 51.5, lng: -0.12 },
  { label: "Sydney", lat: -33.87, lng: 151.2 },
  { label: "Bad", lat: NaN, lng: 10 }, // dropped
];

describe("GeoPlot", () => {
  it("plots a marker per valid point and drops invalid coordinates", () => {
    render(<GeoPlot points={points} ariaLabel="places" testId="geo" />);
    const svg = screen.getByLabelText("places");
    expect(svg).toBe(screen.getByTestId("geo"));
    expect(svg.querySelectorAll("circle").length).toBe(2);
    expect(svg.textContent).toContain("London");
    expect(svg.textContent).toContain("Sydney");
    expect(svg.textContent).not.toContain("Bad");
  });

  it("projects equirectangularly — lng+180, 90-lat", () => {
    render(<GeoPlot points={[{ label: "Null Island", lat: 0, lng: 0 }]} ariaLabel="p" testId="geo" />);
    const c = screen.getByTestId("geo").querySelector("circle")!;
    expect(c.getAttribute("cx")).toBe("180");
    expect(c.getAttribute("cy")).toBe("90");
  });
});
