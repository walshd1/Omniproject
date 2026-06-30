import { describe, it, expect } from "vitest";
import { summariseIncome, hasIncome, type IncomeInput } from "./income";

const item = (over: Partial<IncomeInput> = {}): IncomeInput => ({ id: "i", ...over });

describe("summariseIncome", () => {
  it("totals projected vs invoiced and derives the unbilled gap + billed %", () => {
    const s = summariseIncome([
      item({ id: "a", revenue: 90000, invoicedAmount: 50000, purchaseOrder: "PO-1" }),
      item({ id: "b", revenue: 10000, invoicedAmount: 10000 }),
    ]);
    expect(s.projected).toBe(100000);
    expect(s.invoiced).toBe(60000);
    expect(s.unbilled).toBe(40000);
    expect(s.billedPct).toBe(60);
    expect(s.count).toBe(2);
  });

  it("sorts rows by unbilled desc and carries the PO reference", () => {
    const s = summariseIncome([
      item({ id: "small", revenue: 100, invoicedAmount: 90 }),
      item({ id: "big", revenue: 1000, invoicedAmount: 0, purchaseOrder: "PO-9" }),
    ]);
    expect(s.rows[0]!.id).toBe("big");
    expect(s.rows[0]!.purchaseOrder).toBe("PO-9");
  });

  it("ignores items with no income signal and never reports negative backlog", () => {
    expect(hasIncome(item({ id: "x" }))).toBe(false);
    const s = summariseIncome([item({ id: "over", revenue: 100, invoicedAmount: 150 }), item({ id: "none" })]);
    expect(s.count).toBe(1); // the no-income item is dropped
    expect(s.unbilled).toBe(0); // over-invoiced → clamped, not negative
  });
});
