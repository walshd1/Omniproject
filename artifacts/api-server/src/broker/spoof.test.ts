import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSpoofBroker, spoofBrokerFromEnv } from "./spoof";

/**
 * The dev-only spoof broker presents AS a vendor (e.g. OpenProject) with that
 * vendor's declared capability surface, over compliant demo data.
 */

const OPENPROJECT_CAPS = {
  issues: true, scheduling: true, history: true, portfolio: true, baseline: true,
  financials: false, raid: false, resources: false, blockers: false,
};

test("spoof presents the vendor id as its kind", () => {
  const b = makeSpoofBroker("openproject", OPENPROJECT_CAPS);
  assert.equal(b.kind, "openproject");
  assert.equal(b.live, false);
});

test("capabilities mirror the vendor's declared surface (unmentioned ⇒ off)", async () => {
  const caps = await makeSpoofBroker("openproject", OPENPROJECT_CAPS).capabilities({} as never);
  assert.equal(caps["issues"], true);
  assert.equal(caps["scheduling"], true);
  assert.equal(caps["financials"], false);
  assert.equal(caps["raid"], false);
  assert.equal(caps["resources"], false);
});

test("capability-poor domains return the empty/absent shape", async () => {
  const b = makeSpoofBroker("openproject", OPENPROJECT_CAPS); // financials/raid/resources OFF
  assert.deepEqual(await b.listRaid({} as never, "proj-001"), []);
  assert.deepEqual(await b.projectFinancials({} as never, "proj-001"), {});
  assert.deepEqual(await b.resourceCapacity({} as never, "proj-001"), []);
  // baseline IS declared for OpenProject, so it is served (not gated off).
  assert.notEqual(await b.baseline({} as never, "proj-001"), null);
  // A vendor that does NOT declare baseline gets null.
  const noBaseline = makeSpoofBroker("legacy", { issues: true, baseline: false });
  assert.equal(await noBaseline.baseline({} as never, "proj-001"), null);
});

test("a capability-rich vendor still serves those domains", async () => {
  const rich = makeSpoofBroker("acme", { raid: true, financials: true, resources: true, baseline: true });
  assert.ok(Array.isArray(await rich.listRaid({} as never, "proj-001")));
  // financials/resources delegate to demo sample data (non-empty shapes)
  const fin = await rich.projectFinancials({} as never, "proj-001");
  assert.equal(typeof fin, "object");
});

test("spoof still serves the core read surface (projects) compliantly", async () => {
  const b = makeSpoofBroker("openproject", OPENPROJECT_CAPS);
  const projects = await b.listProjects({} as never);
  assert.ok(Array.isArray(projects) && projects.length > 0);
  assert.ok(typeof projects[0]!.id === "string" && typeof projects[0]!.name === "string");
});

// --- Selection gating ----------------------------------------------------------

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("spoofBrokerFromEnv is dev-gated and validates the vendor", () => {
  // Off in production even with the flag set.
  withEnv({ NODE_ENV: "production", OMNI_DEV_MODE: "1", BROKER_SPOOF: "openproject" }, () => {
    assert.equal(spoofBrokerFromEnv(), null);
  });
  // Unknown vendor ⇒ null (fall back to the normal broker).
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1", BROKER_SPOOF: "not-a-vendor" }, () => {
    assert.equal(spoofBrokerFromEnv(), null);
  });
  // Known vendor on a dev build ⇒ a spoof presenting as that vendor.
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1", BROKER_SPOOF: "openproject" }, () => {
    const b = spoofBrokerFromEnv();
    assert.ok(b);
    assert.equal(b!.kind, "openproject");
  });
});
