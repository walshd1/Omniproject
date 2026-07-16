import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * routes/whiteboard.ts over the REAL app (demo broker). Read boards (viewer+), author through the sanitising
 * choke point (contributor+), delete (manager+). Scenes live in the backend through the broker seam.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["ENABLED_FEATURES"] = "whiteboard"; // default-off feature module — opt in for these route tests
process.env["SECURITY_STRICT"] = "off";

let server: Server;
let base: string;

function cookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
const ADMIN = cookie({ sub: "a", name: "Ada", email: "ada@x.io", roles: ["omni-admins"] });

before(async () => {
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

const req = (p: string, o: { method?: string; body?: unknown; cookie?: string } = {}) =>
  fetch(`${base}/api${p}`, {
    method: o.method ?? "GET",
    headers: { cookie: o.cookie ?? ADMIN, ...(o.body ? { "Content-Type": "application/json" } : {}) },
    ...(o.body ? { body: JSON.stringify(o.body) } : {}),
  });

test("whiteboards: list omits scene bodies; get returns the scene", async () => {
  const list = (await (await req("/whiteboards")).json()) as Array<{ id: string; scene: { elements: unknown[] } }>;
  assert.ok(list.some((w) => w.id === "wb-roadmap"));
  assert.equal(list.find((w) => w.id === "wb-roadmap")!.scene.elements.length, 0, "list omits scene");
  const one = (await (await req("/whiteboards/wb-roadmap")).json()) as { scene: { elements: unknown[] } };
  assert.ok(one.scene.elements.length > 0, "get includes the scene");
});

test("whiteboards: create sanitises the scene (strips an embedded image, drops an unsafe link)", async () => {
  const r = await req("/whiteboards", { method: "POST", body: {
    name: "Sketch",
    scene: { elements: [
      { id: "img", type: "image", fileId: "blob" },
      { id: "t", type: "text", link: "javascript:alert(1)", text: "hi" },
    ] },
  } });
  assert.equal(r.status, 201);
  const created = (await r.json()) as { id: string; scene: { elements: Array<Record<string, unknown>> } };
  assert.equal(created.scene.elements.length, 1, "image element stripped");
  assert.equal("link" in created.scene.elements[0]!, false, "unsafe link dropped");
});

test("whiteboards: update then delete", async () => {
  const created = (await (await req("/whiteboards", { method: "POST", body: { name: "Temp", scene: { elements: [] } } })).json()) as { id: string };
  const upd = await req(`/whiteboards/${created.id}`, { method: "PUT", body: { name: "Temp v2", scene: { elements: [{ id: "e1", type: "shape", shape: "ellipse", x: 0, y: 0 }] } } });
  assert.equal(upd.status, 200);
  assert.equal(((await upd.json()) as { name: string }).name, "Temp v2");
  assert.equal((await req(`/whiteboards/${created.id}`, { method: "DELETE" })).status, 204);
  assert.equal((await req(`/whiteboards/${created.id}`)).status, 404);
});

test("whiteboards: RBAC — a viewer reads but cannot author; a contributor can", async () => {
  const prev = { iss: process.env["OIDC_ISSUER_URL"], view: process.env["OIDC_VIEWER_ROLES"], contrib: process.env["OIDC_CONTRIBUTOR_ROLES"] };
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_VIEWER_ROLES"] = "omni-viewers";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  try {
    const viewer = cookie({ sub: "v1", email: "vee@x.io", roles: ["omni-viewers"] });
    assert.equal((await req("/whiteboards", { cookie: viewer })).status, 200, "viewer can read");
    assert.equal((await req("/whiteboards", { cookie: viewer, method: "POST", body: { name: "No", scene: { elements: [] } } })).status, 403, "viewer cannot author");
    const contributor = cookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    assert.equal((await req("/whiteboards", { cookie: contributor, method: "POST", body: { name: "Yes", scene: { elements: [] } } })).status, 201, "contributor can author");
  } finally {
    process.env["OIDC_ISSUER_URL"] = prev.iss ?? "";
    if (prev.iss === undefined) delete process.env["OIDC_ISSUER_URL"];
    if (prev.view === undefined) delete process.env["OIDC_VIEWER_ROLES"]; else process.env["OIDC_VIEWER_ROLES"] = prev.view;
    if (prev.contrib === undefined) delete process.env["OIDC_CONTRIBUTOR_ROLES"]; else process.env["OIDC_CONTRIBUTOR_ROLES"] = prev.contrib;
  }
});
