import { describe, it, expect } from "vitest";
import { summariseRaid, type RaidItem } from "./raid-register";

const ITEMS: RaidItem[] = [
  { type: "risk", severity: "high", status: "mitigating" },
  { type: "risk", severity: "low", status: "done" },
  { type: "dependency", severity: "medium", status: "open" },
  { type: "assumption", severity: null, status: "open" },
  { type: "issue", severity: "medium", status: "cancelled" },
];

describe("summariseRaid", () => {
  it("counts by type and severity with all buckets present", () => {
    const s = summariseRaid(ITEMS);
    expect(s.total).toBe(5);
    expect(s.byType).toEqual({ risk: 2, assumption: 1, issue: 1, dependency: 1, other: 0 });
    expect(s.bySeverity).toEqual({ high: 1, medium: 2, low: 1, other: 1 }); // null severity → other
  });
  it("counts only live (non-closed) items as open exposure", () => {
    // mitigating + open + open are live; done + cancelled are closed.
    expect(summariseRaid(ITEMS).openItems).toBe(3);
  });
  it("buckets an unknown type under 'other' and is empty-safe", () => {
    expect(summariseRaid([{ type: "lesson", severity: "high", status: "open" }]).byType.other).toBe(1);
    expect(summariseRaid([]).total).toBe(0);
  });
});
