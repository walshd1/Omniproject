import { test } from "node:test";
import assert from "node:assert/strict";
import { getBackend, generateWorkflow } from "@workspace/backend-catalogue";
import { REFERENCE_BACKEND, REFERENCE_FIELD_MAP } from "./reference-backend-blueprint";
import { serveOutput, NotImplemented } from "./reference-output-blueprint";

// ── Backend plane blueprint ──────────────────────────────────────────────────

test("backend blueprint: a complete, structurally-valid binding that generates a workflow", () => {
  // It maps the core contract and is shaped like any shipped backend…
  assert.ok(REFERENCE_BACKEND.actions.list_projects && REFERENCE_BACKEND.actions.list_issues);
  const wf = generateWorkflow(REFERENCE_BACKEND);
  assert.ok(wf.nodes.length > 5);
  assert.doesNotThrow(() => JSON.stringify(wf)); // importable
});

test("backend blueprint: intentionally non-deployable — placeholder URLs, NOT in the catalogue", () => {
  assert.match(REFERENCE_BACKEND.actions.list_projects!.url!, /YOUR_API_BASE/);
  assert.equal(getBackend("reference-backend"), undefined, "the template must not be a selectable backend");
  assert.ok("fields" in REFERENCE_FIELD_MAP && "entities" in REFERENCE_FIELD_MAP);
});

// ── Output plane blueprint ───────────────────────────────────────────────────

test("output blueprint: unauthenticated requests get 401 before any read", async () => {
  let read = false;
  const r = await serveOutput({ authed: false, read: async () => { read = true; return []; } });
  assert.equal(r.status, 401);
  assert.equal(read, false, "must not read when unauthenticated");
});

test("output blueprint: complete but non-functional — the projection throws 501 until implemented", async () => {
  const r = await serveOutput({ authed: true, read: async () => [{ id: "p1" }] });
  assert.equal(r.status, 501);
  assert.match((r.body as { error: string }).error, /not implemented/i);
});

test("output blueprint: once you implement `shape`, it serves a read-only projection", async () => {
  let audited = false;
  const r = await serveOutput({
    authed: true,
    read: async () => [{ id: "p1", name: "Apollo" }],
    shape: (data) => ({ count: (data as unknown[]).length }),
    audit: () => { audited = true; },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { count: 1 });
  assert.equal(audited, true);
});

test("output blueprint: a backend read failure is a generic 502 (no leak)", async () => {
  const r = await serveOutput({ authed: true, read: async () => { throw new Error("ECONNREFUSED secret host"); }, shape: (d) => d });
  assert.equal(r.status, 502);
  assert.ok(!JSON.stringify(r.body).includes("secret host"));
});

test("output blueprint: NotImplemented is exported for custom outputs to reuse", () => {
  assert.throws(() => { throw new NotImplemented("shape"); }, /not implemented/i);
});
