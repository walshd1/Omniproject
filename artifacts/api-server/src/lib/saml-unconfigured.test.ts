import { test } from "node:test";
import assert from "node:assert/strict";

// Ensure NO SAML env is set before import: the module must report unconfigured and every
// entry point must no-op (the default OIDC/demo posture is completely unaffected).
for (const k of ["SAML_IDP_ENTRY_POINT", "SAML_ENTRY_POINT", "SAML_IDP_CERT", "SAML_CALLBACK_URL", "PUBLIC_URL"]) {
  delete process.env[k];
}

const { isSamlConfigured, samlLoginUrl, validateSamlResponse, samlMetadata } = await import("./saml");

test("SAML is unconfigured with no env, and all entry points no-op", async () => {
  assert.equal(isSamlConfigured(), false);
  assert.equal(await samlLoginUrl("/"), null);
  assert.equal(await validateSamlResponse("anything"), null);
  assert.equal(await samlMetadata(), null);
});
