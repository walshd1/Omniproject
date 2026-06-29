import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dataResidencyEnabled, allowedRegions, regionForUrl, checkResidency, assertResidency,
  residencyStatus, DataResidencyError,
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
