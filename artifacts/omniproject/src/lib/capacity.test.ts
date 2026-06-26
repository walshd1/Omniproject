import { describe, it, expect } from "vitest";
import { capacityBand, capacitySummary } from "./capacity";

describe("capacityBand", () => {
  it("bands utilisation against a threshold", () => {
    expect(capacityBand(125, 90)).toBe("over");
    expect(capacityBand(95, 90)).toBe("at");
    expect(capacityBand(90, 90)).toBe("at"); // inclusive
    expect(capacityBand(80, 90)).toBe("under");
    expect(capacityBand(null, 90)).toBe("unknown");
  });
  it("treats exactly 100% as at-capacity, not over", () => {
    expect(capacityBand(100, 90)).toBe("at");
    expect(capacityBand(101, 90)).toBe("over");
  });
});

describe("capacitySummary", () => {
  it("counts over and at-threshold people, ignoring unknowns", () => {
    const s = capacitySummary([130, 95, 90, 60, null], 90);
    expect(s.over).toBe(1); // 130
    expect(s.at).toBe(2); // 95, 90
    expect(s.tracked).toBe(4); // null excluded
  });
  it("shifts with the threshold", () => {
    expect(capacitySummary([85, 70], 80).at).toBe(1); // only 85
    expect(capacitySummary([85, 70], 60).at).toBe(2);
  });
});
