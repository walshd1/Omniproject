import { describe, it, expect } from "vitest";
import { optimisePortfolio, type OptItem } from "./portfolio-optimiser";

const item = (id: string, value: number, cost: number, capacityHours = 0): OptItem => ({ id, name: id, value, cost, capacityHours });

describe("optimisePortfolio", () => {
  it("beats density-greedy on a knapsack counterexample (densest item blocks the better pair)", () => {
    // Budget 6000. Greedy takes A (density 1.75) first, leaving 2000 — too little for B or C, so it
    // buys value 7. The optimum is B+C (cost 6000, value 10). This is exactly where rank/density
    // greedy — what autoFundByRank does — is provably sub-optimal.
    const items = [
      item("A", 7, 4000), // density 1.75/£k
      item("B", 5, 3000), // density 1.66/£k
      item("C", 5, 3000), // density 1.66/£k
    ];
    const r = optimisePortfolio(items, { budgetCap: 6000 });
    expect(r.selected.sort()).toEqual(["B", "C"]);
    expect(r.totalValue).toBe(10);
    expect(r.greedyValue).toBe(7);
    expect(r.totalValue).toBeGreaterThan(r.greedyValue); // the whole point: optimiser > greedy
    expect(r.method).toBe("exact");
  });

  it("respects the budget cap exactly", () => {
    const items = [item("A", 100, 1000), item("B", 100, 1000), item("C", 100, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 2000 });
    expect(r.selected.length).toBe(2);
    expect(r.totalCost).toBeLessThanOrEqual(2000);
  });

  it("honours a capacity cap alongside budget (exact 2-D)", () => {
    const items = [
      item("A", 100, 1000, 40),
      item("B", 100, 1000, 40),
      item("C", 100, 1000, 40),
    ];
    const r = optimisePortfolio(items, { budgetCap: 3000, capacityCap: 80 });
    expect(r.selected.length).toBe(2); // capacity, not budget, is binding
    expect(r.totalCapacity).toBeLessThanOrEqual(80);
    expect(r.method).toBe("exact");
  });

  it("forces must-fund projects in and pre-charges their cost", () => {
    const items = [item("A", 10, 3000), item("B", 500, 1000), item("C", 500, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 4000, mustFund: ["A"] });
    expect(r.selected).toContain("A");
    // A eats 3000 of the 4000, leaving room for exactly one of B/C.
    expect(r.totalCost).toBeLessThanOrEqual(4000);
    expect(r.selected.filter((id) => id === "B" || id === "C").length).toBe(1);
  });

  it("never funds a forbidden project", () => {
    const items = [item("A", 999, 1000), item("B", 100, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 5000, forbid: ["A"] });
    expect(r.selected).not.toContain("A");
    expect(r.selected).toContain("B");
  });

  it("uncapped budget funds every positive-value project", () => {
    const items = [item("A", 5, 1000), item("B", -1, 1000), item("C", 8, 1000)];
    const r = optimisePortfolio(items, { budgetCap: null });
    expect(r.selected.sort()).toEqual(["A", "C"]);
  });

  it("returns a monotonic-nondecreasing efficient frontier ending at the cap value", () => {
    const items = [item("A", 3000, 3000), item("B", 2600, 2000), item("C", 2600, 2000)];
    const r = optimisePortfolio(items, { budgetCap: 4000 });
    for (let i = 1; i < r.frontier.length; i++) {
      expect(r.frontier[i]!.value).toBeGreaterThanOrEqual(r.frontier[i - 1]!.value);
    }
    expect(r.frontier.at(-1)!.value).toBe(r.totalValue);
  });

  it("is deterministic — same inputs give the same selection + value", () => {
    const items = [item("A", 3000, 3000), item("B", 2600, 2000), item("C", 2600, 2000)];
    const a = optimisePortfolio(items, { budgetCap: 4000 });
    const b = optimisePortfolio(items, { budgetCap: 4000 });
    expect(a.selected.sort()).toEqual(b.selected.sort());
    expect(a.totalValue).toBe(b.totalValue);
  });
});
