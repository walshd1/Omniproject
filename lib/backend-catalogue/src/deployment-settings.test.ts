import { test } from "node:test";
import assert from "node:assert/strict";
import { deploymentSettings, describeDeploymentSetup, applyDeploymentOverrides } from "./deployment-settings";
import { resolveDeploymentSetup } from "./deployment-resolve";

test("deployment settings expose broker + backend as admin-pickable with live options", () => {
  const byKey = Object.fromEntries(deploymentSettings().map((s) => [s.key, s]));
  assert.equal(byKey["broker"]!.pickable, true);
  assert.equal(byKey["backend"]!.pickable, true);
  assert.equal(byKey["auth"]!.pickable, false);
  // Broker options include the built-in homes.
  assert.ok(byKey["broker"]!.options.includes("builtin:omnistore"));
});

test("describeDeploymentSetup tags each present setting with the deployment type's value + options", () => {
  const { setup } = resolveDeploymentSetup("solo-selfhost")!;
  const described = describeDeploymentSetup(setup);
  const storage = described.find((s) => s.key === "storage")!;
  assert.equal(storage.value, "omnistore");
  assert.ok(Array.isArray(storage.options));
});

test("applyDeploymentOverrides accepts a pickable override to a valid option, rejects the rest", () => {
  const { setup } = resolveDeploymentSetup("solo-selfhost")!;
  // Broker is pickable → an admin may swap it to another valid broker.
  const ok = applyDeploymentOverrides(setup, { broker: "builtin:postgres" });
  assert.equal(ok.setup.broker, "builtin:postgres");
  assert.deepEqual(ok.rejected, []);
  // auth is NOT pickable, and an unknown broker value is not an option → both rejected, setup unchanged.
  const bad = applyDeploymentOverrides(setup, { auth: "none", broker: "not-a-broker" });
  assert.deepEqual(bad.rejected.sort(), ["auth", "broker"]);
  assert.equal(bad.setup.auth, "internal");
  assert.equal(bad.setup.broker, "builtin:omnistore");
});
