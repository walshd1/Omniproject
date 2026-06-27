import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDevBroker,
  devBrokerFromEnv,
  getDevBrokerConfig,
  setDevBrokerConfig,
  DEV_DATA_SOURCES,
  type DevBrokerConfig,
} from "./dev-broker";

/**
 * The dev broker = a VENDOR profile × a DATA SOURCE (demo/bundle/cassette),
 * switchable on the fly. Distinct from the DemoBroker (demonstration data).
 */

const cfg = (over: Partial<DevBrokerConfig> = {}): DevBrokerConfig => ({ vendor: null, source: "demo", ref: null, ...over });

// --- Vendor gating over the demo source ----------------------------------------

test("vendor profile gates capabilities to the vendor's declared surface", async () => {
  const b = buildDevBroker(cfg({ vendor: "openproject", source: "demo" }));
  assert.equal(b.kind, "openproject");
  const caps = await b.capabilities({} as never);
  assert.equal(caps["issues"], true);
  assert.equal(caps["financials"], false); // OpenProject declares no financials
  assert.deepEqual(await b.listRaid({} as never, "proj-001"), []); // raid off ⇒ empty
});

test("no vendor ⇒ the full demo surface (no gating)", async () => {
  const b = buildDevBroker(cfg({ vendor: null, source: "demo" }));
  assert.equal(b.kind, "demo");
  const caps = await b.capabilities({} as never);
  assert.equal(caps["financials"], true);
});

// --- Data sources: bundle + cassette -------------------------------------------

test("the 'bundle' source loads a debug bundle's demo-state.json as the data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-devbroker-"));
  const statePath = join(dir, "demo-state.json");
  writeFileSync(statePath, JSON.stringify({
    projects: [{ id: "BUN-1", name: "Bundled Project" }],
    issues: {}, raid: {},
  }));
  const b = buildDevBroker(cfg({ source: "bundle", ref: statePath }));
  const projects = await b.listProjects({} as never);
  assert.ok(projects.some((p) => p.id === "BUN-1"), "expected the bundle's project to be served");
});

test("the 'cassette' source serves recorded responses from a tape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-devbroker-tape-"));
  const tape = join(dir, "t.jsonl");
  writeFileSync(tape, JSON.stringify({
    seq: 0, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [{ id: "CAS-1", name: "From Tape" }], ms: 1, ok: true,
  }) + "\n");
  const b = buildDevBroker(cfg({ source: "cassette", ref: tape }));
  assert.deepEqual(await b.listProjects({} as never), [{ id: "CAS-1", name: "From Tape" }]);
});

test("a source that needs a ref throws when none is given", () => {
  assert.throws(() => buildDevBroker(cfg({ source: "cassette", ref: null })), /needs a tape path/);
  assert.throws(() => buildDevBroker(cfg({ source: "bundle", ref: null })), /needs a demo-state/);
});

// --- On-the-fly config switching -----------------------------------------------

test("config get/set round-trips and DEV_DATA_SOURCES lists the options", () => {
  const before = getDevBrokerConfig();
  const after = setDevBrokerConfig({ vendor: "jira", source: "demo" });
  assert.equal(after.vendor, "jira");
  assert.equal(after.source, "demo");
  assert.deepEqual(DEV_DATA_SOURCES, ["demo", "bundle", "cassette"]);
  setDevBrokerConfig(before); // restore
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

test("devBrokerFromEnv is dev-gated and only takes over for a non-default combo", () => {
  const saved = getDevBrokerConfig();
  // Production: never, even with a vendor set.
  setDevBrokerConfig({ vendor: "openproject", source: "demo" });
  withEnv({ NODE_ENV: "production" }, () => assert.equal(devBrokerFromEnv(), null));
  // Dev + default (no vendor, demo source): fall back to the demonstration broker.
  setDevBrokerConfig({ vendor: null, source: "demo", ref: null });
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => assert.equal(devBrokerFromEnv(), null));
  // Dev + a spoofed vendor: the dev broker takes over.
  setDevBrokerConfig({ vendor: "openproject", source: "demo" });
  withEnv({ NODE_ENV: "development", OMNI_DEV_MODE: "1" }, () => {
    const b = devBrokerFromEnv();
    assert.ok(b);
    assert.equal(b!.kind, "openproject");
  });
  setDevBrokerConfig(saved); // restore
});
