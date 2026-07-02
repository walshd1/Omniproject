import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "./demo";
import type { ActorContext } from "./types";

/**
 * The demo broker has no real FX history, so it can't serve a genuinely different
 * rate for a past date — the FX rate-source + as-of-date policy still degrades
 * gracefully: it stamps the requested `asOf` onto its (unchanged) indicative
 * table rather than silently ignoring the hint, so a period-close/budget-rate
 * report at least shows a coherent "as of" date instead of today's.
 */
const ctx = {} as ActorContext;

test("fxRates: no opts ⇒ today's indicative snapshot, unmodified", async () => {
  const b = new DemoBroker();
  const fx = await b.fxRates(ctx);
  assert.equal(fx.provenance, "sample");
  assert.ok(fx.base);
});

test("fxRates: opts.asOf stamps the returned table's asOf (rates unchanged)", async () => {
  const b = new DemoBroker();
  const spot = await b.fxRates(ctx);
  const asOf = await b.fxRates(ctx, { asOf: "2026-01-01T00:00:00.000Z" });
  assert.equal(asOf.asOf, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(asOf.rates, spot.rates); // same indicative table, just re-dated
  assert.equal(asOf.base, spot.base);
});
