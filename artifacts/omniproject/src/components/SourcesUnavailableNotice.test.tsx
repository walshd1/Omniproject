import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourcesUnavailableNotice } from "./SourcesUnavailableNotice";
import type { AvailabilityReport } from "../lib/source-availability";

const degraded: AvailabilityReport = {
  complete: false, attempted: 4, answered: 3,
  unavailable: [{ source: "project:p-2", reason: "financials read failed" }],
};

describe("SourcesUnavailableNotice", () => {
  it("renders nothing for a healthy, live report", () => {
    render(<SourcesUnavailableNotice availability={{ complete: true, attempted: 4, answered: 4, unavailable: [] }} />);
    expect(screen.queryByTestId("sources-unavailable-notice")).toBeNull();
  });

  it("names the count and says the totals were withheld ON PURPOSE", () => {
    // The distinction that matters: a blank budget with no explanation reads as a bug or as zero.
    render(<SourcesUnavailableNotice availability={degraded} />);
    const el = screen.getByTestId("sources-unavailable-notice");
    expect(el).toHaveTextContent("3 of 4 sources reporting");
    expect(el).toHaveTextContent("withheld");
  });

  it("shows a PLAIN sentence, not the raw source key — but keeps the key in the tooltip", () => {
    // `project:p-2` is the right thing for a log line and the wrong thing for a reader: nobody can
    // place that id, and twenty of them bury the one fact that matters. The raw stays reachable for
    // support (tooltip) and lives properly in the gateway's logs.
    render(<SourcesUnavailableNotice availability={degraded} />);
    const el = screen.getByTestId("sources-unavailable-notice");
    expect(el).toHaveTextContent("One project's data didn't load.");
    expect(el.textContent).not.toContain("project:p-2");
    expect(el.querySelector("ul")?.getAttribute("title")).toBe("project:p-2 — financials read failed");
  });

  it("reports staleness as a SEPARATE axis — complete figures can still be non-live", () => {
    render(<SourcesUnavailableNotice staleMs={45_000} />);
    const el = screen.getByTestId("sources-unavailable-notice");
    expect(el).toHaveTextContent("cached 45s ago");
    expect(el).not.toHaveTextContent("sources reporting");
  });

  it("shows both when a report is degraded AND cached", () => {
    render(<SourcesUnavailableNotice availability={degraded} staleMs={120_000} />);
    const el = screen.getByTestId("sources-unavailable-notice");
    expect(el).toHaveTextContent("3 of 4 sources reporting");
    expect(el).toHaveTextContent("cached 2m ago");
  });
});
