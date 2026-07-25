import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startHarness, adminCookie, type Harness } from "./_harness";

/**
 * routes/presets.ts over the REAL app (demo broker). Quick-load presets: list + apply. Applying the Scrum
 * preset runs the server-side pieces (apply the Scrum reference ruleset + instantiate the scrum-starter
 * project) and returns follow-ups (methodology composition, posture blueprint, persona dashboard) for the SPA.
 */
process.env["SESSION_SECRET"] ??= "integration-harness-secret";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "presets-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let h: Harness;
const ADMIN = adminCookie();
before(async () => { h = await startHarness(); });
after(() => { h?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });
afterEach(async () => {
  const { resetDemoBrokerState } = await import("../broker/demo");
  resetDemoBrokerState();
});
const req = (p: string, o: Parameters<Harness["req"]>[1] = {}) => h.req(p, { cookie: ADMIN, ...o });

test("GET /presets lists the shipped presets incl. the Scrum team preset", async () => {
  const list = (await (await req("/presets")).json()) as Array<{ id: string; methodology: string }>;
  const scrum = list.find((p) => p.id === "scrum-team");
  assert.ok(scrum, "scrum-team is listed");
  assert.equal(scrum!.methodology, "scrum");
});

test("GET /presets/:id returns one preset; unknown → 404", async () => {
  const one = (await (await req("/presets/scrum-team")).json()) as { id: string; projectTemplate: string };
  assert.equal(one.id, "scrum-team");
  assert.equal(one.projectTemplate, "scrum-starter");
  assert.equal((await req("/presets/ghost")).status, 404);
});

test("POST /presets/scrum-team/apply applies the ruleset, instantiates the starter project, and returns follow-ups", async () => {
  const r = await req("/presets/scrum-team/apply", { method: "POST", body: { name: "Sprint Team A" } });
  assert.equal(r.status, 201);
  const body = (await r.json()) as {
    presetId: string; methodology: string;
    applied: { referenceRuleset?: string; project?: { id: string; seeded: number } };
    followUps: { methodologyComposition: string; settingsPreset?: string; dashboardPreset?: string };
  };
  assert.equal(body.presetId, "scrum-team");
  assert.equal(body.methodology, "scrum");
  // The Scrum reference ruleset was applied …
  assert.equal(body.applied.referenceRuleset, "scrum");
  // … and the starter project was created + seeded (the tangible working instance).
  assert.ok(body.applied.project, "a project was instantiated");
  assert.equal(body.applied.project!.seeded > 0, true);
  // Follow-ups tell the SPA how to finish (curate to scrum, load the blueprint, mint the dashboard).
  assert.equal(body.followUps.methodologyComposition, "scrum");
  assert.equal(body.followUps.settingsPreset, "growth-business");
  assert.equal(body.followUps.dashboardPreset, "project-manager-today");

  // The seeded work items are readable on the new project — it's a real, working project.
  const issues = (await (await req(`/projects/${body.applied.project!.id}/issues`)).json()) as Array<{ title: string }>;
  assert.ok(issues.length > 0, "the starter project has seed work items");
});

test("POST /presets/:id/apply for an unknown preset → 404", async () => {
  assert.equal((await req("/presets/ghost/apply", { method: "POST", body: {} })).status, 404);
});

test("the preset routes sit behind auth — no session is refused (apply is pmo-gated in production)", async () => {
  // The harness runs demo auth (every session is elevated), so the pmo role gate can't be exercised here; the
  // auth boundary can. `requireRole("pmo")` on apply is the standard guard the rest of the routes use.
  const r = await h.req("/presets/scrum-team/apply", { method: "POST", body: {} }); // no cookie
  assert.equal(r.status, 401);
});
