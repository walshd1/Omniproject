import { test } from "node:test";
import assert from "node:assert/strict";
import { IDP_PRESETS, idpPreset } from "./idp-presets";

test("ships Google + Microsoft presets over the existing OIDC flow", () => {
  const ids = IDP_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("google"));
  assert.ok(ids.includes("microsoft"));
  assert.ok(ids.includes("authentik"));
  assert.ok(ids.includes("generic"));
});

test("every preset is OIDC-shaped: issuer template + the standard env keys, no secrets", () => {
  for (const p of IDP_PRESETS) {
    assert.match(p.issuerTemplate, /^https:\/\//);
    assert.deepEqual(p.envKeys, ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]);
    // Presets describe what to set — they never carry a secret value.
    assert.doesNotMatch(JSON.stringify(p), /client_secret\s*[:=]\s*\S+|password/i);
    assert.ok(p.groupsClaimNote.length > 0); // role-mapping guidance is present
  }
});

test("idpPreset looks up by id", () => {
  assert.equal(idpPreset("microsoft")?.label, "Microsoft Entra ID (Microsoft 365)");
  assert.equal(idpPreset("nope"), undefined);
});
