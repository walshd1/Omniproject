import { describe, it, expect } from "vitest";
import { shiftIsoDate, rescheduledDates } from "./reschedule";

describe("shiftIsoDate", () => {
  it("moves a date forward and back by whole days", () => {
    expect(shiftIsoDate("2026-06-10", 5)).toBe("2026-06-15");
    expect(shiftIsoDate("2026-06-10", -3)).toBe("2026-06-07");
    expect(shiftIsoDate("2026-06-10", 0)).toBe("2026-06-10");
  });
  it("crosses month boundaries", () => {
    expect(shiftIsoDate("2026-06-28", 5)).toBe("2026-07-03");
  });
});

describe("rescheduledDates", () => {
  it("shifts both ends together, preserving duration", () => {
    const r = rescheduledDates({ startDate: "2026-06-10", dueDate: "2026-06-20" }, 7);
    expect(r).toEqual({ startDate: "2026-06-17", dueDate: "2026-06-27" });
  });
  it("keeps a single-date milestone a milestone", () => {
    expect(rescheduledDates({ startDate: null, dueDate: "2026-06-20" }, 2)).toEqual({
      startDate: null,
      dueDate: "2026-06-22",
    });
  });
});
