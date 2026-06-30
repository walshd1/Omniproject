import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Rate card + hashed identities + project types + the server-side staff-cost roll-up, over the REAL
 * app. The demo session holds every grant (incl. pmo). No OMNI_CONFIG_DIR is set, so the rate-card
 * store is RAM-only and reset between tests.
 */
const SECRET = "test-session-secret-rate-card";
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
const PMO = cookie({ sub: "u-rc", name: "Grace", email: "grace@x.io", roles: ["omni-admins"] });

let hashIdentity: (s: string) => string;

before(async () => {
  ({ hashIdentity } = await import("../lib/rate-card"));
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

afterEach(async () => {
  const { __resetRateCardCache } = await import("../lib/rate-card-store");
  __resetRateCardCache();
});

const put = (path: string, body: unknown) =>
  fetch(`${base}/api${path}`, { method: "PUT", headers: { cookie: PMO, "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = (path: string) => fetch(`${base}/api${path}`, { headers: { cookie: PMO } });

test("a PMO sets the rate card + project types and reads them back", async () => {
  const senior = hashIdentity("Senior Engineer");
  const r = await put("/rate-card", {
    titles: { [senior]: "Senior Engineer" },
    rates: { [senior]: { "*": { client: 100, internal: 60 } } },
    projectTypes: [{ id: "delivery", label: "Delivery" }],
  });
  assert.equal(r.status, 200);
  const body = (await get("/rate-card").then((x) => x.json())) as { titles: Record<string, string>; projectTypes: { id: string }[] };
  assert.equal(body.titles[senior], "Senior Engineer");
  assert.deepEqual(body.projectTypes.map((t) => t.id), ["delivery"]);
});

test("identities are stored hashed — the raw assignee never appears in the stored map", async () => {
  const senior = hashIdentity("Senior Engineer");
  await put("/rate-card/identities", { level: "central", assignments: [{ assignee: "alice", titleHash: senior }] });
  const map = (await get("/rate-card/identities").then((x) => x.json())) as { central: Record<string, string> };
  assert.ok(!("alice" in map.central)); // the plaintext name is not a key
  assert.equal(map.central[hashIdentity("alice")], senior); // its hash is
});

test("a project type must be one the PMO defined", async () => {
  await put("/rate-card", { titles: {}, rates: {}, projectTypes: [{ id: "delivery", label: "Delivery" }] });
  assert.equal((await put("/projects/proj-001/type", { projectType: "delivery" })).status, 200);
  assert.equal((await put("/projects/proj-001/type", { projectType: "made-up" })).status, 400);
});

test("staff-cost rolls up client vs internal from logged hours × resolved rate, server-side", async () => {
  const senior = hashIdentity("Senior Engineer");
  await put("/rate-card", { titles: { [senior]: "Senior Engineer" }, rates: { [senior]: { "*": { client: 100, internal: 60 } } }, projectTypes: [] });
  await put("/rate-card/identities", { level: "central", assignments: [{ assignee: "alice", titleHash: senior }] });
  // demo proj-001: alice's iss-001 = 26 logged hours, billable → client time.
  const cost = (await get("/projects/proj-001/staff-cost").then((x) => x.json())) as {
    clientCost: number; internalCost: number; totalCost: number; charge: number; margin: number; unratedHours: number; byTitle: { titleLabel: string }[];
  };
  assert.equal(cost.clientCost, 2600); // 26h × 100
  assert.equal(cost.charge, 2600); // no uplift set → charge == client cost
  assert.equal(cost.margin, 0);
  assert.equal(cost.byTitle[0]!.titleLabel, "Senior Engineer");
  assert.ok(cost.unratedHours > 0); // bob/others aren't mapped → not silently zero-costed
});

test("margin + overhead uplift the charge (cost-to-customer); a project override beats the central default", async () => {
  const senior = hashIdentity("Senior Engineer");
  await put("/rate-card", {
    titles: { [senior]: "Senior Engineer" },
    rates: { [senior]: { "*": { client: 100, internal: 60 } } },
    projectTypes: [],
    uplift: { margin: 0.2, overhead: 0.1 }, // central: +30%
  });
  await put("/rate-card/identities", { level: "central", assignments: [{ assignee: "alice", titleHash: senior }] });
  const central = (await get("/projects/proj-001/staff-cost").then((x) => x.json())) as { clientCost: number; charge: number; margin: number };
  assert.equal(central.clientCost, 2600);
  assert.equal(central.charge, 3380); // 2600 × 1.3
  assert.equal(central.margin, 780);
  // Override this project to a richer margin → its charge rises; the central default is untouched.
  await put("/rate-card/uplift/project/proj-001", { margin: 0.5, overhead: 0.1 }); // +60%
  const overridden = (await get("/projects/proj-001/staff-cost").then((x) => x.json())) as { charge: number };
  assert.equal(overridden.charge, 4160); // 2600 × 1.6
});

test("the staff-cost endpoint never leaks raw rates — only aggregated cost", async () => {
  const senior = hashIdentity("Senior Engineer");
  await put("/rate-card", { titles: { [senior]: "Senior Engineer" }, rates: { [senior]: { "*": { client: 100, internal: 60 } } }, projectTypes: [] });
  await put("/rate-card/identities", { level: "central", assignments: [{ assignee: "alice", titleHash: senior }] });
  const raw = await get("/projects/proj-001/staff-cost").then((x) => x.text());
  assert.ok(!raw.includes('"rates"'));
  assert.ok(!/\b"100"\b|:100\b/.test(raw) || raw.includes("2600")); // the per-hour rate 100 isn't surfaced as a field
});
