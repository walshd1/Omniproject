import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDefBinding, canRebind, type DefBindingConfig } from "./def-binding";

/**
 * Def selection bindings (roadmap X.12): monotonic narrowing org → project → user, with a LOCKED binding at a
 * higher scope pinning the choice so lower scopes can't override.
 */

test("no binding → falls back to the system default", () => {
  const r = resolveDefBinding({}, "projects", { projectId: "p1", sub: "u1" });
  assert.deepEqual(r, { defId: null, locked: false, source: "default" });
});

test("most-specific-unlocked wins: user over project over org", () => {
  const cfg: DefBindingConfig = {
    org: { projects: { defId: "org~a" } },
    project: { p1: { projects: { defId: "project~b" } } },
    user: { u1: { projects: { defId: "user~c" } } },
  };
  // A PM/user with their own pick gets it (the "PM loads their custom screen" case).
  assert.equal(resolveDefBinding(cfg, "projects", { projectId: "p1", sub: "u1" }).source, "user");
  // No user pick → the project binding wins over the org default.
  assert.equal(resolveDefBinding(cfg, "projects", { projectId: "p1", sub: "u2" }).source, "project");
  // No project in scope → the org default.
  assert.equal(resolveDefBinding(cfg, "projects", { sub: "u2" }).source, "org");
});

test("an ORG lock wins absolutely — no project or user override (org mandates the screen)", () => {
  const cfg: DefBindingConfig = {
    org: { projects: { defId: "org~mandated", locked: true } },
    project: { p1: { projects: { defId: "project~b" } } },
    user: { u1: { projects: { defId: "user~c" } } },
  };
  const r = resolveDefBinding(cfg, "projects", { projectId: "p1", sub: "u1" });
  assert.deepEqual(r, { defId: "org~mandated", locked: true, lockedBy: "org", source: "org" });
  // Neither a project nor a user may rebind it.
  assert.equal(canRebind(cfg, "projects", "project", { projectId: "p1" }), false);
  assert.equal(canRebind(cfg, "projects", "user", { projectId: "p1", sub: "u1" }), false);
});

test("a PROJECT lock pins it for that project's users, but the org can still override it", () => {
  const cfg: DefBindingConfig = {
    project: { p1: { projects: { defId: "project~pinned", locked: true } } },
    user: { u1: { projects: { defId: "user~c" } } },
  };
  const r = resolveDefBinding(cfg, "projects", { projectId: "p1", sub: "u1" });
  assert.equal(r.source, "project");
  assert.equal(r.locked, true);
  assert.equal(r.lockedBy, "project");
  // A user can't rebind a project-locked slot; the project itself still can (no org lock above it).
  assert.equal(canRebind(cfg, "projects", "user", { projectId: "p1", sub: "u1" }), false);
  assert.equal(canRebind(cfg, "projects", "project", { projectId: "p1" }), true);
});

test("bindings are per-slot — a lock on one slot doesn't touch another", () => {
  const cfg: DefBindingConfig = { org: { methodology: { defId: "org~scrum", locked: true } } };
  assert.equal(resolveDefBinding(cfg, "methodology", {}).locked, true);
  assert.equal(resolveDefBinding(cfg, "projects", {}).source, "default");
});
