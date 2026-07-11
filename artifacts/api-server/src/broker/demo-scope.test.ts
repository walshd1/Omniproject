import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoBroker } from "./demo";
import type { ActorContext } from "./types";

/**
 * Reference data-scope enforcement in the in-process backend. Demonstrates the contract an
 * external backend (n8n) mirrors off the forwarded, PSK-signed `userContext.scope`:
 *  - `all`       ⇒ everything (the demo's own posture)
 *  - `programme` ⇒ only projects in the owned programmes (fail-closed on unattributable rows)
 *  - a write outside the principal's scope is refused.
 */
const broker = new DemoBroker();
const ctx = (scope: ActorContext["scope"]): ActorContext => ({ sub: "u-1", scope });

test("listProjects: all-scope returns everything; an empty programme scope returns nothing (fail-closed)", async () => {
  const all = await broker.listProjects(ctx({ level: "all" }));
  assert.ok(all.length > 0, "demo has sample projects");
  const none = await broker.listProjects(ctx({ level: "programme", sub: "u-1", programmes: [] }));
  assert.equal(none.length, 0);
});

test("listProjects: programme-scope returns only projects in the owned programme", async () => {
  const all = await broker.listProjects(ctx({ level: "all" }));
  // Pick any project's programme (if the sample set has one) and scope to it.
  const withProg = (all as Array<Record<string, unknown>>).find((p) => p["programmeId"] != null);
  if (!withProg) return; // sample set has no programme-bound project; nothing to assert
  const prog = String(withProg["programmeId"]);
  const scoped = await broker.listProjects(ctx({ level: "programme", sub: "u-1", programmes: [prog] }));
  assert.ok(scoped.length > 0);
  assert.ok(scoped.every((p) => String((p as Record<string, unknown>)["programmeId"]) === prog));
});

test("updateProject: a principal out of the project's scope is refused (unauthorized)", async () => {
  const all = await broker.listProjects(ctx({ level: "all" }));
  const id = String((all[0] as Record<string, unknown>)["id"]);
  await assert.rejects(
    () => broker.updateProject(ctx({ level: "programme", sub: "u-1", programmes: ["not-a-real-programme"] }), id, { name: "x" }),
    (e: unknown) => e instanceof Error && /scope/i.test(e.message),
  );
});

test("updateProject: an all-scope principal (demo default) is allowed", async () => {
  const all = await broker.listProjects(ctx({ level: "all" }));
  const id = String((all[0] as Record<string, unknown>)["id"]);
  const updated = await broker.updateProject(ctx({ level: "all" }), id, { name: "Renamed by test" });
  assert.equal((updated as Record<string, unknown>)["name"], "Renamed by test");
});
