import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketStart, bucketsIn, computeSeries, unavailableSeries, TREND_METRICS } from "./trends";
import type { EntitySnapshot } from "./types";

const snap = (id: string, asOf: string, values: Record<string, unknown>): EntitySnapshot => ({
  entity: "issue", id, asOf, values, provenance: "replayed",
});

test("bucketStart truncates to day/week/month/quarter in UTC", () => {
  assert.equal(bucketStart("2026-03-18T13:45:00Z", "day"), "2026-03-18T00:00:00.000Z");
  assert.equal(bucketStart("2026-03-18T13:45:00Z", "month"), "2026-03-01T00:00:00.000Z");
  assert.equal(bucketStart("2026-03-18T13:45:00Z", "quarter"), "2026-01-01T00:00:00.000Z");
  // 2026-03-18 is a Wednesday ⇒ week starts Monday 2026-03-16
  assert.equal(bucketStart("2026-03-18T13:45:00Z", "week"), "2026-03-16T00:00:00.000Z");
});

test("bucketsIn covers [from,to) at the grain", () => {
  const buckets = bucketsIn({ from: "2026-01-01T00:00:00Z", to: "2026-04-01T00:00:00Z" }, "month");
  assert.deepEqual(buckets, [
    "2026-01-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z",
    "2026-03-01T00:00:00.000Z",
  ]);
});

test("computeSeries takes the as-of state at each bucket end and rolls entities up (mean)", () => {
  const snapshots = [
    snap("1", "2026-01-05T00:00:00Z", { percentWorkComplete: 20 }),
    snap("1", "2026-02-05T00:00:00Z", { percentWorkComplete: 60 }),
    snap("2", "2026-01-10T00:00:00Z", { percentWorkComplete: 0 }),
    snap("2", "2026-02-10T00:00:00Z", { percentWorkComplete: 40 }),
  ];
  const series = computeSeries(snapshots, "completionPct", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" }, "month");
  assert.equal(series.available, true);
  // Jan bucket end = Feb 1: entity1=20, entity2=0 ⇒ mean 10
  assert.equal(series.points[0]!.value, 10);
  assert.equal(series.points[0]!.n, 2);
  // Feb bucket end = Mar 1: entity1=60, entity2=40 ⇒ mean 50
  assert.equal(series.points[1]!.value, 50);
});

test("openBlockers aggregates as a sum across entities", () => {
  const snapshots = [
    snap("1", "2026-01-05T00:00:00Z", { blocked: true }),
    snap("2", "2026-01-06T00:00:00Z", { blocked: true }),
    snap("3", "2026-01-07T00:00:00Z", { blocked: false }),
  ];
  const series = computeSeries(snapshots, "openBlockers", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "month");
  assert.equal(series.points[0]!.value, 2);
});

test("a bucket with no observations is a null gap, not a zero", () => {
  const snapshots = [snap("1", "2026-02-05T00:00:00Z", { percentWorkComplete: 50 })];
  const series = computeSeries(snapshots, "completionPct", { from: "2026-01-01T00:00:00Z", to: "2026-03-01T00:00:00Z" }, "month");
  assert.equal(series.points[0]!.value, null); // Jan: nothing yet
  assert.equal(series.points[0]!.n, 0);
  assert.equal(series.points[1]!.value, 50); // Feb
});

test("benefitRealisedPct derives from planned/actual when no direct value", () => {
  const snapshots = [snap("1", "2026-01-05T00:00:00Z", { plannedBenefitValue: 200, actualBenefitValue: 50 })];
  const series = computeSeries(snapshots, "benefitRealisedPct", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "month");
  assert.equal(series.points[0]!.value, 25);
});

test("unavailableSeries is honest — not available, empty, with a reason", () => {
  const s = unavailableSeries("cpi", "week", { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, "history domain not enabled");
  assert.equal(s.available, false);
  assert.equal(s.points.length, 0);
  assert.equal(s.reason, "history domain not enabled");
});

test("TREND_METRICS lists the supported metrics", () => {
  assert.ok(TREND_METRICS.includes("cpi"));
  assert.ok(TREND_METRICS.includes("completionPct"));
});
