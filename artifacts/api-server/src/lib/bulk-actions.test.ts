import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runBulk, bulkFingerprint, MAX_BULK_ITEMS, type RunBulkInput } from "./bulk-actions";
import { setRuleModes, resetRuleModes } from "./ruleset";
import type { Broker, ActorContext, Project } from "../broker/types";
import type { Role } from "./rbac";

/**
 * Bulk-action job — composes only the existing gated broker writes (create/update project), one
 * canonical action per item, honouring the per-item ruleset + per-target scope and SKIPPING (never
 * forcing) a blocked/out-of-scope/errored item. Pure of Express; the broker is a fake here.
 */
afterEach(() => resetRuleModes());

const ctx = {} as ActorContext;
const role = "manager" as Role;

interface Calls {
  create: Array<Record<string, unknown>>;
  update: Array<{ id: string; input: Record<string, unknown> }>;
}

/** A broker whose create/update record their inputs and return a project shaped from them. */
function fakeBroker(calls: Calls, over: Partial<Broker> = {}): Broker {
  return {
    createProject: async (_c: ActorContext, input: Record<string, unknown>) => {
      calls.create.push(input);
      return { id: `p-${String(input["name"])}`, name: input["name"], omniInstanceId: input["omniInstanceId"] } as unknown as Project;
    },
    updateProject: async (_c: ActorContext, id: string, input: Record<string, unknown>) => {
      calls.update.push({ id, input });
      return { id, ...input } as unknown as Project;
    },
    ...over,
  } as unknown as Broker;
}

const base = (calls: Calls, over: Partial<RunBulkInput>): RunBulkInput => ({
  broker: fakeBroker(calls),
  ctx,
  role,
  spec: { action: "update_project", targets: [], patch: {} },
  dryRun: false,
  inScope: async () => true,
  ...over,
});

test("update_project: applies the patch to each in-scope target, in input order", async () => {
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    spec: { action: "update_project", targets: ["P1", "P2", "P3"], patch: { status: "Closed" } },
  }));
  assert.equal(out.total, 3);
  assert.equal(out.applied, 3);
  assert.deepEqual(out.results.map((r) => r.id), ["P1", "P2", "P3"]);
  assert.ok(out.results.every((r) => r.status === "applied"));
  assert.deepEqual(calls.update.map((u) => u.id), ["P1", "P2", "P3"]);
  assert.ok(calls.update.every((u) => u.input["status"] === "Closed"));
});

test("update_project: an out-of-scope target is skipped (not leaked), the rest apply", async () => {
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    spec: { action: "update_project", targets: ["MINE", "THEIRS"], patch: { programmeId: "prog-x" } },
    inScope: async (id) => id === "MINE",
  }));
  assert.equal(out.applied, 1);
  assert.equal(out.skipped, 1);
  const theirs = out.results.find((r) => r.target === "THEIRS")!;
  assert.equal(theirs.status, "skipped");
  assert.match(theirs.reason!, /scope/i);
  // The broker was NEVER asked to touch the out-of-scope project.
  assert.deepEqual(calls.update.map((u) => u.id), ["MINE"]);
});

test("update_project: a read-only freeze skips every item with the rule id (nothing written)", async () => {
  setRuleModes({ "read-only": "hard" });
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    spec: { action: "update_project", targets: ["P1", "P2"], patch: { status: "Closed" } },
  }));
  assert.equal(out.applied, 0);
  assert.ok(out.results.every((r) => r.status === "skipped" && r.rule === "read-only"));
  assert.equal(calls.update.length, 0);
});

test("create_project: creates one project per name, each with a DISTINCT minted omniInstanceId", async () => {
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    spec: { action: "create_project", names: ["Alpha", "Beta", "Gamma"], template: { programmeId: "prog-x", status: "Active" } },
  }));
  assert.equal(out.applied, 3);
  assert.deepEqual(calls.create.map((c) => c["name"]), ["Alpha", "Beta", "Gamma"]);
  // The shared template rides on every create…
  assert.ok(calls.create.every((c) => c["programmeId"] === "prog-x" && c["status"] === "Active"));
  // …but each gets its OWN correlation GUID (the fix that stops N creates collapsing to one
  // idempotency key). All present, all unique.
  const guids = calls.create.map((c) => String(c["omniInstanceId"]));
  assert.ok(guids.every((g) => g.length > 0));
  assert.equal(new Set(guids).size, 3);
});

test("create_project: a read-only freeze skips every create (nothing written)", async () => {
  setRuleModes({ "read-only": "hard" });
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    spec: { action: "create_project", names: ["Alpha"], template: {} },
  }));
  assert.equal(out.applied, 0);
  assert.equal(out.results[0]!.status, "skipped");
  assert.equal(out.results[0]!.rule, "read-only");
  assert.equal(calls.create.length, 0);
});

test("a hostile/extra field is dropped — only allowlisted ProjectWrite fields reach the broker", async () => {
  const calls: Calls = { create: [], update: [] };
  await runBulk(base(calls, {
    // omniInstanceId (server-minted) and a bogus role field must never ride through.
    spec: { action: "update_project", targets: ["P1"], patch: { status: "Closed", omniInstanceId: "forged", role: "admin" } as Record<string, unknown> },
  }));
  const sent = calls.update[0]!.input;
  assert.equal(sent["status"], "Closed");
  assert.equal(sent["omniInstanceId"], undefined);
  assert.equal(sent["role"], undefined);
});

test("dryRun: validates + projects the outcome but writes NOTHING", async () => {
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    dryRun: true,
    spec: { action: "create_project", names: ["Alpha", "Beta"], template: {} },
  }));
  assert.equal(out.applied, 2); // preview-apply counts toward "applied" for the summary
  assert.ok(out.results.every((r) => r.status === "preview-apply"));
  assert.equal(calls.create.length, 0); // the broker was never called
});

test("dryRun: a freeze projects a preview-skip (still no write)", async () => {
  setRuleModes({ "read-only": "hard" });
  const calls: Calls = { create: [], update: [] };
  const out = await runBulk(base(calls, {
    dryRun: true,
    spec: { action: "update_project", targets: ["P1"], patch: { status: "Closed" } },
  }));
  assert.equal(out.results[0]!.status, "preview-skip");
  assert.equal(out.applied, 0);
  assert.equal(calls.update.length, 0);
});

test("a broker error on one item is captured as an error, the batch continues", async () => {
  const calls: Calls = { create: [], update: [] };
  const broker = fakeBroker(calls, {
    updateProject: (async (_c: ActorContext, id: string) => {
      if (id === "BOOM") throw new Error("backend exploded");
      return { id } as unknown as Project;
    }) as Broker["updateProject"],
  });
  const errs: number[] = [];
  const out = await runBulk(base(calls, {
    broker,
    spec: { action: "update_project", targets: ["P1", "BOOM", "P3"], patch: { status: "Closed" } },
    onItemError: (i) => errs.push(i),
  }));
  assert.equal(out.applied, 2);
  assert.equal(out.errored, 1);
  const boom = out.results.find((r) => r.target === "BOOM")!;
  assert.equal(boom.status, "error");
  assert.match(boom.reason!, /backend exploded/);
  assert.deepEqual(errs, [1]);
});

test("MAX_BULK_ITEMS is a sane, enforced-elsewhere cap (documented floor)", () => {
  assert.ok(MAX_BULK_ITEMS > 0 && MAX_BULK_ITEMS <= 5_000);
});

test("bulkFingerprint: stable, order-independent over the item SET, and content-sensitive", () => {
  const a = bulkFingerprint({ action: "create_project", names: ["A", "B", "C"], template: { status: "Active" } });
  const reordered = bulkFingerprint({ action: "create_project", names: ["C", "A", "B"], template: { status: "Active" } });
  assert.equal(a, reordered); // same SET of items ⇒ same token
  assert.match(a, /^[0-9a-f]{64}$/);
  // A different patch/template ⇒ different token (you can't confirm a batch you didn't preview).
  assert.notEqual(a, bulkFingerprint({ action: "create_project", names: ["A", "B", "C"], template: { status: "Closed" } }));
  // A different action ⇒ different token.
  assert.notEqual(a, bulkFingerprint({ action: "update_project", targets: ["A", "B", "C"], patch: { status: "Active" } }));
  // A hostile/extra field is stripped before hashing (same token as without it).
  const withExtra = bulkFingerprint({ action: "create_project", names: ["A"], template: { status: "Active", role: "admin" } as Record<string, unknown> });
  const without = bulkFingerprint({ action: "create_project", names: ["A"], template: { status: "Active" } });
  assert.equal(withExtra, without);
});
