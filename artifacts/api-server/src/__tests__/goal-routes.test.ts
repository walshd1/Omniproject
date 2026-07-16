import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/goals.ts over the REAL app (roadmap 3.2). A goal is a first-class objective + measurable key
 * results, saved to a storage target (private user area by default / org / project), AES-256-GCM sealed under
 * OMNI_CONFIG_DIR. Progress is derived server-side from key-result attainment; ids are self-describing so a
 * read routes to the right store; a `user` scope always uses the caller's own sub.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "goals";
process.env["SECURITY_STRICT"] = "off";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "goal-routes-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });
const VIEWER = cookie({ sub: "v", name: "Vic", email: "vic@x.io", roles: ["omni-viewers"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => { server?.close(); fs.rmSync(CONFIG_DIR, { recursive: true, force: true }); });

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? ADMIN, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("create defaults to the private user area, derives progress, seals at rest", async () => {
  const r = await req("/goals", { method: "POST", body: {
    title: "Grow adoption",
    description: "FY26 north star",
    keyResults: [
      { label: "Weekly active teams", startValue: 100, target: 500, current: 200 }, // 25%
      { label: "Activation rate", startValue: 0, target: 100, current: 75, unit: "%" }, // 75%
    ],
  } });
  assert.equal(r.status, 201);
  const goal = (await r.json()) as { id: string; version: number; progressPct: number; ownerSub: string; status: string };
  assert.match(goal.id, /^user~/, "default target is the private user area");
  assert.equal(goal.version, 1);
  assert.equal(goal.ownerSub, "a", "owner stamped from the session");
  assert.equal(goal.progressPct, 50, "mean of 25% + 75%");
  assert.equal(goal.status, "on_track");

  const file = path.join(CONFIG_DIR, "artifacts", "goal", "user-a.json");
  const onDisk = fs.readFileSync(file, "utf8");
  assert.ok(!onDisk.includes("Grow adoption"), "the goal title must not appear in plaintext on disk");
  assert.match(onDisk, /^c[12]\./, "the collection file is an AES-256-GCM sealed token");
});

test("update recomputes progress and bumps the version", async () => {
  const created = await (await req("/goals", { method: "POST", body: { title: "Ship v2", keyResults: [{ label: "beta", target: 100, current: 20 }] } })).json() as { id: string };
  const r = await req(`/goals/${encodeURIComponent(created.id)}`, { method: "PUT", body: { title: "Ship v2", keyResults: [{ label: "beta", target: 100, current: 100 }] } });
  assert.equal(r.status, 200);
  const goal = (await r.json()) as { version: number; progressPct: number };
  assert.equal(goal.version, 2);
  assert.equal(goal.progressPct, 100);
});

test("a check-in updates key results, appends history, and recomputes progress", async () => {
  const created = await (await req("/goals", { method: "POST", body: { title: "Adopt", keyResults: [{ id: "kr-1", label: "teams", target: 100, current: 0 }] } })).json() as { id: string };
  const r = await req(`/goals/${encodeURIComponent(created.id)}/checkin`, { method: "POST", body: { note: "week 1", status: "at_risk", krValues: { "kr-1": 60 } } });
  assert.equal(r.status, 201);
  const goal = (await r.json()) as { progressPct: number; status: string; version: number; keyResults: Array<{ current: number }>; checkins: Array<{ note: string; progressPct: number }> };
  assert.equal(goal.keyResults[0]!.current, 60);
  assert.equal(goal.progressPct, 60);
  assert.equal(goal.status, "at_risk");
  assert.equal(goal.version, 2);
  assert.equal(goal.checkins.length, 1);
  assert.equal(goal.checkins[0]!.note, "week 1");
  // The list projection surfaces the check-in count.
  const metas = (await req("/goals").then((x) => x.json())) as Array<{ id: string; checkInCount: number }>;
  assert.equal(metas.find((m) => m.id === created.id)!.checkInCount, 1);
});

test("list returns metadata (no key results); a viewer may read the endpoint", async () => {
  await req("/goals", { method: "POST", body: { title: "Listable", keyResults: [{ label: "x", target: 1, current: 1 }] } });
  const r = await req("/goals"); // as the owner (ADMIN)
  assert.equal(r.status, 200);
  const metas = (await r.json()) as Array<{ title: string; keyResultCount: number; keyResults?: unknown }>;
  const listable = metas.find((m) => m.title === "Listable");
  assert.ok(listable, "the goal appears in the owner's list");
  assert.equal(listable!.keyResultCount, 1);
  assert.equal((listable as { keyResults?: unknown }).keyResults, undefined, "list projection omits key results");
  // A viewer is allowed to hit the read endpoint (sees only shared/own scopes — not another user's private goals).
  assert.equal((await req("/goals", { cookie: VIEWER })).status, 200);
});

test("a bad write is rejected (400); a missing goal is 404", async () => {
  assert.equal((await req("/goals", { method: "POST", body: { title: "" } })).status, 400);
  assert.equal((await req("/goals/user~nope~missing")).status, 404);
});

test("RBAC floor: a viewer reads but cannot author (contributor+)", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  try {
    assert.equal((await req("/goals", { cookie: VIEWER })).status, 200, "viewer can list");
    assert.equal((await req("/goals", { method: "POST", body: { title: "Nope" }, cookie: VIEWER })).status, 403, "viewer cannot author");
  } finally {
    for (const [k, v] of [["OIDC_ISSUER_URL", prev.iss], ["OIDC_VIEWER_ROLES", prev.view]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test("delete removes the goal", async () => {
  const created = await (await req("/goals", { method: "POST", body: { title: "Temp", keyResults: [] } })).json() as { id: string };
  assert.equal((await req(`/goals/${encodeURIComponent(created.id)}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/goals/${encodeURIComponent(created.id)}`)).status, 404);
});
