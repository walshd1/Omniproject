import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "./demo";
import { brokerVerifyConnection, brokerStoreCredential } from "./index";
import type { ActorContext } from "./types";

/**
 * Test-connection + credential-vault delegation seam. The demo broker stubs both;
 * a real broker (n8n) maps them to its API + encrypted credential store.
 */
const ctx = {} as ActorContext;

test("verifyConnection reports a (clearly demo-labelled) success", async () => {
  const r = await new DemoBroker().verifyConnection(ctx, "openproject");
  assert.equal(r.ok, true);
  assert.match(r.detail ?? "", /demo/i);
});

test("storeCredential acknowledges with a NON-secret ref and never echoes the value", async () => {
  const r = await new DemoBroker().storeCredential(ctx, { backend: "jira", name: "JIRA_BASIC_AUTH", value: "super-secret-value" });
  assert.equal(r.stored, true);
  assert.ok(r.ref && !r.ref.includes("super-secret-value"), "the ref must not leak the secret value");
});

test("the broker helpers delegate when supported (demo implements both)", async () => {
  const v = brokerVerifyConnection(ctx, "jira");
  assert.ok(v, "demo supports verifyConnection");
  assert.equal((await v!).ok, true);

  const s = brokerStoreCredential(ctx, { backend: "jira", name: "X", value: "y" });
  assert.ok(s, "demo supports storeCredential");
  assert.equal((await s!).stored, true);
});
