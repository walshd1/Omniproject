import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrendChart } from "./TrendChart";
import type { TrendSeries } from "../../lib/trends";

function series(over: Partial<TrendSeries> = {}): TrendSeries {
  return {
    metric: "completionPct",
    grain: "month",
    from: "2026-01-01T00:00:00Z",
    to: "2026-04-01T00:00:00Z",
    available: true,
    points: [
      { at: "2026-01-01T00:00:00.000Z", value: 10, n: 2, provenance: "replayed" },
      { at: "2026-02-01T00:00:00.000Z", value: 30, n: 2, provenance: "replayed" },
      { at: "2026-03-01T00:00:00.000Z", value: 55, n: 2, provenance: "replayed" },
    ],
    ...over,
  };
}

describe("TrendChart", () => {
  it("renders nothing when there is no series at all", () => {
    const { container } = render(<TrendChart series={undefined} label="X" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows an honest 'history not yet retained' note when the series is unavailable", () => {
    render(<TrendChart series={series({ available: false, reason: "history domain not enabled", points: [] })} label="Completion" />);
    expect(screen.getByTestId("trend-unavailable")).toHaveTextContent(/history not yet retained/i);
    expect(screen.getByTestId("trend-unavailable")).toHaveTextContent(/history domain not enabled/i);
  });

  it("shows a 'no data retained' note when available but every point is null", () => {
    const empty = series({ points: [{ at: "2026-01-01T00:00:00.000Z", value: null, n: 0, provenance: "replayed" }] });
    render(<TrendChart series={empty} label="Completion" />);
    expect(screen.getByTestId("trend-unavailable")).toHaveTextContent(/no data retained/i);
  });

  it("draws the line and reports the latest value + delta direction for a real series", () => {
    render(<TrendChart series={series()} label="Completion" unit="%" />);
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getByText(/latest 55%/)).toBeInTheDocument();
    // rose from 10 → 55 ⇒ up marker
    expect(screen.getByText(/▲ 45%/)).toBeInTheDocument();
  });
});
