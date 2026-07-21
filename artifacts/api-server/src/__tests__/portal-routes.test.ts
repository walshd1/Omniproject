import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

/**
 * Guest portal + scoped-guest principal over the REAL app. A guest is invited (manager+) to ONE project,
 * lands via the magic-link, gets a CONFINED session (guest role floor + single-project scope), can read
 * only that project's curated status, and is locked out of every other (viewer+) route.
 */
const SECRET = "test-session-secret-do-not-use-in-prod";
process.env["SESSION_SECRET"] = SECRET;
process.env["NODE_ENV"] = "production";
process.env["RATE_LIMIT_DISABLED"] = "true";
process.env["GUEST_PORTAL_ENABLED"] = "true";
process.env["SECURITY_STRICT"] = "off";
process.env["PUBLIC_URL"] = "https://portal.example"; // production requires this to build invite links safely

let server: Server;
let base: string;
let mintGuestToken: typeof import("../lib/magic-link").mintGuestToken;

function signedSessionCookie(session: object): string {
  const value = JSON.stringify(session);
  const mac = crypto.createHmac("sha256", SECRET).update(value).digest("base64").replace(/=+$/, "");
  return `omni_session=${encodeURIComponent("s:" + value + "." + mac)}`;
}
// Demo mode ⇒ this signed session resolves to full grants (admin), so it can invite.
const ADMIN = signedSessionCookie({ sub: "mgr", name: "Mgr", email: "mgr@x.io", roles: ["omni-admins"] });

before(async () => {
  ({ mintGuestToken } = await import("../lib/magic-link"));
  const { default: app } = await import("../app");
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server?.close());

/** Land a guest via the magic-link verify path; return the session cookie the redirect set. */
async function landGuest(projectId: string, tier: "read" | "comment" = "read"): Promise<string> {
  const token = mintGuestToken(`client-${projectId}@x.io`, { projectId, tier }, Date.now());
  const res = await fetch(`${base}/api/auth/magic/verify?token=${encodeURIComponent(token)}&returnTo=/portal`, { redirect: "manual" });
  assert.equal(res.status, 302, "verify redirects");
  assert.equal(res.headers.get("location"), "/portal", "guest lands on the portal");
  const setCookies = res.headers.getSetCookie();
  const session = setCookies.map((c) => c.split(";")[0]!).find((c) => c.startsWith("omni_session="));
  assert.ok(session, "a guest session cookie was set");
  return session!;
}

test("a guest lands via the magic-link and reads ONLY its project's curated status", async () => {
  const guest = await landGuest("proj-001");
  const res = await fetch(`${base}/api/portal/status`, { headers: { cookie: guest } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { project: { id: string; name: string }; progress: { percent: number }; milestones: unknown[] };
  assert.equal(body.project.id, "proj-001", "the guest sees exactly its invited project");
  assert.ok(typeof body.progress.percent === "number");
  assert.ok(Array.isArray(body.milestones));
  // The curated payload must NOT leak any financial/internal columns.
  const raw = JSON.stringify(body);
  for (const secret of ["budget", "actualCost", "earnedValue", "benefit", "costCenter"]) {
    assert.ok(!raw.includes(secret), `curated status must not leak "${secret}"`);
  }
});

test("a guest is LOCKED OUT of every viewer+ route (the app proper)", async () => {
  const guest = await landGuest("proj-001");
  for (const path of ["/projects", "/tasks", "/portfolio/health", "/programmes"]) {
    const res = await fetch(`${base}/api${path}`, { headers: { cookie: guest } });
    assert.equal(res.status, 403, `guest must be 403 on ${path} (below viewer)`);
    await res.body?.cancel().catch(() => {});
  }
});

test("/auth/me reports the guest role + its confined project", async () => {
  const guest = await landGuest("proj-003");
  const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: guest } })).json()) as { role: string; guest?: { projectId: string; tier: string } };
  assert.equal(me.role, "guest");
  assert.deepEqual(me.guest, { projectId: "proj-003", tier: "read" });
});

test("the invite link is single-use (replay is refused)", async () => {
  const token = mintGuestToken("dupe@x.io", { projectId: "proj-001", tier: "read" }, Date.now());
  const url = `${base}/api/auth/magic/verify?token=${encodeURIComponent(token)}&returnTo=/portal`;
  assert.equal((await fetch(url, { redirect: "manual" })).status, 302, "first use works");
  assert.equal((await fetch(url, { redirect: "manual" })).status, 400, "replay is refused");
});

test("POST /portal/invites is manager+ and validates its input", async () => {
  // Admin (demo) can invite.
  const ok = await fetch(`${base}/api/portal/invites`, {
    method: "POST", headers: { cookie: ADMIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "guest@client.io", projectId: "proj-001", tier: "read" }),
  });
  assert.equal(ok.status, 201);
  // Bad email → 400.
  const bad = await fetch(`${base}/api/portal/invites`, {
    method: "POST", headers: { cookie: ADMIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "nope", projectId: "proj-001" }),
  });
  assert.equal(bad.status, 400);
});

test("a guest cannot mint further invites (guest is below manager)", async () => {
  const guest = await landGuest("proj-001");
  const res = await fetch(`${base}/api/portal/invites`, {
    method: "POST", headers: { cookie: guest, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "sneak@x.io", projectId: "proj-002", tier: "read" }),
  });
  assert.equal(res.status, 403, "a guest can't escalate by inviting others");
});

// ── RBAC on invite: a non-manager (real RBAC) is refused ──
test("a contributor cannot invite guests (403)", async () => {
  const keys = ["OIDC_ISSUER_URL", "OIDC_CONTRIBUTOR_ROLES", "OIDC_MANAGER_ROLES"] as const;
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env["OIDC_ISSUER_URL"] = "https://idp.example";
  process.env["OIDC_CONTRIBUTOR_ROLES"] = "omni-contributors";
  process.env["OIDC_MANAGER_ROLES"] = "omni-managers";
  try {
    const contributor = signedSessionCookie({ sub: "c1", email: "cee@x.io", roles: ["omni-contributors"] });
    const res = await fetch(`${base}/api/portal/invites`, {
      method: "POST", headers: { cookie: contributor, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "x@y.io", projectId: "proj-001", tier: "read" }),
    });
    assert.equal(res.status, 403);
  } finally {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]!; }
  }
});

test("the portal 404s when GUEST_PORTAL_ENABLED is off", async () => {
  const guest = await landGuest("proj-001");
  process.env["GUEST_PORTAL_ENABLED"] = "";
  try {
    const res = await fetch(`${base}/api/portal/status`, { headers: { cookie: guest } });
    assert.equal(res.status, 404);
    await res.body?.cancel().catch(() => {});
  } finally {
    process.env["GUEST_PORTAL_ENABLED"] = "true";
  }
});
