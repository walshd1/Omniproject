import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Feature gating + governance routes over the REAL app: scoped GET resolution and the
 * programme/project governance PUTs (with the parent-ceiling check). Demo sessions hold every
 * grant, so RBAC role-gating itself is covered in the rbac unit tests, not here.
 */
const SECRET = "test-session-secret-features-routes";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";

let server: Server;
let base: string;
function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "u-feat", name: "Grace Hopper", email: "grace@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

afterEach(async () => {
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ programmeFeatures: {}, projectFeatures: {}, featureGovernance: { required: [], forbidden: [] }, enabledFeatures: [], disabledFeatures: [] });
});

const getFeatures = (q = "") =>
  fetch(`${base}/api/features${q}`, { headers: { cookie: ADMIN } }).then(async (r) => ({ status: r.status, body: await r.json() as { features: { id: string; enabled: boolean; blockedAt?: string }[] } }));
const put = (path: string, body: unknown) =>
  fetch(`${base}/api${path}`, { method: "PUT", headers: { cookie: ADMIN, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("GET /api/features returns the resolved status (grid on, presence off by default)", async () => {
  const { status, body } = await getFeatures();
  assert.equal(status, 200);
  assert.equal(body.features.find((f) => f.id === "grid")!.enabled, true);
  assert.equal(body.features.find((f) => f.id === "presence")!.enabled, false); // default-off (cost)
});

test("a programme PUT forbid disables a feature for that programme scope", async () => {
  const r = await put("/features/programme/prog-1", { forbidden: ["grid"] });
  assert.equal(r.status, 200);
  // org scope: grid still on; programme scope: off + blocked at programme.
  assert.equal((await getFeatures()).body.features.find((f) => f.id === "grid")!.enabled, true);
  const scoped = (await getFeatures("?programmeId=prog-1")).body.features.find((f) => f.id === "grid")!;
  assert.equal(scoped.enabled, false);
  assert.equal(scoped.blockedAt, "programme");
});

test("a programme cannot require a feature outside the org-approved set (ceiling → 400)", async () => {
  // presence is default-off and not org-enabled → a programme can't mandate it.
  const r = await put("/features/programme/prog-1", { required: ["presence"] });
  assert.equal(r.status, 400);
});

test("a self-contradictory config (same id required AND forbidden) is rejected", async () => {
  const r = await put("/features/programme/prog-1", { required: ["grid"], forbidden: ["grid"] });
  assert.equal(r.status, 400);
});

test("an unknown catalogue id is rejected (no silent dead config)", async () => {
  const r = await put("/features/programme/prog-1", { forbidden: ["definitely-not-a-feature"] });
  assert.equal(r.status, 400);
});

test("a reserved prototype key as the scope id is rejected", async () => {
  const r = await put("/features/programme/__proto__", { forbidden: ["grid"] });
  assert.equal(r.status, 400);
});

test("a project cannot require a feature the programme forbade (project ceiling honours programme forbid)", async () => {
  // programme forbids grid; a project under it then tries to mandate grid → ceiling 400.
  assert.equal((await put("/features/programme/prog-1", { forbidden: ["grid"] })).status, 200);
  const r = await put("/features/project/proj-1?programmeId=prog-1", { required: ["grid"] });
  assert.equal(r.status, 400);
});

test("an org `forbid report:x` actually withholds the report from /setup/reports (not just the admin table)", async () => {
  const reportsOf = () => fetch(`${base}/api/setup/reports`, { headers: { cookie: ADMIN } }).then(async (r) => (await r.json() as { id: string }[]).map((x) => x.id));
  assert.ok((await reportsOf()).includes("evm")); // present by default
  const { updateSettings } = await import("../lib/settings");
  updateSettings({ featureGovernance: { required: [], forbidden: ["report:evm"] } });
  assert.ok(!(await reportsOf()).includes("evm")); // forbidden → gone from what's served
});
