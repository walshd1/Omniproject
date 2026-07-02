import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataResidencyEnabled, allowedRegions, regionForUrl, checkResidency, assertResidency,
  residencyStatus, DataResidencyError, checkEgressResidency, assertEgressResidency,
} from "./data-residency";

const EU = "https://eu.n8n.example/webhook/omni";
const US = "https://us.n8n.example/webhook/omni";

const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  DATA_RESIDENCY_MAP: "https://eu.n8n.example=eu,https://us.n8n.example=us",
  ...over,
}) as NodeJS.ProcessEnv;

test("enforcement is OFF until DATA_RESIDENCY_ALLOWED is set (default deployment unchanged)", () => {
  assert.equal(dataResidencyEnabled(env()), false);
  // Off ⇒ everything allowed, even an undeclared/foreign endpoint.
  assert.equal(checkResidency([US, "https://elsewhere.example"], env()).allowed, true);
});

test("allowedRegions parses + lower-cases the comma list", () => {
  assert.deepEqual([...allowedRegions(env({ DATA_RESIDENCY_ALLOWED: "EU, uk" }))], ["eu", "uk"]);
});

test("regionForUrl matches the longest declared prefix", () => {
  const e = env({ DATA_RESIDENCY_MAP: "https://eu.n8n.example=eu,https://eu.n8n.example/webhook/special=uk" });
  assert.equal(regionForUrl("https://eu.n8n.example/webhook/special/x", e), "uk"); // longer prefix wins
  assert.equal(regionForUrl(EU, e), "eu");
  assert.equal(regionForUrl("https://other.example", e), null);
});

test("checkResidency allows an in-region endpoint and blocks an out-of-region one", () => {
  const e = env({ DATA_RESIDENCY_ALLOWED: "eu" });
  assert.equal(checkResidency([EU], e).allowed, true);
  const blocked = checkResidency([EU, US], e);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.url, US);
  assert.equal(blocked.region, "us");
  assert.match(blocked.reason!, /not in the allowed set/);
});

test("fail-closed: an endpoint with no declared region is refused when enforcing", () => {
  const e = env({ DATA_RESIDENCY_ALLOWED: "eu" });
  const v = checkResidency(["https://undeclared.example/webhook"], e);
  assert.equal(v.allowed, false);
  assert.equal(v.region, null);
  assert.match(v.reason!, /no declared region/);
});

test("assertResidency throws a 451 DataResidencyError on a violation, no-ops when allowed", () => {
  const e = env({ DATA_RESIDENCY_ALLOWED: "eu" });
  assert.doesNotThrow(() => assertResidency([EU], e));
  assert.doesNotThrow(() => assertResidency([US], env())); // enforcement off
  let caught: unknown;
  try { assertResidency([US], e); } catch (err) { caught = err; }
  assert.ok(caught instanceof DataResidencyError);
  assert.equal((caught as DataResidencyError).statusCode, 451);
  assert.equal((caught as DataResidencyError).expose, true);
  assert.equal((caught as DataResidencyError).url, US);
});

test("residencyStatus reports the policy + per-endpoint origin/region/allow (path redacted)", () => {
  const e = env({ DATA_RESIDENCY_ALLOWED: "eu", BROKER_URL: EU, BROKER_URLS: `${EU},${US}` });
  const status = residencyStatus(e);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.allowedRegions, ["eu"]);
  const eu = status.endpoints.find((x) => x.origin === "https://eu.n8n.example");
  const us = status.endpoints.find((x) => x.origin === "https://us.n8n.example");
  assert.deepEqual({ region: eu?.region, allowed: eu?.allowed }, { region: "eu", allowed: true });
  assert.deepEqual({ region: us?.region, allowed: us?.allowed }, { region: "us", allowed: false });
  // The secret webhook path must not appear — only the origin.
  assert.ok(status.endpoints.every((x) => !x.origin.includes("/webhook")));
});

// ── Per-country JSON policy (the multinational form) ──────────────────────────────────
const POLICY = {
  regions: {
    eu: { backends: ["https://eu.n8n.example"], egress: ["*.eu.example.com"] },
    us: { backends: ["https://us.n8n.example"], egress: ["*.us.example.com"] },
  },
  allowed: ["eu"],
};
const polEnv = (p: unknown = POLICY): NodeJS.ProcessEnv =>
  ({ DATA_RESIDENCY_POLICY: JSON.stringify(p) }) as NodeJS.ProcessEnv;

test("policy mode: enabled, allowed regions + region-for-url come from the JSON policy", () => {
  const e = polEnv();
  assert.equal(dataResidencyEnabled(e), true);
  assert.deepEqual([...allowedRegions(e)], ["eu"]);
  assert.equal(regionForUrl(EU, e), "eu");
  assert.equal(regionForUrl(US, e), "us");
});

test("policy mode: allows an in-region (eu) endpoint, blocks an out-of-region (us) one", () => {
  const e = polEnv();
  assert.equal(checkResidency([EU], e).allowed, true);
  const blocked = checkResidency([EU, US], e);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.region, "us");
  assert.throws(() => assertResidency([US], e), DataResidencyError);
  assert.doesNotThrow(() => assertResidency([EU], e));
});

test("policy mode: fail-closed on an undeclared region and on an invalid policy", () => {
  const undeclared = checkResidency(["https://elsewhere.example/webhook"], polEnv());
  assert.equal(undeclared.allowed, false);
  assert.equal(undeclared.region, null);
  // A malformed policy refuses everything — it cannot prove residency.
  const bad = { DATA_RESIDENCY_POLICY: "{ not json" } as NodeJS.ProcessEnv;
  const v = checkResidency([EU], bad);
  assert.equal(v.allowed, false);
  assert.match(v.reason!, /policy is invalid/);
  assert.throws(() => assertResidency([EU], bad), DataResidencyError);
});

test("policy mode: per-country EGRESS allow/deny, incl. fail-closed on a foreign host", () => {
  const e = polEnv();
  // eu is allowed ⇒ its egress hosts + own backend host pass
  assert.equal(checkEgressResidency("api.eu.example.com", e).allowed, true);
  assert.equal(checkEgressResidency("eu.n8n.example", e).allowed, true);
  assert.doesNotThrow(() => assertEgressResidency("https://api.eu.example.com/x", e));
  // us is NOT allowed ⇒ refused; a foreign host is refused (fail-closed)
  assert.equal(checkEgressResidency("api.us.example.com", e).allowed, false);
  assert.throws(() => assertEgressResidency("https://api.us.example.com/x", e), DataResidencyError);
  assert.throws(() => assertEgressResidency("https://evil.example.net/x", e), DataResidencyError);
});

test("egress residency is a NO-OP when no JSON policy is configured (default unchanged)", () => {
  assert.equal(checkEgressResidency("anything.example", {} as NodeJS.ProcessEnv).allowed, true);
  assert.doesNotThrow(() => assertEgressResidency("https://anything.example/x", {} as NodeJS.ProcessEnv));
});

test("residencyStatus in policy mode reports mode + per-region backends/egress + allow verdict", () => {
  const status = residencyStatus(polEnv());
  assert.equal(status.mode, "policy");
  assert.equal(status.enabled, true);
  const eu = status.regions?.find((r) => r.code === "eu");
  const us = status.regions?.find((r) => r.code === "us");
  assert.equal(eu?.allowed, true);
  assert.equal(us?.allowed, false);
  assert.deepEqual(eu?.egress, ["*.eu.example.com"]);
});
