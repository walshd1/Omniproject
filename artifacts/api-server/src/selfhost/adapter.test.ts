import { test } from "node:test";
import assert from "node:assert/strict";
import { SelfHostDbAdapter, type SelfHostDbPort } from "./adapter";
import { resolveGating } from "./capability-gating";
import { domainById } from "./domains";

/** A hand-built in-memory port — no Postgres, no broker. */
function memoryPort(seed: Record<string, Record<string, unknown>> = {}): SelfHostDbPort & {
  writes: { id: string; fields: Record<string, unknown> }[];
} {
  const rows = { ...seed };
  const writes: { id: string; fields: Record<string, unknown> }[] = [];
  return {
    writes,
    readRows: async (_e, ids) =>
      Object.fromEntries(ids.filter((id) => id in rows).map((id) => [id, rows[id]!])),
    writeRow: async (_e, id, fields) => {
      writes.push({ id, fields });
      rows[id] = { ...(rows[id] ?? {}), ...fields };
    },
  };
}

const soRfinancials = resolveGating({ mode: "system-of-record", org: { adopted: ["financials"] } });

test("read keeps only capability-enabled fields; a non-adopted field is dropped from the fragment", async () => {
  const qualityField = domainById("quality").fields[0]!.key; // not adopted here
  const port = memoryPort({ "1": { title: "T", budget: 100, [qualityField]: "red", rogue: "x" } });
  const a = new SelfHostDbAdapter({ gating: soRfinancials, port });
  const [frag] = await a.read("issue", ["1"]);
  assert.equal(frag!.values["title"], "T");
  assert.equal(frag!.values["budget"], 100);
  assert.equal(frag!.values[qualityField], undefined, "quality not adopted ⇒ not surfaced");
  assert.equal(frag!.values["rogue"], undefined, "unknown column ⇒ not surfaced");
  assert.equal(frag!.role, "authoritative");
});

test("read returns one fragment per id, empty values for a missing row", async () => {
  const port = memoryPort({ "1": { title: "T" } });
  const a = new SelfHostDbAdapter({ gating: soRfinancials, port });
  const frags = await a.read("issue", ["1", "2"]);
  assert.equal(frags.length, 2);
  assert.deepEqual(frags[1]!.values, {});
});

test("write drops fields this store can't store; only allowed fields reach the port", async () => {
  const qualityField = domainById("quality").fields[0]!.key;
  const port = memoryPort();
  const a = new SelfHostDbAdapter({ gating: soRfinancials, port });
  await a.write("issue", "1", { title: "New", budget: 42, [qualityField]: "red" });
  assert.equal(port.writes.length, 1);
  assert.deepEqual(port.writes[0], { id: "1", fields: { title: "New", budget: 42 } });
});

test("write is a no-op when nothing survives the capability filter", async () => {
  const qualityField = domainById("quality").fields[0]!.key;
  const port = memoryPort();
  const a = new SelfHostDbAdapter({ gating: soRfinancials, port });
  await a.write("issue", "1", { [qualityField]: "red", rogue: 1 });
  assert.equal(port.writes.length, 0);
});

test("an as-of stamp rides through onto read fragments", async () => {
  const port = memoryPort({ "1": { title: "T" } });
  const a = new SelfHostDbAdapter({ gating: soRfinancials, port, asOf: "2026-01-01" });
  const [frag] = await a.read("issue", ["1"]);
  assert.equal(frag!.asOf, "2026-01-01");
  assert.equal(a.asOf(), "2026-01-01");
});

test("off mode ⇒ empty capability ⇒ nothing surfaces and writes are no-ops", async () => {
  const off = resolveGating({ mode: "off", org: { adopted: ["financials"] } });
  const port = memoryPort({ "1": { title: "T", budget: 5 } });
  const a = new SelfHostDbAdapter({ gating: off, port });
  const [frag] = await a.read("issue", ["1"]);
  assert.deepEqual(frag!.values, {});
  await a.write("issue", "1", { title: "x" });
  assert.equal(port.writes.length, 0);
});
