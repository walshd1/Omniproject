import { test } from "node:test";
import assert from "node:assert/strict";
import { redrive } from "./replay";
import type { Exchange } from "./capture";
import type { Broker } from "./types";

/**
 * Re-drive branches beyond the read-only/dry-run happy path covered elsewhere:
 * a matching result (ok), a missing target method (failed), and a live throw
 * (failed with the error message).
 */

const ctx = { sub: "cli" } as never;

test("redrive marks a step ok when the live result matches the recording", async () => {
  const tape: Exchange[] = [
    { seq: 0, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [{ id: "p1" }], ms: 1, ok: true },
  ];
  const live = {
    kind: "demo", live: false,
    async listProjects() { return [{ id: "p1" }]; }, // identical to the recording
  } as unknown as Broker;

  const report = await redrive(tape, live, ctx);
  assert.equal(report.ran, 1);
  assert.equal(report.ok, 1);
  assert.equal(report.diverged, 0);
  assert.equal(report.steps[0]!.status, "ok");
});

test("redrive fails a step when the target broker has no such method", async () => {
  const tape: Exchange[] = [
    { seq: 5, ts: "t", plane: "broker", method: "listWidgets", args: [{ sub: "u" }], result: [], ms: 1, ok: true },
  ];
  const live = { kind: "demo", live: false } as unknown as Broker; // no listWidgets

  const report = await redrive(tape, live, ctx);
  assert.equal(report.failed, 1);
  assert.equal(report.ran, 0);
  const step = report.steps[0]!;
  assert.equal(step.status, "failed");
  assert.match(step.detail ?? "", /no such method/);
});

test("redrive fails a step and records the message when the live call throws", async () => {
  const tape: Exchange[] = [
    { seq: 9, ts: "t", plane: "broker", method: "listProjects", args: [{ sub: "u" }], result: [], ms: 1, ok: true },
  ];
  const live = {
    kind: "demo", live: false,
    async listProjects(): Promise<unknown> { throw new Error("upstream boom"); },
  } as unknown as Broker;

  const report = await redrive(tape, live, ctx);
  assert.equal(report.failed, 1);
  const step = report.steps[0]!;
  assert.equal(step.status, "failed");
  assert.match(step.detail ?? "", /upstream boom/);
});

test("redrive runs a write when allowWrites is set (not skipped)", async () => {
  const tape: Exchange[] = [
    { seq: 0, ts: "t", plane: "broker", method: "createProject", args: [{ sub: "u" }, { name: "X" }], result: { id: "p9" }, ms: 1, ok: true },
  ];
  let called = false;
  const live = {
    kind: "demo", live: false,
    async createProject() { called = true; return { id: "p9" }; },
  } as unknown as Broker;

  const report = await redrive(tape, live, ctx, { allowWrites: true });
  assert.equal(called, true, "write executed because allowWrites was set");
  assert.equal(report.skipped, 0);
  assert.equal(report.ok, 1);
});
