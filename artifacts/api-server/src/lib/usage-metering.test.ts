import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  recordUsage, currentTotal, usageSeries, knownVendors, bucketStamp, recentStamps,
  warningLevel, limitStatus, pointCost, normalizeVendor,
} from "./usage-metering";
import { __resetSharedStateForTest } from "./shared-state";

/**
 * External-API usage meter — fleet-wide per-vendor call/token counters at hour/day/month, plus the
 * policy-driven limit/warning bands and cost derivation. Uses the in-process shared KV + a fixed clock.
 */
beforeEach(() => __resetSharedStateForTest());

// 2026-07-14T13:37Z
const T = Date.UTC(2026, 6, 14, 13, 37, 0);

test("bucketStamp is UTC and per-granularity", () => {
  assert.equal(bucketStamp("hour", T), "2026071413");
  assert.equal(bucketStamp("day", T), "20260714");
  assert.equal(bucketStamp("month", T), "202607");
});

test("recentStamps walks back newest-first (hours, days, months incl. year rollover)", () => {
  assert.deepEqual(recentStamps("hour", 3, T), ["2026071413", "2026071412", "2026071411"]);
  assert.deepEqual(recentStamps("day", 2, T), ["20260714", "20260713"]);
  // January → prior December/November across the year boundary.
  const jan = Date.UTC(2026, 0, 15, 0, 0, 0);
  assert.deepEqual(recentStamps("month", 3, jan), ["202601", "202512", "202511"]);
});

test("normalizeVendor is key-safe (no colon injection, bounded)", () => {
  assert.equal(normalizeVendor("OpenAI:evil:key"), "openai-evil-key");
  assert.equal(normalizeVendor("  Jira  "), "jira");
  assert.equal(normalizeVendor(""), "unknown");
});

test("records calls+tokens and rolls up into hour/day/month totals fleet-wide", async () => {
  await recordUsage("openai", { calls: 1, tokens: 500 }, T);
  await recordUsage("openai", { calls: 1, tokens: 250 }, T);
  assert.equal(await currentTotal("openai", "calls", "hour", T), 2);
  assert.equal(await currentTotal("openai", "tokens", "hour", T), 750);
  assert.equal(await currentTotal("openai", "tokens", "day", T), 750);
  assert.equal(await currentTotal("openai", "tokens", "month", T), 750);
});

test("usageSeries returns newest-first points and knownVendors lists recorded vendors", async () => {
  await recordUsage("jira", { calls: 3 }, T);
  await recordUsage("jira", { calls: 5 }, T - 3_600_000); // previous hour
  const series = await usageSeries("jira", "hour", 2, T);
  assert.deepEqual(series.map((p) => p.calls), [3, 5]);
  assert.deepEqual(await knownVendors(), ["jira"]);
});

test("warningLevel bands: 50/75/90/100", () => {
  assert.equal(warningLevel(0.2), "ok");
  assert.equal(warningLevel(0.5), "notice");
  assert.equal(warningLevel(0.75), "warn");
  assert.equal(warningLevel(0.9), "critical");
  assert.equal(warningLevel(1), "over");
  assert.equal(warningLevel(1.4), "over");
});

test("limitStatus reflects current-period usage vs the configured max", async () => {
  await recordUsage("openai", { tokens: 900 }, T);
  const status = await limitStatus("openai", { period: "day", metric: "tokens", max: 1000 }, T);
  assert.equal(status?.used, 900);
  assert.equal(status?.fraction, 0.9);
  assert.equal(status?.level, "critical");
  assert.equal(await limitStatus("openai", undefined, T), null); // no policy ⇒ no status
});

test("pointCost derives money from a cost policy (per call / token / 1k tokens)", () => {
  assert.equal(pointCost({ calls: 10, tokens: 0 }, { per: "call", amount: 0.002, currency: "USD" }), 0.02);
  assert.equal(pointCost({ calls: 0, tokens: 2000 }, { per: "ktoken", amount: 0.5, currency: "USD" }), 1);
  assert.equal(pointCost({ calls: 0, tokens: 100 }, { per: "token", amount: 0.0001, currency: "USD" }), 0.01);
  assert.equal(pointCost({ calls: 5, tokens: 5 }, undefined), 0);
});
