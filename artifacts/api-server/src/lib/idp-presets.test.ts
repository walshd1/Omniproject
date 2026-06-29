import { test } from "node:test";
import assert from "node:assert/strict";
import { IDP_PRESETS, idpPreset } from "./idp-presets";

test("ships Google + Microsoft + GitHub presets over the existing auth flows", () => {
  const ids = IDP_PRESETS.map((p) => p.id);
  assert.ok(ids.includes("google"));
  assert.ok(ids.includes("microsoft"));
  assert.ok(ids.includes("authentik"));
  assert.ok(ids.includes("generic"));
  assert.ok(ids.includes("github"));
});

test("OIDC presets carry an issuer template + the standard OIDC env keys; no secrets", () => {
  for (const p of IDP_PRESETS.filter((p) => p.kind === "oidc")) {
    assert.match(p.issuerTemplate, /^https:\/\//);
    assert.deepEqual(p.envKeys, ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"]);
    assert.doesNotMatch(JSON.stringify(p), /client_secret\s*[:=]\s*\S+|password/i);
    assert.ok(p.groupsClaimNote.length > 0); // role-mapping guidance is present
  }
});

test("OAuth2 presets carry explicit endpoints + the OAUTH2_* env keys; no secrets", () => {
  const oauth2 = IDP_PRESETS.filter((p) => p.kind === "oauth2");
  assert.ok(oauth2.length >= 1);
  for (const p of oauth2) {
    assert.equal(p.issuerTemplate, ""); // no discovery doc for non-OIDC providers
    assert.ok(p.endpoints, "an oauth2 preset must list its endpoints");
    assert.match(p.endpoints!.authUrl, /^https:\/\//);
    assert.match(p.endpoints!.tokenUrl, /^https:\/\//);
    assert.match(p.endpoints!.userInfoUrl, /^https:\/\//);
    assert.ok(p.envKeys.includes("OAUTH2_AUTH_URL") && p.envKeys.includes("OAUTH2_CLIENT_ID"));
    // Presets describe what to set — they never carry a secret VALUE (an env KEY name is fine).
    assert.doesNotMatch(JSON.stringify(p), /password|client_secret"\s*:\s*"\S+/i);
  }
});

test("idpPreset looks up by id", () => {
  assert.equal(idpPreset("microsoft")?.label, "Microsoft Entra ID (Microsoft 365)");
  assert.equal(idpPreset("nope"), undefined);
});
