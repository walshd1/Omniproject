import { test } from "node:test";
import assert from "node:assert/strict";

// Configure SAML BEFORE importing the module (it reads env once at load). The optional
// provider library is NOT installed, so this also exercises the configured-but-absent path.
process.env["SAML_IDP_ENTRY_POINT"] = "https://idp.example.com/sso";
process.env["SAML_IDP_CERT"] = "-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----";
process.env["SAML_CALLBACK_URL"] = "https://omni.example.com/api/auth/saml/callback";

const { isSamlConfigured, samlLoginUrl, validateSamlResponse, samlMetadata, profileToClaims, samlConfigStatus, samlConfigStatusFrom } = await import("./saml");

const cfg = {
  entryPoint: "", idpCert: "", issuer: "", callbackUrl: "", audience: "",
  emailAttr: "email", nameAttr: "displayName", groupsAttr: "groups", wantResponseSigned: false,
};

test("SAML reports configured when entry point + cert + callback are present", () => {
  assert.equal(isSamlConfigured(), true);
});

// ── Config status: the first-class, actionable diagnostics (pure over an arbitrary env) ─────
test("samlConfigStatus reflects the fully-configured process env", () => {
  const s = samlConfigStatus();
  assert.equal(s.configured, true);
  assert.equal(s.partial, false);
  assert.deepEqual(s.missing, []);
  assert.deepEqual(s.present, { entryPoint: true, idpCert: true, callbackUrl: true });
});

test("a fully-unset env is neither configured nor partial (no false alarm)", () => {
  const s = samlConfigStatusFrom({});
  assert.equal(s.configured, false);
  assert.equal(s.partial, false);
  assert.deepEqual(s.missing, ["SAML_IDP_ENTRY_POINT", "SAML_IDP_CERT", "SAML_CALLBACK_URL (or PUBLIC_URL)"]);
});

test("a HALF-configured env is flagged partial with the exact missing vars", () => {
  const s = samlConfigStatusFrom({ SAML_IDP_ENTRY_POINT: "https://idp/sso" });
  assert.equal(s.configured, false);
  assert.equal(s.partial, true);
  assert.deepEqual(s.missing, ["SAML_IDP_CERT", "SAML_CALLBACK_URL (or PUBLIC_URL)"]);
});

test("PUBLIC_URL alone satisfies the callback requirement; SAML_ENTRY_POINT is an accepted alias", () => {
  const s = samlConfigStatusFrom({ SAML_ENTRY_POINT: "https://idp/sso", SAML_IDP_CERT: "x", PUBLIC_URL: "https://omni.example.com" });
  assert.equal(s.configured, true);
  assert.equal(s.partial, false);
});

test("configured-but-not-installed degrades gracefully (never throws, never a session)", async () => {
  // The optional '@node-saml/node-saml' package isn't installed, so the provider is null and
  // every entry point returns null instead of crashing — OIDC/demo stay usable.
  assert.equal(await samlLoginUrl("/"), null);
  assert.equal(await validateSamlResponse("anything"), null);
  assert.equal(await samlMetadata(), null);
});

// ── profileToClaims: the role-mapping logic, in isolation (no library needed) ─────
test("maps nameID + attributes-object claims, groups as an array", () => {
  const claims = profileToClaims(
    { nameID: "u1", attributes: { email: "a@b.c", displayName: "Alice", groups: ["pmo", "delivery"] } },
    cfg,
  );
  assert.deepEqual(claims, { sub: "u1", email: "a@b.c", name: "Alice", roles: ["pmo", "delivery"] });
});

test("reads top-level profile keys and splits a comma/space group string", () => {
  const claims = profileToClaims({ nameID: "u2", email: "x@y.z", groups: "admins, delivery leads" }, cfg);
  assert.equal(claims.sub, "u2");
  assert.equal(claims.email, "x@y.z");
  assert.deepEqual(claims.roles, ["admins", "delivery", "leads"]);
});

test("sub falls back to email, then to 'unknown'; roles default to empty", () => {
  assert.equal(profileToClaims({ email: "e@f.g" }, cfg).sub, "e@f.g");
  const empty = profileToClaims({}, cfg);
  assert.equal(empty.sub, "unknown");
  assert.deepEqual(empty.roles, []);
});

test("honours configured attribute names (e.g. an IdP URN for groups)", () => {
  const urn = "http://schemas.xmlsoap.org/claims/Group";
  const claims = profileToClaims(
    { nameID: "u3", attributes: { [urn]: ["g1", "g2"] } },
    { ...cfg, groupsAttr: urn },
  );
  assert.deepEqual(claims.roles, ["g1", "g2"]);
});

test("a SAML group lands in the same role-map as an OIDC claim (single-value attribute)", () => {
  // node-saml exposes a single-valued attribute as a bare string; it must still map to a role.
  const claims = profileToClaims({ nameID: "u4", attributes: { groups: "omni-admins" } }, cfg);
  assert.deepEqual(claims.roles, ["omni-admins"]);
});

test("firstString picks the first string from an array attribute (email/name as arrays)", () => {
  const claims = profileToClaims(
    { nameID: "u5", attributes: { email: ["primary@x.com", "alt@x.com"], displayName: ["Ada Lovelace"] } },
    cfg,
  );
  assert.equal(claims.email, "primary@x.com");
  assert.equal(claims.name, "Ada Lovelace");
});

test("an array attribute with no string members yields no email/name (omitted)", () => {
  const claims = profileToClaims({ nameID: "u6", attributes: { email: [123, {}], displayName: [] } }, cfg);
  assert.equal(claims.email, undefined);
  assert.equal(claims.name, undefined);
  assert.equal("email" in claims, false); // absent, not just undefined
});

test("the ACR attribute is surfaced only when SAML_ACR_ATTR is configured", () => {
  const withAcr = profileToClaims(
    { nameID: "u7", attributes: { authnContext: "https://refeds.org/profile/mfa" } },
    { ...cfg, acrAttr: "authnContext" },
  );
  assert.equal(withAcr.acr, "https://refeds.org/profile/mfa");

  // No acrAttr configured → no acr claim, even if a matching attribute is present.
  const withoutAcr = profileToClaims({ nameID: "u8", attributes: { authnContext: "x" } }, cfg);
  assert.equal("acr" in withoutAcr, false);
});
