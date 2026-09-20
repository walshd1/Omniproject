import { describe, it, expect, beforeEach } from "vitest";
import {
  useSourceAvailability, describeAvailability, describeStaleness, humaniseUnavailable, rawUnavailable, type AvailabilityReport,
} from "./source-availability";

const report = (over: Partial<AvailabilityReport> = {}): AvailabilityReport => ({
  complete: false, attempted: 4, answered: 3, unavailable: [{ source: "project:p-2", reason: "financials read failed" }], ...over,
});

beforeEach(() => useSourceAvailability.setState({ unavailable: 0, at: null }));

describe("the availability signal", () => {
  it("records a degraded response", () => {
    useSourceAvailability.getState().note(2, 1000);
    expect(useSourceAvailability.getState().unavailable).toBe(2);
    expect(useSourceAvailability.getState().at).toBe(1000);
  });

  it("CLEARS on the next clean response — an outage is transient, not sticky", () => {
    // This is the deliberate difference from the data-quality store, where `everRepaired` latches for
    // the session. A badge still claiming a recovered backend is down trains people to ignore it.
    useSourceAvailability.getState().note(2, 1000);
    useSourceAvailability.getState().note(0, 2000);
    expect(useSourceAvailability.getState().unavailable).toBe(0);
    expect(useSourceAvailability.getState().at).toBeNull();
  });
});

describe("describeAvailability", () => {
  it("leads with the count a human can act on", () => {
    expect(describeAvailability(report())).toBe("3 of 4 sources reporting");
  });

  it("says nothing when everything answered", () => {
    expect(describeAvailability(report({ complete: true }))).toBeNull();
    expect(describeAvailability(undefined)).toBeNull();
  });

  it("degrades gracefully when the gateway reported no attempt count", () => {
    expect(describeAvailability(report({ attempted: 0, answered: 0 }))).toBe("some sources did not answer");
  });
});

describe("describeStaleness", () => {
  it("distinguishes live from cached", () => {
    expect(describeStaleness(undefined)).toBeNull(); // live: the figure was computed for this request
    expect(describeStaleness(0)).toBe("cached moments ago");
    expect(describeStaleness(12_000)).toBe("cached 12s ago");
    expect(describeStaleness(120_000)).toBe("cached 2m ago");
  });
});

describe("humaniseUnavailable — plain sentences on screen, raw keys in logs/tooltip", () => {
  it("groups projects into ONE sentence rather than a wall of ids", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ source: `project:p-${i}`, reason: "financials read failed" }));
    expect(humaniseUnavailable(many)).toEqual(["20 projects' data didn't load."]);
  });

  it("uses the singular when there is one", () => {
    expect(humaniseUnavailable([{ source: "project:p-8842", reason: "financials read failed" }]))
      .toEqual(["One project's data didn't load."]);
  });

  it("names the whole-portfolio cases in terms a reader can act on", () => {
    expect(humaniseUnavailable([{ source: "projects", reason: "project list read failed" }])[0])
      .toMatch(/may not be your whole portfolio/);
    expect(humaniseUnavailable([{ source: "capacity", reason: "bulk read failed" }]))
      .toEqual(["Resource capacity didn't load."]);
  });

  it("counts federated regions separately from projects", () => {
    const mixed = [
      { source: "project:p-1", reason: "x" },
      { source: "peer:us", reason: "peer unreachable" },
      { source: "peer:apac", reason: "peer timeout" },
    ];
    expect(humaniseUnavailable(mixed)).toEqual(["One project's data didn't load.", "2 connected regions didn't answer."]);
  });

  it("never renders an empty explanation", () => {
    expect(humaniseUnavailable([])).toEqual(["A source didn't answer."]);
  });

  it("keeps the raw source and reason available for the tooltip and support", () => {
    expect(rawUnavailable([{ source: "project:p-8842", reason: "financials read failed" }]))
      .toBe("project:p-8842 — financials read failed");
  });
});
