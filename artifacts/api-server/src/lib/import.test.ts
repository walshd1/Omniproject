import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { commitImport, type CommitImportInput } from "./import";
import { setRuleModes, resetRuleModes } from "./ruleset";
import type { Broker, ActorContext } from "../broker/types";

/**
 * Tabular import job — writes mapped rows through the broker, honouring the per-row ruleset and
 * skipping (never forcing) rows blocked by a missing title, a business rule, or a broker error.
 */
afterEach(() => resetRuleModes());

const ctx = {} as ActorContext;

/** A broker whose writeIssue is driven by the supplied function. */
function fakeBroker(writeIssue: Broker["writeIssue"]): Broker {
  return { writeIssue } as unknown as Broker;
}

const base = (over: Partial<CommitImportInput>): CommitImportInput => ({
  broker: fakeBroker(async (_c, _op, p) => ({ id: `id-${(p as { title: string }).title}` }) as never),
  ctx,
  role: "omni-admins" as never,
  projectId: "P1",
  payloads: [],
  ...over,
});

test("writes each valid row and returns the created ids", async () => {
  const out = await commitImport(base({ payloads: [{ title: "A" }, { title: "B" }] }));
  assert.deepEqual(out.created.map((c) => c.id), ["id-A", "id-B"]);
  assert.equal(out.skipped.length, 0);
});

test("skips rows with a missing or non-string title", async () => {
  const out = await commitImport(base({ payloads: [{ title: "" }, { notitle: 1 }, { title: 42 }] }));
  assert.equal(out.created.length, 0);
  assert.equal(out.skipped.length, 3);
  assert.ok(out.skipped.every((s) => s.reason === "missing title"));
});

test("skips rows blocked by a business rule (read-only freeze) and reports the rule id", async () => {
  setRuleModes({ "read-only": "hard" }); // freeze all writes
  const out = await commitImport(base({ payloads: [{ title: "A" }] }));
  assert.equal(out.created.length, 0);
  assert.equal(out.skipped[0]!.rule, "read-only");
  assert.match(out.skipped[0]!.reason, /read-only|frozen/i);
});

test("skips a row when the broker returns no issue id", async () => {
  const out = await commitImport(base({
    broker: fakeBroker(async () => ({}) as never),
    payloads: [{ title: "A" }],
  }));
  assert.equal(out.created.length, 0);
  assert.equal(out.skipped[0]!.reason, "broker returned no issue");
});

test("captures a broker error as a skip and forwards it to onRowError", async () => {
  const errors: Array<{ row: number; err: unknown }> = [];
  const out = await commitImport(base({
    broker: fakeBroker(async () => { throw new Error("broker exploded"); }),
    payloads: [{ title: "A" }],
    onRowError: (row, err) => errors.push({ row, err }),
  }));
  assert.equal(out.skipped[0]!.reason, "broker exploded");
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.row, 0);
});

test("a non-Error broker throw falls back to a generic reason; onRowError is optional", async () => {
  const out = await commitImport(base({
    broker: fakeBroker(async () => { throw "string failure"; }),
    payloads: [{ title: "A" }],
  }));
  assert.equal(out.skipped[0]!.reason, "broker error");
});
