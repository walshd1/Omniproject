import { test } from "node:test";
import assert from "node:assert/strict";
import { buildConfigDiff, CONFIG_DIFF_SCHEMA } from "./config-diff";

/**
 * config-diff (§4.9): compare two full backups → content-free change report (settings by key, defs by id +
 * rowVersion). The wedge-sharpener vs SAP CTS/CTS+ — preview a restore / detect drift before applying.
 */

const NOW = "2026-07-17T00:00:00.000Z";

/** Minimal full-backup envelope for the test. */
const backup = (settings: Record<string, unknown>, collections: unknown[] = [], stores?: Record<string, unknown>) => ({
  schema: "omniproject/full-backup", version: 1, createdAt: NOW,
  settings: { schema: "omniproject/config-snapshot", version: 1, createdAt: NOW, settings },
  defStore: { schema: "omniproject/def-store-export", version: 1, createdAt: NOW, collections },
  ...(stores ? { stores } : {}),
});
const col = (type: string, scope: unknown, items: unknown[]) => ({ type, scope, items });
const def = (id: string, rowVersion: number, extra: Record<string, unknown> = {}) => ({ id, rowVersion, ...extra });

test("identical backups diff to nothing", () => {
  const b = backup({ branding: null, reportingCurrency: "GBP" }, [col("def", { kind: "org" }, [def("d1", 1)])]);
  const d = buildConfigDiff(b, structuredClone(b), NOW);
  assert.equal(d.schema, CONFIG_DIFF_SCHEMA);
  assert.equal(d.identical, true);
  assert.equal(d.settings.changed.length, 0);
  assert.equal(d.defStore.length, 0);
});

test("settings diff reports added / removed / changed by KEY, never values", () => {
  const from = backup({ reportingCurrency: "GBP", branding: { productName: "A" }, hiddenFields: ["x"] });
  const to = backup({ reportingCurrency: "USD", branding: { productName: "A" }, priorityLabels: { p1: "Top" } });
  const d = buildConfigDiff(from, to, NOW);
  assert.equal(d.identical, false);
  assert.deepEqual(d.settings.added, ["priorityLabels"]);   // in `to` only
  assert.deepEqual(d.settings.removed, ["hiddenFields"]);    // in `from` only
  assert.deepEqual(d.settings.changed.filter((c) => c.status === "changed").map((c) => c.key), ["reportingCurrency"]);
  assert.equal(d.settings.unchanged, 1);                     // branding unchanged
  // The report carries key names + status only — no setting VALUES leak.
  assert.equal(JSON.stringify(d).includes("USD"), false);
  assert.equal(JSON.stringify(d).includes("GBP"), false);
});

test("a secret-bearing settings key is flagged secret and still content-free", () => {
  const from = backup({ webhooks: [{ id: "w", url: "https://a", secret: "s1" }] });
  const to = backup({ webhooks: [{ id: "w", url: "https://a", secret: "s2" }] });
  const d = buildConfigDiff(from, to, NOW);
  const wh = d.settings.changed.find((c) => c.key === "webhooks");
  assert.ok(wh && wh.status === "changed" && wh.secret === true);
  assert.equal(JSON.stringify(d).includes("s1") || JSON.stringify(d).includes("s2"), false, "secret values never appear");
});

test("def-store diff groups by scope+type and reports id + rowVersion transitions", () => {
  const from = backup({}, [
    col("def", { kind: "org" }, [def("keep", 3), def("gone", 1), def("bump", 1)]),
    col("def", { kind: "user", sub: "u1" }, [def("up1", 2)]),
  ]);
  const to = backup({}, [
    col("def", { kind: "org" }, [def("keep", 3), def("bump", 2), def("new", 1)]),
    col("def", { kind: "user", sub: "u1" }, [def("up1", 2)]),
  ]);
  const d = buildConfigDiff(from, to, NOW);
  // The user-scope collection is unchanged → omitted; only the org collection appears.
  assert.equal(d.defStore.length, 1);
  const org = d.defStore[0]!;
  assert.equal(org.scopeLabel, "org");
  assert.equal(org.added, 1);   // new
  assert.equal(org.removed, 1); // gone
  assert.equal(org.changed, 1); // bump 1→2
  const bump = org.items.find((i) => i.id === "bump")!;
  assert.deepEqual([bump.status, bump.fromRowVersion, bump.toRowVersion], ["changed", 1, 2]);
  assert.equal(d.summary.defsAdded, 1);
  assert.equal(d.summary.defsRemoved, 1);
  assert.equal(d.summary.defsChanged, 1);
});

test("extra sealed stores are compared for PRESENCE only (contents never diffed)", () => {
  const from = backup({}, [], { auditLog: [{ ts: NOW, seal: { seq: 1 } }], rateCard: { card: {} } });
  const to = backup({}, [], { auditLog: [{ ts: NOW, seal: { seq: 2 } }] });
  const d = buildConfigDiff(from, to, NOW);
  const audit = d.extraStores.find((s) => s.name === "auditLog")!;
  const rate = d.extraStores.find((s) => s.name === "rateCard")!;
  assert.deepEqual([audit.from, audit.to], [true, true]);
  assert.deepEqual([rate.from, rate.to], [true, false]); // present on baseline, absent on candidate
  // No store contents (seq numbers, card) leak into the diff.
  assert.equal(JSON.stringify(d.extraStores).includes("seq"), false);
});

test("throws on a non-full-backup envelope", () => {
  assert.throws(() => buildConfigDiff({ schema: "nope" }, backup({}), NOW), /schema/i);
});
