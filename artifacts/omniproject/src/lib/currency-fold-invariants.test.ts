import { describe, it, expect } from "vitest";
import { check, gen, type Rng } from "../test/proptest";
import { rollupBySpec, type ProjectItems } from "./portfolio-value";
import { realisationPipeline } from "./benefits-realisation";
import { scorePortfolio, type ProjectPriorityInput } from "./portfolio-priority";

/**
 * The CROSS-CURRENCY FOLD INVARIANT, enforced as a property test.
 *
 * A whole class of financial-correctness bugs lived here: a portfolio roll-up that sums
 * `convertAmount(...)` across projects WITHOUT an `isConvertible` guard silently adds a project's RAW
 * foreign amount into the consolidated total whenever its currency has no FX rate (convertAmount passes
 * the amount through unchanged on a missing rate). Four+ roll-ups shipped with this bug.
 *
 * The invariant that makes the bug impossible: **folding in an FX-UNCONVERTIBLE project must never
 * change the consolidated money total** — it may only increment the excluded count. Equivalently, a
 * consolidated total can only ever be the sum of the CONVERTIBLE rows. This property asserts exactly
 * that over hundreds of generated multi-currency portfolios, so any future roll-up that regresses to a
 * raw cross-currency sum fails here. (Golden-master example cases live alongside the per-fold tests in
 * portfolio-value / benefits-realisation / portfolio-priority.)
 */

// Convertible currencies HAVE a rate in the table; "unconvertible" ones deliberately do NOT.
const RATES: Record<string, number> = { GBP: 1, USD: 1.25, EUR: 1.1 };
const CONVERTIBLE = ["GBP", "USD", "EUR"] as const;
const UNCONVERTIBLE = ["JPY", "CHF", "INR", "BRL"] as const; // absent from RATES

const money = (r: Rng): number => gen.int(r, 0, 1_000_000);

function incomeProject(r: Rng, currency: string): ProjectItems {
  return {
    projectId: gen.string(r, "abcdef", 6) || "p", projectName: "P", programmeId: null, programmeName: null,
    currency,
    items: gen.array(r, (rr) => ({ id: gen.string(rr, "xyz", 4) || "i", title: "t", revenue: money(rr), invoicedAmount: money(rr) }), 4) as ProjectItems["items"],
  };
}
function benefitProject(r: Rng, currency: string): ProjectItems {
  return {
    projectId: gen.string(r, "abcdef", 6) || "p", projectName: "P", programmeId: null, programmeName: null,
    currency,
    items: gen.array(r, (rr) => ({ id: gen.string(rr, "xyz", 4) || "i", title: "t", plannedBenefitValue: money(rr), actualBenefitValue: money(rr), benefitConfidence: gen.int(rr, 0, 100) }), 4) as ProjectItems["items"],
  };
}

/** A scenario: some convertible projects + some deliberately-unconvertible ones + the target currency. */
function scenario(make: (r: Rng, currency: string) => ProjectItems) {
  return (r: Rng) => {
    const target = gen.pick(r, CONVERTIBLE);
    const convertible = Array.from({ length: gen.int(r, 1, 5) }, () => make(r, gen.pick(r, CONVERTIBLE)));
    const unconvertible = Array.from({ length: gen.int(r, 0, 4) }, () => make(r, gen.pick(r, UNCONVERTIBLE)));
    return { target, convertible, unconvertible };
  };
}

describe("cross-currency fold invariant: unconvertible rows never change the money total", () => {
  it("rollupIncome — portfolio projected/invoiced are unchanged by unconvertible projects", () => {
    check(scenario(incomeProject), ({ target, convertible, unconvertible }) => {
      const base = rollupBySpec("income", convertible, target, RATES).portfolio;
      const withUnconv = rollupBySpec("income", [...convertible, ...unconvertible], target, RATES).portfolio;
      expect(withUnconv.metrics["projected"]).toBeCloseTo(base.metrics["projected"], 6);
      expect(withUnconv.metrics["invoiced"]).toBeCloseTo(base.metrics["invoiced"], 6);
      expect(withUnconv.excludedForFx).toBe(base.excludedForFx + unconvertible.length);
    });
  });

  it("rollupBenefits — portfolio planned/actual are unchanged by unconvertible projects", () => {
    check(scenario(benefitProject), ({ target, convertible, unconvertible }) => {
      const base = rollupBySpec("benefits", convertible, target, RATES).portfolio;
      const withUnconv = rollupBySpec("benefits", [...convertible, ...unconvertible], target, RATES).portfolio;
      expect(withUnconv.metrics["planned"]).toBeCloseTo(base.metrics["planned"], 6);
      expect(withUnconv.metrics["actual"]).toBeCloseTo(base.metrics["actual"], 6);
      expect(withUnconv.excludedForFx).toBe(base.excludedForFx + unconvertible.length);
    });
  });

  it("realisationPipeline — totals are unchanged by unconvertible projects", () => {
    check(scenario(benefitProject), ({ target, convertible, unconvertible }) => {
      const base = realisationPipeline(convertible, target, RATES);
      const withUnconv = realisationPipeline([...convertible, ...unconvertible], target, RATES);
      expect(withUnconv.totalPlanned).toBeCloseTo(base.totalPlanned, 6);
      expect(withUnconv.totalActual).toBeCloseTo(base.totalActual, 6);
      // Only projects that actually carry a benefit row count as excluded.
      const excludable = unconvertible.filter((p) => p.items.length > 0).length;
      expect(withUnconv.excludedForFx).toBe(base.excludedForFx + excludable);
    });
  });

  it("scorePortfolio — an unconvertible project's benefitValue folds in as 0, never a raw foreign amount", () => {
    check(
      (r: Rng) => {
        const target = gen.pick(r, CONVERTIBLE);
        const input: ProjectPriorityInput = {
          projectId: "p", projectName: "P", programmeId: null, programmeName: null,
          currency: gen.pick(r, UNCONVERTIBLE),
          items: [{ id: "b", title: "t", plannedBenefitValue: money(r), benefitConfidence: 100 }] as ProjectPriorityInput["items"],
          cost: 0, capacityHours: 0,
        };
        return { target, input };
      },
      ({ target, input }) => {
        const scored = scorePortfolio([input], undefined, { rates: RATES, target });
        expect(scored[0]!.benefitValue).toBe(0);
      },
    );
  });
});
