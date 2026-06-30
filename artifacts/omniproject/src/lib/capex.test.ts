import { describe, it, expect } from "vitest";
import { summariseCapex, splitExpenditure, isCosted, type CapexInput } from "./capex";

describe("splitExpenditure", () => {
  it("uses explicit capex/opex amounts when present", () => {
    expect(splitExpenditure({ id: "a", title: "a", capexAmount: 30000, opexAmount: 15000 })).toEqual({ capex: 30000, opex: 15000 });
  });

  it("allocates the whole cost to the declared side when only expenditureType + cost is given", () => {
    expect(splitExpenditure({ id: "a", title: "a", expenditureType: "capex", actualCost: 20000 })).toEqual({ capex: 20000, opex: 0 });
    expect(splitExpenditure({ id: "a", title: "a", expenditureType: "opex", budget: 12000 })).toEqual({ capex: 0, opex: 12000 });
  });

  it("leaves mixed/unknown unallocated and handles no cost", () => {
    expect(splitExpenditure({ id: "a", title: "a", expenditureType: "mixed", actualCost: 9000 })).toEqual({ capex: 0, opex: 0 });
    expect(splitExpenditure({ id: "a", title: "a" })).toEqual({ capex: 0, opex: 0 });
  });
});

describe("summariseCapex", () => {
  const items: CapexInput[] = [
    { id: "a", title: "Auth", capexAmount: 30000, opexAmount: 15000, costCategory: "Software", depreciationMonths: 36 },
    { id: "b", title: "Sync", capexAmount: 0, opexAmount: 30000, costCategory: "Integration" },
    { id: "c", title: "Infra", capexAmount: 12000, opexAmount: 4000, costCategory: "Software", depreciationMonths: 24 },
    { id: "n", title: "None" }, // excluded
  ];

  it("totals capex/opex and the capex share, excluding unclassified items", () => {
    const s = summariseCapex(items);
    expect(s.count).toBe(3);
    expect(s.totalCapex).toBe(42000);
    expect(s.totalOpex).toBe(49000);
    expect(s.capexPct).toBeCloseTo(42000 / 91000);
  });

  it("rolls up by cost category, largest first", () => {
    const s = summariseCapex(items);
    expect(s.byCategory[0]!.category).toBe("Software"); // 30000+15000+12000+4000 = 61000
    const software = s.byCategory.find((c) => c.category === "Software")!;
    expect(software.capex).toBe(42000);
    expect(software.opex).toBe(19000);
    expect(software.total).toBe(61000);
  });

  it("annualises capitalised spend over each item's depreciation period", () => {
    const s = summariseCapex(items);
    // a: 30000/(36/12)=10000 ; c: 12000/(24/12)=6000 ; b: no depreciation ⇒ 0
    expect(s.annualisedCapex).toBeCloseTo(16000);
  });

  it("falls back to the expenditureType + cost when no explicit split", () => {
    const s = summariseCapex([{ id: "x", title: "x", expenditureType: "capex", actualCost: 50000 }]);
    expect(s.totalCapex).toBe(50000);
    expect(s.totalOpex).toBe(0);
  });

  it("is safe on an empty set", () => {
    const s = summariseCapex([]);
    expect(s.total).toBe(0);
    expect(s.capexPct).toBe(0);
    expect(s.byCategory).toEqual([]);
  });
});

describe("isCosted", () => {
  it("is true only when an item yields a capex or opex figure", () => {
    expect(isCosted({ id: "a", title: "a", capexAmount: 1 })).toBe(true);
    expect(isCosted({ id: "a", title: "a", expenditureType: "opex", actualCost: 5 })).toBe(true);
    expect(isCosted({ id: "a", title: "a" })).toBe(false);
  });
});
