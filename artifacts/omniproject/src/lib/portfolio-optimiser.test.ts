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

  it("funds a zero-cost positive-value project for free (infinite density) and never a zero-value one", () => {
    const items = [item("Free", 5, 0), item("Nil", 0, 1000), item("Real", 8, 2000)];
    const r = optimisePortfolio(items, { budgetCap: 2000 });
    expect(r.selected).toContain("Free"); // zero cost → always worth taking
    expect(r.selected).toContain("Real");
    expect(r.selected).not.toContain("Nil"); // vi <= 0 never helps a value-maximising knapsack
    expect(r.greedyValue).toBeGreaterThanOrEqual(13); // greedy density counts the free item too
  });

  it("respects a coarser cost granularity (buckets rounded up) while staying under the cap", () => {
    const items = [item("A", 10, 1500), item("B", 9, 1500), item("C", 8, 1500)];
    const r = optimisePortfolio(items, { budgetCap: 3000, costGranularity: 2 });
    expect(r.method).toBe("exact");
    expect(r.totalCost).toBeLessThanOrEqual(3000);
  });

  it("excludes an id that is both must-fund and forbidden (forbid wins, it is neither forced nor a candidate)", () => {
    const items = [item("X", 999, 1000), item("Y", 5, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 5000, mustFund: ["X"], forbid: ["X"] });
    expect(r.selected).not.toContain("X");
    expect(r.selected).toContain("Y");
  });

  it("lifts the efficient frontier by the pre-charged must-fund value/cost", () => {
    const items = [item("A", 10, 3000), item("B", 4, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 5000, mustFund: ["A"] });
    // The frontier's first point sits at the forced cost carrying the forced value.
    expect(r.frontier[0]).toEqual({ budget: 3000, value: 10 });
    expect(r.frontier.at(-1)!.value).toBe(r.totalValue);
  });

  it("uncapped budget WITH a capacity cap runs the density-greedy+swap heuristic and reports it", () => {
    // Budget is free; capacity 100 is the only constraint. Density order fills the cheap dense A first,
    // which blocks the far more valuable C — the local-search swap must replace A with C.
    const items = [
      item("A", 10, 1, 60),
      item("B", 9, 1, 60),
      item("C", 100, 100, 100),
    ];
    const r = optimisePortfolio(items, { budgetCap: null, capacityCap: 100 });
    expect(r.method).toBe("heuristic");
    expect(r.selected).toEqual(["C"]); // the swap beat the greedy fill
    expect(r.totalValue).toBe(100);
    expect(r.totalCapacity).toBeLessThanOrEqual(100);
    expect(r.greedyValue).toBe(10); // plain greedy would have stopped at A
    expect(r.totalValue).toBeGreaterThan(r.greedyValue);
  });

  it("uncapped budget AND no capacity cap simply funds every positive-value candidate", () => {
    const items = [item("A", 5, 10, 40), item("B", -2, 10, 40), item("C", 7, 10, 40)];
    const r = optimisePortfolio(items, { budgetCap: null, capacityCap: null });
    expect(r.method).toBe("exact");
    expect(r.selected.sort()).toEqual(["A", "C"]);
  });

  it("falls back to the heuristic when the exact 2-D grid would exceed the cell cap", () => {
    // W ≈ 8000 (budget £8bn in £k) × C ≈ 500 buckets > 4,000,000 cells ⇒ heuristic path.
    const items = [
      item("A", 100, 1_000_000, 100_000),
      item("B", 90, 1_000_000, 100_000),
      item("C", 80, 1_000_000, 100_000),
    ];
    const r = optimisePortfolio(items, { budgetCap: 8_000_000, capacityCap: 250_000 });
    expect(r.method).toBe("heuristic");
    expect(r.totalCapacity).toBeLessThanOrEqual(250_000);
    expect(r.totalCost).toBeLessThanOrEqual(8_000_000);
  });

  it("clamps a must-fund overspend to a zero remaining budget (no candidate can be added)", () => {
    const items = [item("A", 10, 6000), item("B", 5, 1000)];
    const r = optimisePortfolio(items, { budgetCap: 4000, mustFund: ["A"] });
    expect(r.selected).toEqual(["A"]); // A forced despite blowing the cap; nothing left for B
    expect(r.selected).not.toContain("B");
  });

  it("returns empty selection and a zero frontier for no items", () => {
    const r = optimisePortfolio([], { budgetCap: 1000 });
    expect(r.selected).toEqual([]);
    expect(r.totalValue).toBe(0);
    expect(r.frontier.every((p) => p.value === 0)).toBe(true);
  });
});
