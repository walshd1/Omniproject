import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDeploymentSetup, withDefaults } from "./deployment-resolve";
import { getDeploymentType, deploymentTypeCatalogue } from "./deployment-type-catalogue";

test("solo self-host with defaults → the OmniStore internal-auth GTD setup", () => {
  const r = resolveDeploymentSetup("solo-selfhost");
  assert.ok(r);
  assert.equal(r!.setup.storage, "omnistore");
  assert.equal(r!.setup.auth, "internal");
  assert.equal(r!.setup.methodology, "gtd");
  assert.equal(r!.setup.broker, "builtin:omnistore");
  // Unanswered questions fall to their defaults.
  assert.deepEqual(r!.answers, { idp: "no", backups: "manual" });
});

test("answers refine the setup (a matching refinement's `set` merges on)", () => {
  const r = resolveDeploymentSetup("solo-selfhost", { idp: "yes", backups: "scheduled" });
  assert.equal(r!.setup.auth, "both");        // idp=yes → auth both
  assert.equal(r!.setup.backups, "scheduled"); // backups=scheduled
  assert.equal(r!.setup.storage, "omnistore"); // untouched keys stay
});

test("small team pointing at an external SoR switches storage + broker", () => {
  const r = resolveDeploymentSetup("small-team", { "external-sor": "yes" });
  assert.equal(r!.setup.storage, "external");
  assert.equal(r!.setup.broker, "n8n");
});

test("an invalid answer value is ignored (falls back to the question default)", () => {
  const r = resolveDeploymentSetup("solo-selfhost", { idp: "maybe" });
  assert.equal(r!.answers.idp, "no");  // "maybe" isn't an option → default
  assert.equal(r!.setup.auth, "internal");
});

test("withDefaults fills only declared questions; unknown type → null", () => {
  const solo = getDeploymentType("solo-selfhost")!;
  assert.deepEqual(withDefaults(solo, { bogus: "x" }), { idp: "no", backups: "manual" });
  assert.equal(resolveDeploymentSetup("no-such-deployment"), null);
});

test("every shipped deployment type resolves to a complete base setup (storage/auth/broker/methodology)", () => {
  for (const d of deploymentTypeCatalogue()) {
    const r = resolveDeploymentSetup(d.id)!;
    for (const key of ["storage", "auth", "broker", "methodology"]) {
      assert.ok(r.setup[key], `${d.id} setup has ${key}`);
    }
  }
});
