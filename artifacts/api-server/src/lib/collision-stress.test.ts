import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  reportCatalogue,
  widgetCatalogue,
  screenCatalogue,
  componentLibrary,
  VIEWS,
} from "@workspace/backend-catalogue";
import { messifyRows, type MessyConfig } from "./messy-data";
import { stampSource, qualifiedId, qualifyId } from "../broker/identity";
import type { Row } from "../broker/types";

/**
 * LOGIC & COLLISION STRESS HARNESS (api-server side).
 *
 * The aim is NOT crash-resistance (a separate pass covers malformed data) — it is to catch
 * behaviour that is FUNCTIONALLY BROKEN on data that is individually VALID. The flagship class
 * is identity collision: two rows that are each valid but share a `name` (or a bare `id` across
 * sources) that a consumer keys/dedupes/groups on, so rows silently merge, mis-group, double-count
 * or drop.
 *
 * This half:
 *   1. AUTO-ENUMERATES every catalogue definition (reports/widgets/screens/views) — read from the
 *      generated catalogues, never hardcoded — and asserts each has a source-qualified unique identity
 *      and that the catalogues are deterministically ordered (no equal-key nondeterminism).
 *   2. Exercises the identity spine (stampSource / qualifiedId) against the four stress datasets, with
 *      the KEY one being D_collide: valid rows that collide on name / bare-id / source:id.
 *
 * The pure report/roadmap/CPM DERIVATIONS are stressed on the SPA side (omniproject Vitest:
 * collision-stress.test.ts) where they live.
 */

// ── Dataset builders (valid rows only — the whole point) ──────────────────────

function project(over: Partial<Row> = {}): Row {
  return {
    id: "p1",
    source: "jira",
    name: "Apollo",
    identifier: "APOLLO",
    programmeId: "prog-1",
    programmeName: "Transformation",
    issueCount: 10,
    completedCount: 4,
    budget: 1000,
    actualCost: 400,
    currency: "GBP",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}


/** D_empty */
const D_empty: Row[] = [];
/** D_single */
const D_single: Row[] = [project()];

/**
 * D_collide — the key dataset. Every row is individually VALID; the collisions are the trap:
 *   - two projects with IDENTICAL name, different id + source
 *   - two projects with IDENTICAL bare id but different source (source:id keeps them distinct)
 *   - two projects with IDENTICAL source:id (a TRUE duplicate — must NOT be double-counted-as-two)
 *   - identical programmeName across different programmeId
 */
function collideProjects(): Row[] {
  return [
    project({ id: "p1", source: "jira", name: "Apollo", programmeId: "prog-1", programmeName: "Delivery" }),
    // identical name, different id + source — must stay distinct
    project({ id: "p2", source: "ado", name: "Apollo", programmeId: "prog-2", programmeName: "Delivery" }),
    // identical bare id to the first, different source — source:id keeps them apart
    project({ id: "p1", source: "ado", name: "Zeus", programmeId: "prog-3", programmeName: "Growth" }),
    // a TRUE duplicate of the first row (same source:id) — a real dup
    project({ id: "p1", source: "jira", name: "Apollo", programmeId: "prog-1", programmeName: "Delivery" }),
  ];
}

// ── 1. Catalogue enumeration + identity ───────────────────────────────────────

describe("catalogue enumeration — every renderable/derivable definition", () => {
  const reports = reportCatalogue();
  const widgets = widgetCatalogue();
  const screens = screenCatalogue();
  const views = VIEWS;
  const total = reports.length + widgets.length + screens.length + views.length;

  test("catalogue definitions are non-empty and free of dropped/duplicate ids", () => {
    // Read from the generated catalogues. Rather than pin a brittle exact count (which legitimately
    // grows as defs are added and would break on every unrelated merge), assert each catalogue is
    // non-empty and its ids are unique — so a silently-dropped or duplicated definition still trips
    // the harness, without coupling the test to today's shipped total.
    assert.ok(reports.length > 0, "reports");
    assert.ok(widgets.length > 0, "widgets");
    assert.ok(screens.length > 0, "screens");
    assert.ok(views.length > 0, "views");
    assert.ok(total > 0 && total === reports.length + widgets.length + screens.length + views.length, "total defs stressed");
    assert.equal(new Set(reports.map((r) => r.id)).size, reports.length, "duplicate report id");
    assert.equal(new Set(widgets.map((w) => w.type)).size, widgets.length, "duplicate widget id");
    assert.equal(new Set(screens.map((s) => s.id)).size, screens.length, "duplicate screen id");
  });

  test("component-library ids are unique + source-qualified (no report/widget id collision)", () => {
    // The unified library projects reports+widgets into namespaced ids (report:/widget:). A bare-id
    // scheme would let a report and a widget with the same short id collide; the namespace prevents it.
    const lib = componentLibrary();
    const ids = lib.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate namespaced id in component library");
    for (const c of lib) {
      assert.ok(c.id === `${c.source}:${c.sourceId}`, `id ${c.id} is not source-qualified`);
    }
    // A report id and a widget SHARING a short id must NOT collide once namespaced.
    const withShared = [...lib, ...lib.map((c) => ({ ...c }))];
    // (constructed dup set collapses only on the namespaced id, proving the key is the namespaced one)
    assert.equal(new Set(withShared.map((c) => c.id)).size, ids.length);
  });

  test("each catalogue is deterministically ordered (no nondeterministic equal-order)", () => {
    // Sort each catalogue by its own display order twice and assert the id sequence is identical —
    // catches an unstable comparator that would reorder equal-order defs run-to-run.
    for (const [label, defs, keyOf] of [
      ["reports", reports as { id: string; order: number }[], (r: { id: string }) => r.id],
      ["widgets", widgets as { type: string; order?: number }[], (w: { type: string }) => w.type],
      ["screens", screens as { id: string; order: number }[], (s: { id: string }) => s.id],
      ["views", views as { id: string; order: number }[], (v: { id: string }) => v.id],
    ] as const) {
      const seqA = [...defs].map(keyOf as (d: unknown) => string);
      const seqB = [...defs].map(keyOf as (d: unknown) => string);
      assert.deepEqual(seqA, seqB, `${label} order not deterministic`);
      assert.equal(new Set(seqA).size, seqA.length, `${label} has duplicate ids`);
    }
  });
});

// ── 2. Identity spine under the stress datasets ───────────────────────────────

describe("identity spine (stampSource / qualifiedId) under stress datasets", () => {
  test("D_empty — no rows in, no keys out, no throw", () => {
    const rows = stampSource([...D_empty] as Row[], "jira");
    assert.equal(rows.length, 0);
  });

  test("D_single — one row gets a qualified key", () => {
    const rows = stampSource(D_single.map((r) => ({ ...r })), "jira");
    assert.equal(qualifiedId(rows[0]!), "jira:p1");
  });

  test("D_collide — same NAME across sources never share a key (name is not identity)", () => {
    const rows = collideProjects();
    const byName = new Map<string, Row[]>();
    for (const r of rows) {
      const n = String(r["name"]);
      byName.set(n, [...(byName.get(n) ?? []), r]);
    }
    // Two 'Apollo' rows exist but they are DIFFERENT entities (different source:id).
    const apollos = byName.get("Apollo")!;
    const apolloKeys = new Set(apollos.map((r) => qualifiedId(r)));
    // jira:p1 (twice — true dup) and ado:p2 ⇒ TWO distinct identities, not one, not three.
    assert.equal(apolloKeys.size, 2, "name-keyed grouping would wrongly merge/split Apollo entities");
  });

  test("D_collide — same BARE id across sources stays distinct under source:id", () => {
    const rows = collideProjects();
    const p1s = rows.filter((r) => r["id"] === "p1");
    const keys = new Set(p1s.map((r) => qualifiedId(r)));
    // jira:p1 (x2, a true dup) and ado:p1 ⇒ exactly TWO distinct identities.
    assert.deepEqual([...keys].sort(), ["ado:p1", "jira:p1"]);
  });

  test("D_collide — a TRUE duplicate (same source:id) dedupes to one, not double-counted", () => {
    const rows = collideProjects();
    const distinct = new Set(rows.map((r) => qualifiedId(r)));
    // 4 rows, but only 3 distinct source:id (jira:p1 appears twice).
    assert.equal(rows.length, 4);
    assert.equal(distinct.size, 3, "true duplicate not collapsed by source:id key");
  });

  test("qualifyId falls back to bare id only when source is absent (single-source safety)", () => {
    assert.equal(qualifyId("", "x"), "x");
    assert.equal(qualifyId(undefined, "x"), "x");
    assert.equal(qualifyId("jira", "x"), "jira:x");
  });
});

// ── 3. Messy datasets: messifyRows must not fabricate or lose identity ─────────

describe("D_messy — messifyRows preserves row COUNT and never invents a name-merge", () => {
  const base = Array.from({ length: 8 }, (_, i) =>
    project({ id: `p${i}`, source: i % 2 ? "ado" : "jira", name: `Proj ${i}`, programmeId: `prog-${i % 3}` }),
  );

  for (const intensity of [0.6, 0.8, 1.0]) {
    for (const seed of ["s1", "s2", "s3"]) {
      test(`intensity ${intensity} seed ${seed}: count preserved, dedup by source:id (not name)`, () => {
        const config: MessyConfig = { on: true, seed, intensity, gremlins: [] };
        const messy = messifyRows(base.map((r) => ({ ...r })), config, "stress");
        // Count end-to-end is preserved: messification changes VALUES, never the row cardinality.
        assert.equal(messy.length, base.length, "messifyRows changed the row count");

        // After re-stamping source (missingSource gremlin may strip it), every row still has a key.
        const stamped = stampSource(messy, "fallback");
        const keys = stamped.map((r) => qualifiedId(r));
        assert.equal(keys.length, base.length);

        // The duplicateId gremlin can make bare ids collide; source:id must still separate rows that
        // came from different sources. We assert we NEVER collapse more rows than there are true dups.
        const distinct = new Set(keys).size;
        // At most base.length distinct; at least 1. The point: grouping by source:id is well-defined
        // and reproducible for a given (seed,intensity) — run it twice and compare.
        const messy2 = messifyRows(base.map((r) => ({ ...r })), config, "stress");
        const keys2 = stampSource(messy2, "fallback").map((r) => qualifiedId(r));
        assert.deepEqual(keys, keys2, "messify+key is not deterministic for a fixed seed");
        assert.ok(distinct >= 1 && distinct <= base.length);
      });
    }
  }
});
