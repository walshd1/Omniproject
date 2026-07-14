import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MapPanel } from "./MapPanel";
import type { Panel } from "../../../lib/screen";

/**
 * MapPanel — geo-tagged points on a dependency-free SVG world plot, with an accessible
 * place list. Covers the no-points state, plural/singular count, non-finite filtering,
 * the "—" coordinate formatter and the default title.
 */
const panel = (config: Record<string, unknown>, title?: string): Panel => ({ id: "mp", kind: "map", ...(title ? { title } : {}), config });

describe("MapPanel", () => {
  it("shows a zero-locations status and no plot when there are no points", () => {
    render(<MapPanel panel={panel({ points: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("0 locations");
    expect(screen.queryByTestId("map-svg")).not.toBeInTheDocument();
  });

  it("defaults the title to 'Map' and treats a non-array points config as empty", () => {
    render(<MapPanel panel={panel({ points: "nope" })} />);
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 locations");
  });

  it("uses the singular 'location' for exactly one point and draws the plot", () => {
    render(<MapPanel panel={panel({ points: [{ label: "HQ", lat: 51.5, lng: -0.12 }] }, "Sites")} />);
    expect(screen.getByText("Sites")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1 location");
    expect(screen.getByRole("status")).not.toHaveTextContent("1 locations");
    expect(screen.getByTestId("map-svg")).toBeInTheDocument();
    expect(screen.getByText(/HQ \(51.5000, -0.1200\)/)).toBeInTheDocument();
  });

  it("filters out points with non-finite coordinates", () => {
    render(<MapPanel panel={panel({ points: [
      { label: "Good", lat: 40, lng: -70 },
      { label: "BadLat", lat: Number.NaN, lng: 10 },
      { label: "BadLng", lat: 10, lng: Number.POSITIVE_INFINITY },
    ] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 location");
    const list = screen.getByRole("list", { name: "Map locations" });
    expect(list).toHaveTextContent("Good (40.0000, -70.0000)");
    expect(list).not.toHaveTextContent("BadLat");
    expect(list).not.toHaveTextContent("BadLng");
  });

  it("tolerates a panel with no config at all (zero locations)", () => {
    render(<MapPanel panel={{ id: "mp", kind: "map" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("0 locations");
  });
});
