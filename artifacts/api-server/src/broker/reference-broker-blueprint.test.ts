import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createReferenceBrokerBlueprint, backend, signEvent, NotImplemented } from "./reference-broker-blueprint";

async function post(base: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

test("blueprint: the scaffold WORKS — a verify probe succeeds without touching the backend", async () => {
  const server = createReferenceBrokerBlueprint();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await post(base, { action: "list_projects", payload: {}, verify: true });
    assert.equal(r.status, 200);
    assert.equal(r.json["success"], true);
    assert.equal((r.json["data"] as Record<string, unknown>)["verified"], true);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("blueprint: it is intentionally NON-FUNCTIONAL — every real action returns 501", async () => {
  const server = createReferenceBrokerBlueprint();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const action of ["list_projects", "create_issue", "get_capabilities", "get_project_financials"]) {
      const r = await post(base, { action, payload: { projectId: "p1", issueId: "i1", title: "x" } });
      assert.equal(r.status, 501, `${action} should be 501 Not Implemented`);
      assert.match(String(r.json["message"]), /not implemented/i);
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("blueprint: an unknown action is a 400 bad request (not a 5xx)", async () => {
  const server = createReferenceBrokerBlueprint();
  await new Promise<void>((r) => server.listen(0, () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const r = await post(base, { action: "totally_made_up", payload: {} });
    assert.equal(r.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("blueprint: every backend method is a stub that throws NotImplemented", async () => {
  // The whole surface is present but unimplemented — a complete design, no shortcuts.
  await assert.rejects(() => backend.listProjects({}), (e) => e instanceof NotImplemented);
  await assert.rejects(() => backend.updateIssue({}, "p", "i", {}), (e) => e instanceof NotImplemented);
});

test("blueprint: outbound event signing matches the contract scheme", () => {
  const sig = signEvent('{"event":"notification"}', "shh");
  assert.match(sig, /^sha256=[0-9a-f]{64}$/);
});
