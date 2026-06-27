import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { check, gen, mulberry32, type Rng } from "../lib/proptest";
import {
  evaluateRuleset,
  setRuleModes,
  setFieldRules,
  getRuleModes,
  resetRuleModes,
  BUSINESS_RULES,
  type RuleMode,
} from "../lib/ruleset";
import { suggestColumnMapping, coerceValue, applyColumnMapping, mappingFromSuggestions } from "../lib/column-mapper";
import { grantsFromClaims } from "../lib/rbac";
import { FIELD_REGISTRY, type FieldType } from "../lib/field-registry";

/**
 * PROPERTY / EDGE-CASE suite — invariants over generated inputs (see lib/proptest).
 * These guard the SAFETY claims the codebase rests on, across the whole input
 * space rather than a few examples. Deterministic by a fixed seed; on failure the
 * harness prints the seed + input to replay.
 */

// ── The harness itself is deterministic + reports failures ──────────────────────
test("proptest: a seed replays the exact same sequence (CI determinism)", () => {
  const seq = (s: number) => Array.from({ length: 8 }, mulberry32(s));
  assert.deepEqual(seq(123), seq(123));
  assert.notDeepEqual(seq(123), seq(124));
});

test("proptest: a failing property reports the seed + the offending input", () => {
  let msg = "";
  try {
    check((r: Rng) => gen.int(r, 0, 100), (n) => assert.ok(n < 50), { seed: 42, runs: 500 });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert.match(msg, /seed=42/);
  assert.match(msg, /PROPTEST_SEED=42/);
  assert.match(msg, /input:/);
});

// ── Business ruleset: RESTRICT-ONLY, for any config + any action ────────────────
afterEach(() => resetRuleModes());

const ACTIONS = ["create_issue", "update_issue", "delete_issue", "list_issues", "create_project"] as const;
const MODES: RuleMode[] = ["hard", "warn", "off"];
const FIELDS = FIELD_REGISTRY.map((f) => f.key);

function genContext(r: Rng) {
  const payload: Record<string, unknown> = {};
  for (const f of gen.array(r, (rr) => gen.pick(rr, FIELDS), 5)) payload[f] = gen.oneOf<unknown>(r, () => "x", () => gen.int(r, 0, 9), () => "");
  return { action: gen.pick(r, ACTIONS), write: gen.bool(r), role: gen.pick(r, ["viewer", "contributor", "manager", "pmo", "admin"]), payload };
}

test("ruleset property: every accepted mode is valid (config can never grant)", () => {
  check(
    (r) => Object.fromEntries(BUSINESS_RULES.map((rule) => [rule.id, gen.oneOf(r, () => gen.pick(r, MODES), () => gen.pick(r, ["allow", "grant", "ALLOW", "yes", ""]))])),
    (cfg) => {
      setRuleModes(cfg as Record<string, unknown>);
      const modes = getRuleModes();
      // Only known ids, only valid modes — there is no path to an "allow" mode.
      for (const [id, mode] of Object.entries(modes)) {
        assert.ok(BUSINESS_RULES.some((rule) => rule.id === id));
        assert.ok((MODES as string[]).includes(mode));
      }
      resetRuleModes();
    },
  );
});

test("ruleset property: with everything off the engine is inert (never blocks/warns)", () => {
  resetRuleModes();
  check(genContext, (ctx) => {
    const v = evaluateRuleset(ctx);
    assert.equal(v.allow, true);
    assert.equal(v.blocked, null);
    assert.equal(v.warnings.length, 0);
  });
});

test("ruleset property: a 'warn' rule never blocks; evaluate never throws or grants", () => {
  check(genContext, (ctx) => {
    // Set a random single rule to warn (rest off) and a random warn field rule.
    resetRuleModes();
    const rule = mulberry32(ctx.payload ? Object.keys(ctx.payload).length + 1 : 1);
    setRuleModes({ [gen.pick(rule, BUSINESS_RULES.map((b) => b.id))]: "warn" });
    setFieldRules([{ id: "p", action: "any-write", field: gen.pick(rule, FIELDS), mode: "warn" }]);
    const v = evaluateRuleset(ctx);
    // Restrict-only: a warn-only config can NEVER produce a hard block.
    assert.equal(v.allow, true);
    assert.equal(v.blocked, null);
    resetRuleModes();
  });
});

// ── Column mapper: no double-mapping, lossless coercion, no leakage ──────────────
const HEADERS = ["Title", "Summary", "Owner", "Assignee", "Due date", "Deadline", "Points", "Story Points", "Status", "Tags", "wibble", "Mystery Col", "Est", "Cost"];

test("mapper property: a canonical field is claimed by at most ONE column", () => {
  check(
    (r) => gen.array(r, (rr) => gen.pick(rr, HEADERS), 8),
    (headers) => {
      const suggestions = suggestColumnMapping(headers);
      const claimed = suggestions.map((s) => s.suggestedField).filter((f): f is string => f !== null);
      assert.equal(new Set(claimed).size, claimed.length, "no field is mapped twice");
    },
  );
});

const TYPES: FieldType[] = ["string", "text", "number", "date", "enum", "user", "labels", "boolean", "currency", "percent", "duration"];

test("mapper property: coerceValue never throws and never silently nulls a non-empty value", () => {
  check(
    (r) => ({ value: gen.oneOf<unknown>(r, () => gen.string(r, "abc123 ,.-£", 8), () => gen.int(r, -50, 50), () => gen.bool(r), () => ""), type: gen.pick(r, TYPES) }),
    ({ value, type }) => {
      const out = coerceValue(value, type);
      const empty = value === "" || value === null || value === undefined;
      if (empty) assert.equal(out, null);
      else assert.notEqual(out, null, "a non-empty value must coerce to something (typed or passthrough), never null");
    },
  );
});

test("mapper property: applyColumnMapping never leaks an unmapped/raw column key", () => {
  check(
    (r) => ({
      headers: gen.array(r, (rr) => gen.pick(rr, HEADERS), 6),
      row: Object.fromEntries(gen.array(r, (rr) => [gen.pick(rr, HEADERS), gen.string(rr, "abc ", 5)] as const, 6)),
    }),
    ({ headers, row }) => {
      const mapping = mappingFromSuggestions(suggestColumnMapping(headers));
      const mappedFields = new Set(mapping.map((m) => m.field));
      const out = applyColumnMapping([row], mapping)[0]!;
      for (const key of Object.keys(out)) {
        assert.ok(mappedFields.has(key), `output key ${key} must be a mapped canonical field, never a raw header`);
      }
    },
  );
});

// ── RBAC grants: authorities orthogonal + bounded, for any claim set ─────────────
test("rbac property: pmo/admin authorities are orthogonal, bounded, and union on join", () => {
  process.env["OIDC_ADMIN_ROLES"] = "tech";
  process.env["OIDC_PMO_ROLES"] = "gov";
  process.env["OIDC_MANAGER_ROLES"] = "lead";
  try {
    check(
      (r) => gen.array(r, (rr) => gen.pick(rr, ["tech", "gov", "lead", "random", "TECH", "Gov"]), 4),
      (claims) => {
        const g = grantsFromClaims(claims, { isDemo: false });
        // authorities ⊆ {pmo, admin}; base is a real base rung.
        for (const a of g.authorities) assert.ok(a === "pmo" || a === "admin");
        assert.ok(["viewer", "contributor", "manager"].includes(g.base));
        // Orthogonality: admin membership ⇔ a tech claim; pmo ⇔ a gov claim
        // (case-insensitive). Neither implies the other.
        const lc = claims.map((c) => c.toLowerCase());
        assert.equal(g.authorities.has("admin"), lc.includes("tech"));
        assert.equal(g.authorities.has("pmo"), lc.includes("gov"));
        // Any authority implies at least manager-level base.
        if (g.authorities.size > 0) assert.equal(g.base, "manager");
      },
    );
  } finally {
    delete process.env["OIDC_ADMIN_ROLES"];
    delete process.env["OIDC_PMO_ROLES"];
    delete process.env["OIDC_MANAGER_ROLES"];
  }
});
