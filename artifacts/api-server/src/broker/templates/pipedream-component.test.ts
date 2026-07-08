import { test } from "node:test";
import assert from "node:assert/strict";
import component from "./pipedream-component";

/**
 * The Pipedream template is a component wrapper over the shared
 * `processBrokerCall` core. We invoke `run` with a fake `this` carrying the
 * `$.interface.http` responder and assert the glue (body defaulting + the
 * synchronous respond) behaves, using a `verify` probe for a deterministic 200.
 */

interface Captured {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

function fakeSelf(): { http: { respond(o: Captured): void }; captured: Captured[] } {
  const captured: Captured[] = [];
  return { http: { respond: (o: Captured) => captured.push(o) }, captured };
}

test("exposes the expected Pipedream component metadata", () => {
  assert.equal(component.name, "omniproject-broker");
  assert.equal(component.version, "0.1.0");
  assert.equal(component.props.http.type, "$.interface.http");
  assert.equal(component.props.http.customResponse, true);
});

test("run responds with the core result for a string body", async () => {
  const self = fakeSelf();
  await component.run.call(self, {
    event: {
      body: JSON.stringify({ action: "listProjects", verify: true }),
      headers: { "x-omniproject-action": "listProjects", authorization: "Bearer t" },
    },
  });
  assert.equal(self.captured.length, 1);
  const out = self.captured[0]!;
  assert.equal(out.status, 200);
  assert.equal(out.headers?.["Content-Type"], "application/json");
  assert.equal((out.body as { success: boolean; data?: { verified?: boolean } }).success, true);
  assert.equal((out.body as { data: { verified: boolean } }).data.verified, true);
});

test("run JSON-stringifies a non-string body", async () => {
  const self = fakeSelf();
  await component.run.call(self, {
    event: { body: { action: "listProjects", verify: true }, headers: {} },
  });
  assert.equal(self.captured[0]!.status, 200);
  assert.equal((self.captured[0]!.body as { success: boolean }).success, true);
});

test("run defaults an absent body to {} and still responds", async () => {
  const self = fakeSelf();
  await component.run.call(self, { event: {} });
  const out = self.captured[0]!;
  assert.equal(typeof out.status, "number");
  assert.equal((out.body as { success: boolean }).success, false);
});
