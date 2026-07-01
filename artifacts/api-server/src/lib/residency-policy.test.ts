import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateResidencyPolicy, residencyPolicyState, policyRegionForUrl,
  policyAllowedRegions, policyEgressAllowed, type ResidencyPolicy,
} from "./residency-policy";
import { ValidationError } from "./validate";

const GOOD = {
  regions: {
    eu: { backends: ["https://eu.n8n.example"], egress: ["*.eu.example.com", "idp.eu.example"] },
    us: { backends: ["https://us.n8n.example"], egress: ["*.us.example.com"] },
  },
  allowed: ["eu"],
};

test("validateResidencyPolicy accepts a good policy, lower-cases codes, defaults allowed to all regions", () => {
  const p = validateResidencyPolicy({ regions: { EU: { backends: ["https://eu.x"], egress: [] } } });
  assert.deepEqual(Object.keys(p.regions), ["eu"]);
  assert.deepEqual(p.allowed, ["eu"]); // omitted ⇒ every declared region
});

test("validateResidencyPolicy honours an explicit allowed subset", () => {
  const p = validateResidencyPolicy(GOOD);
  assert.deepEqual(p.allowed, ["eu"]);
  assert.deepEqual([...policyAllowedRegions(p)], ["eu"]);
});

test("validateResidencyPolicy rejects a malformed policy (fail-closed inputs)", () => {
  assert.throws(() => validateResidencyPolicy(null), ValidationError);
  assert.throws(() => validateResidencyPolicy({}), ValidationError); // no regions
  assert.throws(() => validateResidencyPolicy({ regions: {} }), ValidationError); // empty
  // a backend that isn't an http(s) prefix
  assert.throws(() => validateResidencyPolicy({ regions: { eu: { backends: ["ftp://x"], egress: [] } } }), ValidationError);
  // allowed references an undeclared region
  assert.throws(() => validateResidencyPolicy({ regions: { eu: { backends: ["https://x"], egress: [] } }, allowed: ["us"] }), ValidationError);
  // an invalid region code
  assert.throws(() => validateResidencyPolicy({ regions: { "bad code!": { backends: ["https://x"], egress: [] } } }), ValidationError);
});

test("policyRegionForUrl uses the longest matching backend prefix, null when undeclared", () => {
  const p = validateResidencyPolicy({
    regions: {
      eu: { backends: ["https://eu.n8n.example"], egress: [] },
      special: { backends: ["https://eu.n8n.example/webhook/special"], egress: [] },
    },
  });
  assert.equal(policyRegionForUrl(p, "https://eu.n8n.example/webhook/omni"), "eu");
  assert.equal(policyRegionForUrl(p, "https://eu.n8n.example/webhook/special/x"), "special");
  assert.equal(policyRegionForUrl(p, "https://other.example/"), null);
});

test("policyEgressAllowed matches egress patterns + a region's own backend host, only for allowed regions", () => {
  const p = validateResidencyPolicy(GOOD);
  // wildcard + exact from the allowed (eu) region
  assert.equal(policyEgressAllowed(p, "api.eu.example.com"), true);
  assert.equal(policyEgressAllowed(p, "eu.example.com"), true); // apex matches *.eu.example.com
  assert.equal(policyEgressAllowed(p, "idp.eu.example"), true);
  // the eu region's own backend host is implicitly egress-allowed
  assert.equal(policyEgressAllowed(p, "eu.n8n.example"), true);
  // a us host is NOT allowed because us is not in `allowed`
  assert.equal(policyEgressAllowed(p, "api.us.example.com"), false);
  assert.equal(policyEgressAllowed(p, "us.n8n.example"), false);
  // a totally foreign host is refused (fail-closed)
  assert.equal(policyEgressAllowed(p, "evil.example.net"), false);
});

test("residencyPolicyState: unset ⇒ inert, valid ⇒ policy, malformed ⇒ error (fail-closed)", () => {
  assert.deepEqual(residencyPolicyState({} as NodeJS.ProcessEnv), { policy: null, error: null });
  const ok = residencyPolicyState({ DATA_RESIDENCY_POLICY: JSON.stringify(GOOD) } as NodeJS.ProcessEnv);
  assert.ok(ok.policy && (ok.policy as ResidencyPolicy).allowed.includes("eu"));
  const bad = residencyPolicyState({ DATA_RESIDENCY_POLICY: "{not json" } as NodeJS.ProcessEnv);
  assert.equal(bad.policy, null);
  assert.ok(bad.error);
});
