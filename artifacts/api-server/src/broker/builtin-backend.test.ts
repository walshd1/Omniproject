import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Built-in backend (A1) — the opt-in, ENCRYPTED, first-party system-of-record mode.
 *
 * Env is set BEFORE importing the broker/demo-data (both read the opt-in at module load), so this
 * whole file runs with BUILTIN_BACKEND on. Proves: a real deployment starts EMPTY (not demo
 * samples), writes persist to an ENCRYPTED file, the data survives a "reboot" (reload from disk),
 * and the deployment reports as a real source (no demo-mode banner).
 */
const STORE = path.join(os.tmpdir(), `omni-builtin-${process.pid}-${Math.random().toString(36).slice(2)}.enc`);
process.env["BUILTIN_BACKEND"] = "1";
process.env["BUILTIN_BACKEND_FILE"] = STORE;
delete process.env["BROKER_URL"]; // no real backend → the built-in engine is selected

const { getBroker } = await import("./index");
const { loadState, builtinBackendFile } = await import("../lib/dev-persist");
const { brokerConfigured } = await import("../lib/setup-status");
const { loadDemoState } = await import("./demo-data");
import type { ActorContext } from "./types";

const ctx: ActorContext = { sub: "founder", email: "founder@charity.test", role: "admin" };

after(() => { try { fs.rmSync(STORE, { force: true }); } catch { /* ignore */ } });

test("a real deployment starts EMPTY — not seeded with demo sample projects", async () => {
  assert.deepEqual(await getBroker().listProjects(ctx), []);
});

test("the built-in backend reports as a real source (no demo-mode banner)", () => {
  assert.equal(builtinBackendFile(), STORE);
  assert.equal(brokerConfigured(), true); // real store ⇒ not "demo/sample" mode
});

test("a created project persists ENCRYPTED to disk and survives a reboot", async () => {
  const broker = getBroker();
  const created = await broker.createProject(ctx, { name: "Food Bank Rollout", identifier: "FBR" });
  assert.ok(created.id);
  assert.deepEqual((await broker.listProjects(ctx)).map((p) => p.name), ["Food Bank Rollout"]);

  // It hit the disk, sealed: the file exists and the project name is not in cleartext.
  assert.ok(fs.existsSync(STORE), "the built-in store file was not written");
  assert.ok(!fs.readFileSync(STORE, "utf8").includes("Food Bank Rollout"), "project name leaked in cleartext at rest");

  // Reboot simulation: the encrypted file decrypts back to the same data, and re-hydrating the
  // engine from it restores the project (durability across a restart).
  const reloaded = loadState(STORE, { encrypt: true });
  assert.ok(reloaded);
  assert.equal((reloaded!.projects as Array<{ name: string }>)[0]!.name, "Food Bank Rollout");
  loadDemoState({ projects: [], issues: {}, raid: {} }); // wipe memory (as a fresh process would)
  assert.deepEqual(await broker.listProjects(ctx), []);
  loadDemoState(reloaded!); // hydrate from the persisted encrypted store
  assert.deepEqual((await broker.listProjects(ctx)).map((p) => p.name), ["Food Bank Rollout"]);
});
