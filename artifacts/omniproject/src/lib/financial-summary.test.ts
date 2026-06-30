import { describe, it, expect } from "vitest";
import { summariseFinancials, type CostedItem } from "./financial-summary";

describe("summariseFinancials", () => {
  it("rolls up budget, actual, variance and % consumed", () => {
    const items: CostedItem[] = [
      { budget: 45000, actualCost: 28000 },
      { budget: 30000, actualCost: 6000 },
      { budget: null, actualCost: null }, // uncosted → contributes nothing, not counted
    ];
    const s = summariseFinancials(items);
    expect(s.budget).toBe(75000);
    expect(s.actual).toBe(34000);
    expect(s.variance).toBe(41000); // under budget
    expect(s.pctConsumed).toBe(45);
    expect(s.costedItems).toBe(2);
  });
  it("handles an empty / fully-uncosted backlog without dividing by zero", () => {
    expect(summariseFinancials([])).toEqual({ budget: 0, actual: 0, variance: 0, pctConsumed: 0, costedItems: 0 });
    expect(summariseFinancials([{ budget: 0, actualCost: 0 }]).pctConsumed).toBe(0);
  });
  it("reports an overspend as a negative variance", () => {
    const s = summariseFinancials([{ budget: 100, actualCost: 130 }]);
    expect(s.variance).toBe(-30);
    expect(s.pctConsumed).toBe(130);
  });
});
