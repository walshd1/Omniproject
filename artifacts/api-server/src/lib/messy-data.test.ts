import { test } from "node:test";
import assert from "node:assert/strict";
import {
  messifyRows,
  messifyRow,
  getMessyConfig,
  setMessyConfig,
  messyDataConfigFromEnv,
  MESSY_GREMLINS,
  type MessyConfig,
} from "./messy-data";
import type { Row } from "../broker/types";

/**
 * The messy-data transform is a PURE, deterministic imperfection injector. These
 * tests pin the properties the broker decorator and the dev surface rely on:
 * determinism, non-mutation of the input, the intensity=0 no-op, gremlin selection,
 * and the protected structural key.
 */

function sample(): Row[] {
  return [
    { id: "iss-1", projectId: "p-1", title: "Migrate auth", status: "done", priority: "high", currency: "GBP", budget: 45000, startDate: "2026-06-10", dueDate: "2026-06-28", labels: ["auth", "infra"], billable: true, source: "jira" },
    { id: "iss-2", projectId: "p-1", title: "Broker flow", status: "in_progress", priority: "medium", currency: "GBP", budget: 30000, startDate: "2026-06-20", dueDate: "2026-07-05", labels: ["integration"], billable: false, source: "jira" },
    { id: "iss-3", projectId: "p-2", title: "SSO relay", status: "todo", priority: "urgent", currency: "USD", budget: 12000, startDate: "2026-06-01", dueDate: "2026-06-25", labels: [], billable: true, source: "github" },
  ];
}

const cfg = (over: Partial<MessyConfig> = {}): MessyConfig => ({ on: true, seed: "test", intensity: 0.4, gremlins: [], ...over });

test("intensity 0 is a faithful no-op (rows come back untouched)", () => {
  const rows = sample();
  const out = messifyRows(rows, cfg({ intensity: 0 }), "listIssues");
  assert.deepEqual(out, rows);
});

test("the same seed reproduces the same mess; a different seed differs", () => {
  const a = messifyRows(sample(), cfg({ intensity: 1, seed: "alpha" }), "listIssues");
  const b = messifyRows(sample(), cfg({ intensity: 1, seed: "alpha" }), "listIssues");
  const c = messifyRows(sample(), cfg({ intensity: 1, seed: "beta" }), "listIssues");
  assert.deepEqual(a, b); // deterministic
  assert.notDeepEqual(a, c); // seed actually varies the output
});

test("it never mutates the input rows (mess lands on a copy)", () => {
  const rows = sample();
  const snapshot = JSON.parse(JSON.stringify(rows));
  messifyRows(rows, cfg({ intensity: 1 }), "listIssues");
  assert.deepEqual(rows, snapshot);
});

test("the protected structural key (projectId) is always preserved", () => {
  const rows = sample();
  const out = messifyRows(rows, cfg({ intensity: 1 }), "listIssues");
  for (let i = 0; i < rows.length; i++) {
    assert.equal(out[i]!["projectId"], rows[i]!["projectId"]);
  }
});

test("gremlin selection is honoured — only the chosen gremlin can change a row", () => {
  // Only 'missingSource' active: no field other than `source` may ever change.
  const rows = sample();
  const out = messifyRows(rows, cfg({ intensity: 1, gremlins: ["missingSource"] }), "listIssues");
  for (let i = 0; i < rows.length; i++) {
    for (const k of Object.keys(rows[i]!)) {
      if (k === "source") continue;
      assert.deepEqual(out[i]![k], rows[i]![k], `field ${k} should be untouched`);
    }
  }
});

test("at full intensity with all gremlins, most rows are visibly messed", () => {
  const rows = sample();
  const out = messifyRows(rows, cfg({ intensity: 1 }), "listIssues");
  const changed = out.filter((r, i) => JSON.stringify(r) !== JSON.stringify(rows[i])).length;
  assert.ok(changed >= 2, `expected most rows changed, got ${changed}`);
});

test("messifyRow messifies a single record deterministically", () => {
  const row = sample()[0]!;
  const a = messifyRow({ ...row }, cfg({ intensity: 1 }), "getIssue");
  const b = messifyRow({ ...row }, cfg({ intensity: 1 }), "getIssue");
  assert.deepEqual(a, b);
  assert.equal(a["projectId"], row["projectId"]);
});

test("config setter clamps intensity and filters unknown gremlins", () => {
  const before = getMessyConfig();
  try {
    const c = setMessyConfig({ on: true, intensity: 5, gremlins: ["nullify", "not-a-gremlin"] });
    assert.equal(c.intensity, 1); // clamped to [0,1]
    assert.deepEqual(c.gremlins, ["nullify"]); // unknown dropped
    const c2 = setMessyConfig({ intensity: -3 });
    assert.equal(c2.intensity, 0);
    assert.equal(c2.on, true); // untouched fields preserved
  } finally {
    setMessyConfig(before); // restore shared module state
  }
});

test("env config parses flags, clamps intensity, and defaults sanely", () => {
  const saved = { on: process.env["OMNI_MESSY_DATA"], i: process.env["OMNI_MESSY_INTENSITY"], g: process.env["OMNI_MESSY_GREMLINS"] };
  try {
    process.env["OMNI_MESSY_DATA"] = "true";
    process.env["OMNI_MESSY_INTENSITY"] = "2";
    process.env["OMNI_MESSY_GREMLINS"] = "nullify, all, bogus";
    const c = messyDataConfigFromEnv();
    assert.equal(c.on, true);
    assert.equal(c.intensity, 1); // clamped
    assert.deepEqual(c.gremlins, ["nullify"]); // 'all'/unknown stripped
    delete process.env["OMNI_MESSY_DATA"];
    delete process.env["OMNI_MESSY_INTENSITY"];
    assert.equal(messyDataConfigFromEnv().on, false);
    assert.equal(messyDataConfigFromEnv().intensity, 0.4); // default
  } finally {
    for (const [k, v] of [["OMNI_MESSY_DATA", saved.on], ["OMNI_MESSY_INTENSITY", saved.i], ["OMNI_MESSY_GREMLINS", saved.g]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("the gremlin catalogue is non-empty with unique ids", () => {
  assert.ok(MESSY_GREMLINS.length >= 8);
  const ids = MESSY_GREMLINS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});
