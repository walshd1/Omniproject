import { describe, it, expect } from "vitest";
import { parseNaturalDate, isNaturalDateToken } from "./natural-date";

// A fixed reference "today" so the parse is deterministic: Wednesday 2026-02-11 (UTC).
const TODAY = new Date(Date.UTC(2026, 1, 11));

describe("parseNaturalDate", () => {
  it("resolves relative keywords", () => {
    expect(parseNaturalDate("today", TODAY)).toBe("2026-02-11");
    expect(parseNaturalDate("tomorrow", TODAY)).toBe("2026-02-12");
    expect(parseNaturalDate("yesterday", TODAY)).toBe("2026-02-10");
    expect(parseNaturalDate("eod", TODAY)).toBe("2026-02-11");
    expect(parseNaturalDate("eow", TODAY)).toBe("2026-02-15"); // coming Sunday
  });

  it("resolves weekday names to the NEXT such day (strictly after today)", () => {
    expect(parseNaturalDate("friday", TODAY)).toBe("2026-02-13");
    expect(parseNaturalDate("next monday", TODAY)).toBe("2026-02-16");
    // Wednesday-on-a-Wednesday means next week, not today.
    expect(parseNaturalDate("wednesday", TODAY)).toBe("2026-02-18");
  });

  it("resolves 'in N unit' and bare integers (days)", () => {
    expect(parseNaturalDate("in 3 days", TODAY)).toBe("2026-02-14");
    expect(parseNaturalDate("in 2 weeks", TODAY)).toBe("2026-02-25");
    expect(parseNaturalDate("in 1 month", TODAY)).toBe("2026-03-11");
    expect(parseNaturalDate("in 1 year", TODAY)).toBe("2027-02-11");
    expect(parseNaturalDate("5", TODAY)).toBe("2026-02-16");
  });

  it("passes through explicit ISO dates and rejects nonsense", () => {
    expect(parseNaturalDate("2026-03-01", TODAY)).toBe("2026-03-01");
    expect(parseNaturalDate("not a date", TODAY)).toBeNull();
    expect(parseNaturalDate("", TODAY)).toBeNull();
  });

  it("isNaturalDateToken flags single date words but not bare integers", () => {
    expect(isNaturalDateToken("tomorrow", TODAY)).toBe(true);
    expect(isNaturalDateToken("friday", TODAY)).toBe(true);
    expect(isNaturalDateToken("5", TODAY)).toBe(false);
    expect(isNaturalDateToken("milk", TODAY)).toBe(false);
  });
});
