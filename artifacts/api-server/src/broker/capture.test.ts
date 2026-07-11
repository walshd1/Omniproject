import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureEnabled, capturePath, recordExchange, readTape, resetCaptureSeq, type Exchange } from "./capture";
import { traced } from "./trace";
import { buildReplayBroker, redrive, isWriteMethod, exchangeKey } from "./replay";
import type { Broker } from "./types";

function withEnv(env: Record<string, string | undefined>, fn: () => void | Promise<void>): void | Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };
  try {
    const r = fn();
    if (r instanceof Promise) return r.finally(restore);
    restore();
  } catch (e) {
    restore();
    throw e;
  }
}

// --- Gating --------------------------------------------------------------------

test("capture is inert in production and off without BROKER_CAPTURE", () => {
  withEnv({ NODE_ENV: "production", BROKER_CAPTURE: "/tmp/x.jsonl" }, () => {
    assert.equal(captureEnabled(), false, "must not capture in production");
    assert.equal(capturePath(), null);
  });
  withEnv({ NODE_ENV: "development", BROKER_CAPTURE: undefined }, () => {
    assert.equal(captureEnabled(), false);
  });
});

// --- Record + scrub ------------------------------------------------------------

test("a traced plane records secret-scrubbed exchanges to the tape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-tape-"));
  const tape = join(dir, "t.jsonl");
  await withEnv({ NODE_ENV: "development", BROKER_CAPTURE: tape, BROKER_TRACE: undefined }, async () => {
    resetCaptureSeq();
    const fake = {
      kind: "demo", live: false,
      async listIssues(_ctx: unknown, _projectId: string) { return [{ id: "i1", title: "One" }]; },
    } as unknown as Broker;
    const t = traced("broker", fake);
    await t.listIssues({ sub: "u", token: "SECRET", authHeader: "Bearer SECRET" } as never, "proj-001");

    const rows = readTape(tape);
    assert.equal(rows.length, 1);
    const ex = rows[0]!;
    assert.equal(ex.plane, "broker");
    assert.equal(ex.method, "listIssues");
    assert.deepEqual(ex.result, [{ id: "i1", title: "One" }]);
    // ctx is arg 0; its credentials must be masked on the tape.
    const ctx = ex.args[0] as Record<string, unknown>;
    assert.equal(ctx["token"], "[redacted]");
    assert.equal(ctx["authHeader"], "[redacted]");
    assert.equal(ctx["sub"], "u");
    assert.equal(ex.args[1], "proj-001");
    // No secret string anywhere on the line.
    assert.ok(!JSON.stringify(ex).includes("SECRET"));
  });
});

// --- Replay: serve mode --------------------------------------------------------

test("buildReplayBroker serves recorded results and is loud on a miss", async () => {
  const tape: Exchange[] = [
    { seq: 0, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [{ id: "p1" }], ms: 1, ok: true },
  ];
  const broker = buildReplayBroker(tape);
  const got = await broker.listProjects({ sub: "other" } as never);
  assert.deepEqual(got, [{ id: "p1" }]);
  await assert.rejects(() => broker.listIssues({ sub: "u" } as never, "nope"), /no recorded exchange/);
});

test("exchangeKey ignores the actor ctx (arg 0) so it matches across instances", () => {
  const a = exchangeKey("listIssues", [{ sub: "alice", token: "A" }, "proj-1"]);
  const b = exchangeKey("listIssues", [{ sub: "bob", token: "B" }, "proj-1"]);
  assert.equal(a, b);
});

// --- Replay: re-drive ----------------------------------------------------------

test("redrive skips writes by default, runs reads, and flags divergence", async () => {
  const tape: Exchange[] = [
    { seq: 0, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [{ id: "p1" }], ms: 1, ok: true },
    { seq: 1, ts: "t", plane: "broker", method: "createProject", args: [{ sub: "u" }, { name: "X" }], result: { id: "p9" }, ms: 1, ok: true },
  ];
  // Live broker (instance B): listProjects returns something DIFFERENT.
  const liveB = {
    kind: "demo", live: false,
    async listProjects(_ctx: unknown) { return [{ id: "p2" }]; },
    async createProject(_ctx: unknown, _input: unknown) { return { id: "pX" }; },
  } as unknown as Broker;

  const readOnly = await redrive(tape, liveB, { sub: "cli" } as never);
  assert.equal(readOnly.skipped, 1, "createProject must be skipped read-only");
  assert.equal(readOnly.ran, 1);
  assert.equal(readOnly.diverged, 1, "listProjects diverges (p1 vs p2)");

  const dry = await redrive(tape, liveB, { sub: "cli" } as never, { dryRun: true, allowWrites: true });
  assert.equal(dry.ran, 0, "dry-run performs no calls");
  assert.equal(dry.steps.filter((s) => s.status === "dry-run").length, 2);

  assert.equal(isWriteMethod("createProject"), true);
  assert.equal(isWriteMethod("listProjects"), false);
});

// --- recordExchange swallows a write failure (never breaks the request) --------

test("recordExchange never throws when the tape path can't be written", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-tape-badpath-"));
  // Point the tape at the DIRECTORY itself: appendFileSync throws EISDIR, which
  // recordExchange must swallow (a capture failure is a dev aid, not a fault).
  withEnv({ NODE_ENV: "development", BROKER_CAPTURE: dir }, () => {
    resetCaptureSeq();
    assert.doesNotThrow(() =>
      recordExchange({ plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [], ms: 1, ok: true }),
    );
  });
});

// --- readTape tolerates blank and corrupt lines --------------------------------

test("readTape skips blank and corrupt lines and returns the valid ones in seq order", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-tape-corrupt-"));
  const tape = join(dir, "t.jsonl");
  const valid1: Exchange = { seq: 1, ts: "t", plane: "broker", method: "b", args: [], ms: 1, ok: true };
  const valid0: Exchange = { seq: 0, ts: "t", plane: "broker", method: "a", args: [], ms: 1, ok: true };
  // Out-of-order valid lines, a blank line, and a non-JSON corrupt line.
  writeFileSync(tape, `${JSON.stringify(valid1)}\n\n{not valid json\n${JSON.stringify(valid0)}\n`);
  const rows = readTape(tape);
  assert.equal(rows.length, 2, "corrupt + blank lines dropped");
  assert.deepEqual(rows.map((r) => r.seq), [0, 1], "sorted by seq");
});

// --- A non-broker plane still records (notify/export generalisation) ------------

test("traced() records a non-broker plane too", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-tape2-"));
  const tape = join(dir, "t.jsonl");
  await withEnv({ NODE_ENV: "development", BROKER_CAPTURE: tape }, async () => {
    resetCaptureSeq();
    const exporters = { render(d: { rows: number }) { return `rows=${d.rows}`; } };
    const t = traced("export", exporters);
    assert.equal(t.render({ rows: 3 }), "rows=3");
    const rows = readTape(tape);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.plane, "export");
    assert.equal(rows[0]!.method, "render");
  });
});
