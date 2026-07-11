import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * routes/well-known.ts — the POLICY_URL / CONTACT_URL constants are computed once at
 * module load from env (overridable for white-label forks). The default well-known.test.ts
 * exercises the fallback branch; this file sets the env FIRST, then imports the module, so
 * the env-provided branch is covered and the custom URLs land in the security.txt body.
 */
process.env["SECURITY_POLICY_URL"] = "https://fork.example.com/policy";
process.env["SECURITY_CONTACT_URL"] = "https://fork.example.com/contact";

test("securityTxt honours SECURITY_POLICY_URL / SECURITY_CONTACT_URL overrides", async () => {
  const { securityTxt } = await import("../routes/well-known");
  const body = securityTxt(new Date("2026-01-01T00:00:00Z"));
  assert.match(body, /^Contact: https:\/\/fork\.example\.com\/contact$/m);
  assert.match(body, /^Policy: https:\/\/fork\.example\.com\/policy$/m);
});
