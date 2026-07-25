import { describe, it, expect } from "vitest";
import { summariseStatements } from "./financial-statements";

describe("summariseStatements (finance F9)", () => {
  it("rolls up income/cost into gross profit + margin and invoiced/unbilled", () => {
    const s = summariseStatements([
      { revenue: 1000, actualCost: 600, invoicedAmount: 400 },
      { revenue: 500, actualCost: 200, invoicedAmount: 500 },
    ]);
    expect(s.income).toBe(1500);
    expect(s.cost).toBe(800);
    expect(s.grossProfit).toBe(700);
    expect(s.marginPct).toBe(47); // round(700/1500*100)
    expect(s.invoiced).toBe(900);
    expect(s.unbilled).toBe(600); // 1500 − 900
    expect(s.count).toBe(2);
  });

  it("handles a loss, zero income, and non-finite values without NaN", () => {
    const loss = summariseStatements([{ revenue: 100, actualCost: 250 }]);
    expect(loss.grossProfit).toBe(-150);
    expect(loss.marginPct).toBe(-150); // round(-150/100*100)

    const noIncome = summariseStatements([{ actualCost: 300 }]);
    expect(noIncome.income).toBe(0);
    expect(noIncome.marginPct).toBe(0); // guarded, no divide-by-zero
    expect(noIncome.unbilled).toBe(0);

    const junk = summariseStatements([{ revenue: Number.NaN, actualCost: undefined, invoicedAmount: null }]);
    expect(junk.income).toBe(0);
    expect(junk.count).toBe(0); // nothing costed/earning
  });

  it("is empty for no items", () => {
    expect(summariseStatements([])).toEqual({ income: 0, cost: 0, grossProfit: 0, marginPct: 0, invoiced: 0, unbilled: 0, count: 0 });
  });
});
