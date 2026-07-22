import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizeWorkVocabularyOverride } from "./work-vocabulary-config";

/**
 * Scope-overridable work vocabulary. Statuses are org-owned (relabel/reorder/ADD/REMOVE, methodology-tagged,
 * lifecycle-required); priorities are symmetric (relabel/reorder/ADD/REMOVE, methodology-tagged) but bound to
 * an internal RANK rather than a lifecycle class — the ordinal the sorting/weighting maths key off. The
 * sanitiser (pure) enforces those boundaries; the resolver folds an org override over the shipped default.
 */

process.env["SESSION_SECRET"] = "test-session-secret-do-not-use-in-prod";
process.env["NODE_ENV"] = "production";
const CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "work-vocab-"));
process.env["OMNI_CONFIG_DIR"] = CONFIG_DIR;
after(() => fs.rmSync(CONFIG_DIR, { recursive: true, force: true }));

test("sanitizer: relabel an existing status, add a new one, remove a shipped one", () => {
  const out = sanitizeWorkVocabularyOverride({
    statuses: [
      { id: "in_progress", label: "WIP", order: 2 }, // relabel + reorder existing
      { id: "blocked", label: "Blocked", lifecycle: "active", order: 3, methodologies: ["kanban"] }, // add
      { id: "cancelled", removed: true }, // remove shipped
      { id: "todo" }, // no override fields ⇒ dropped
    ],
  });
  assert.deepEqual(out.statuses, [
    { id: "in_progress", label: "WIP", order: 2 },
    { id: "blocked", label: "Blocked", lifecycle: "active", order: 3, methodologies: ["kanban"] },
    { id: "cancelled", removed: true },
  ]);
});

test("sanitizer: a NEW status must carry label + lifecycle + order", () => {
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "frozen", label: "Frozen" }] }), /needs a label, a lifecycle class and an order/);
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "frozen", label: "Frozen", lifecycle: "slushy", order: 9 }] }), /lifecycle must be one of/);
});

test("sanitizer: per-locale translations validate locale keys; resolver localises", async () => {
  const out = sanitizeWorkVocabularyOverride({ statuses: [{ id: "done", labels: { de: "Erledigt", "en-GB": "Done" } }] });
  assert.deepEqual(out.statuses, [{ id: "done", labels: { de: "Erledigt", "en-GB": "Done" } }]);
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "done", labels: { German: "Erledigt" } }] }), /not a valid locale/);
  const { localeLabel } = await import("@workspace/backend-catalogue");
  const done = { label: "Done", labels: { de: "Erledigt" } };
  assert.equal(localeLabel(done, "de-DE"), "Erledigt"); // language fallback (de-DE → de)
  assert.equal(localeLabel(done, "fr"), "Done"); // missing locale → base label
});

test("sanitizer: a colour must be a 6-digit hex", () => {
  assert.deepEqual(sanitizeWorkVocabularyOverride({ statuses: [{ id: "done", color: "#123abc" }] }).statuses, [{ id: "done", color: "#123abc" }]);
  assert.throws(() => sanitizeWorkVocabularyOverride({ statuses: [{ id: "done", color: "red" }] }), /must be a 6-digit hex/);
});

test("sanitizer: priorities are symmetric with statuses (relabel/reorder/ADD/REMOVE) — bound to a RANK not a lifecycle", () => {
  const out = sanitizeWorkVocabularyOverride({
    priorities: [
      { id: "urgent", label: "P0" }, // relabel existing
      { id: "blocker", label: "Blocker", order: 5, rank: 5, methodologies: ["kanban"] }, // add new (needs a rank)
      { id: "low", removed: true }, // remove shipped
    ],
  });
  assert.deepEqual(out.priorities, [
    { id: "urgent", label: "P0" },
    { id: "blocker", label: "Blocker", order: 5, rank: 5, methodologies: ["kanban"] },
    { id: "low", removed: true },
  ]);
  // A priority binds to a rank, NOT a lifecycle class (that is the status axis).
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "blocker", label: "B", order: 5, rank: 5, lifecycle: "open" }] }), /has no lifecycle/);
});

test("sanitizer: a NEW priority must carry a rank (its internal level) + a rank must be a non-negative integer", () => {
  // No rank ⇒ rejected (mirrors a new status needing its lifecycle class).
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "blocker", label: "Blocker", order: 5 }] }), /needs a label, a rank and an order/);
  // A rank must be a non-negative integer.
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "blocker", label: "B", order: 5, rank: -1 }] }), /rank must be a non-negative integer/);
  assert.throws(() => sanitizeWorkVocabularyOverride({ priorities: [{ id: "blocker", label: "B", order: 5, rank: 1.5 }] }), /rank must be a non-negative integer/);
  // Relabelling a SHIPPED priority never needs a rank (it already has one in the base).
  assert.deepEqual(sanitizeWorkVocabularyOverride({ priorities: [{ id: "high", label: "P1" }] }).priorities, [{ id: "high", label: "P1" }]);
});

test("resolver: priorities carry their rank; a scope-added priority's weight resolves via its nearest band", async () => {
  const { resolveWorkVocabulary, resolvePriorityWeight, WORK_VOCABULARY_CONFIG_ID, ORG_WORK_VOCABULARY_ID } = await import("./work-vocabulary-config");
  const { PRIORITY_RANK } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  // Shipped: the five priorities resolve with their internal ranks (none=0 … urgent=4).
  const base = resolveWorkVocabulary();
  assert.deepEqual(base.priorities.map((p) => p.id), ["urgent", "high", "medium", "low", "none"]);
  assert.equal(base.priorities.find((p) => p.id === "urgent")!.rank, PRIORITY_RANK.urgent);
  assert.equal(resolvePriorityWeight("urgent", base.priorities), PRIORITY_RANK.urgent);

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary",
    payload: { id: WORK_VOCABULARY_CONFIG_ID, values: { priorities: [
      { id: "blocker", label: "Blocker", order: 5, rank: 6 }, // add — rank above every anchor
      { id: "none", removed: true }, // remove shipped
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveWorkVocabulary();
  const ids = resolved.priorities.map((p) => p.id);
  assert.ok(ids.includes("blocker"), "added priority is present");
  assert.ok(!ids.includes("none"), "removed priority is gone");
  // The added priority still resolves a weight — snapped onto the nearest canonical band (urgent=4).
  assert.equal(resolvePriorityWeight("blocker", resolved.priorities), PRIORITY_RANK.urgent);
  // An unknown priority resolves to null (the weighting never throws).
  assert.equal(resolvePriorityWeight("nope", resolved.priorities), null);
});

test("resolver: an org can add, remove and relabel statuses; methodology tags filter", async () => {
  const { resolveWorkVocabulary, WORK_VOCABULARY_CONFIG_ID, ORG_WORK_VOCABULARY_ID } = await import("./work-vocabulary-config");
  const { statusesForMethodology } = await import("@workspace/backend-catalogue");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");

  seedSystemDefaultsIfEmpty();

  const base = resolveWorkVocabulary();
  assert.deepEqual(base.statuses.map((s) => s.id), ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"]);
  assert.equal(base.statuses.find((s) => s.id === "done")!.color, "#22c55e"); // shipped hex colour

  const now = new Date().toISOString();
  putDef({ kind: "org" }, {
    id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary",
    payload: { id: WORK_VOCABULARY_CONFIG_ID, values: { statuses: [
      { id: "in_progress", label: "WIP" }, // relabel
      { id: "blocked", label: "Blocked", lifecycle: "active", order: 25, methodologies: ["kanban"] }, // add (kanban-only)
      { id: "cancelled", removed: true }, // remove
    ] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const resolved = resolveWorkVocabulary();
  const ids = resolved.statuses.map((s) => s.id);
  assert.ok(!ids.includes("cancelled"), "removed status is gone");
  assert.ok(ids.includes("blocked"), "added status is present");
  assert.equal(resolved.statuses.find((s) => s.id === "in_progress")!.label, "WIP");
  assert.equal(resolved.statuses.find((s) => s.id === "in_progress")!.lifecycle, "active"); // lifecycle preserved
  const blocked = resolved.statuses.find((s) => s.id === "blocked")!;
  assert.equal(blocked.lifecycle, "active");
  assert.deepEqual(blocked.methodologies, ["kanban"]);

  // Methodology filter: the kanban-tagged "blocked" applies to kanban, not to scrum; neutral statuses apply to both.
  assert.ok(statusesForMethodology("kanban", resolved.statuses).some((s) => s.id === "blocked"));
  assert.ok(!statusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "blocked"));
  assert.ok(statusesForMethodology("scrum", resolved.statuses).some((s) => s.id === "in_progress")); // neutral applies everywhere
});

test("resolver: a user's accessibility workVocabulary override wins over the org", async () => {
  const { resolveWorkVocabulary, WORK_VOCABULARY_CONFIG_ID, ORG_WORK_VOCABULARY_ID } = await import("./work-vocabulary-config");
  const { ACCESSIBILITY_CONFIG_ID } = await import("./user-prefs");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");
  const { makeScopedId } = await import("./artifact-store");

  seedSystemDefaultsIfEmpty();
  const SUB = "user-a11y-1";
  const now = new Date().toISOString();

  // Org recolours "done" green-ish; the user's ACCESSIBILITY config recolours it to a high-contrast value.
  putDef({ kind: "org" }, {
    id: ORG_WORK_VOCABULARY_ID, kind: "config", name: "Work vocabulary",
    payload: { id: WORK_VOCABULARY_CONFIG_ID, values: { statuses: [{ id: "done", color: "#008000" }] } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });
  putDef({ kind: "user", sub: SUB }, {
    id: makeScopedId("user", `config-${ACCESSIBILITY_CONFIG_ID}`), kind: "config", name: "Accessibility",
    payload: { id: ACCESSIBILITY_CONFIG_ID, values: { workVocabulary: { statuses: [{ id: "done", color: "#000000", labels: { de: "Fertig" } }] } } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  // Without the user scope: the org colour wins.
  assert.equal(resolveWorkVocabulary().statuses.find((s) => s.id === "done")!.color, "#008000");
  // With the user scope: the user's accessibility override wins (colour + label translation).
  const forUser = resolveWorkVocabulary({ sub: SUB });
  const done = forUser.statuses.find((s) => s.id === "done")!;
  assert.equal(done.color, "#000000");
  assert.equal(done.labels?.["de"], "Fertig");
});

test("resolver: a user's i18n JSON overrides the org, but accessibility still wins over i18n", async () => {
  const { resolveWorkVocabulary, I18N_CONFIG_ID } = await import("./work-vocabulary-config");
  const { ACCESSIBILITY_CONFIG_ID } = await import("./user-prefs");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");
  const { makeScopedId } = await import("./artifact-store");

  seedSystemDefaultsIfEmpty();
  const SUB = "user-i18n-1";
  const now = new Date().toISOString();

  // User i18n JSON sets German for done + in_progress; user accessibility overrides ONLY done's German.
  putDef({ kind: "user", sub: SUB }, {
    id: makeScopedId("user", `config-${I18N_CONFIG_ID}`), kind: "config", name: "i18n",
    payload: { id: I18N_CONFIG_ID, values: { workVocabulary: { statuses: [{ id: "done", labels: { de: "Fertig (i18n)" } }, { id: "in_progress", labels: { de: "Läuft" } }] } } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });
  putDef({ kind: "user", sub: SUB }, {
    id: makeScopedId("user", `config-${ACCESSIBILITY_CONFIG_ID}`), kind: "config", name: "Accessibility",
    payload: { id: ACCESSIBILITY_CONFIG_ID, values: { workVocabulary: { statuses: [{ id: "done", labels: { de: "Fertig (a11y)" } }] } } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });

  const v = resolveWorkVocabulary({ sub: SUB }).statuses;
  assert.equal(v.find((s) => s.id === "in_progress")!.labels?.["de"], "Läuft"); // i18n applied (accessibility silent here)
  assert.equal(v.find((s) => s.id === "done")!.labels?.["de"], "Fertig (a11y)"); // accessibility beats i18n
});

test("resolver: i18n also layers at programme + project scope (nearer scope wins)", async () => {
  const { resolveWorkVocabulary, I18N_CONFIG_ID } = await import("./work-vocabulary-config");
  const { seedSystemDefaultsIfEmpty } = await import("./system-defs");
  const { putDef } = await import("./def-import");
  const { makeScopedId } = await import("./artifact-store");

  seedSystemDefaultsIfEmpty();
  const PROG = "prog-de", PROJ = "proj-de";
  const now = new Date().toISOString();
  const i18nRow = (scope: Parameters<typeof putDef>[0], ownerId: string, de: string) => putDef(scope, {
    id: makeScopedId(scope.kind as "programme" | "project", `config-${I18N_CONFIG_ID}`, ownerId), kind: "config", name: "i18n",
    payload: { id: I18N_CONFIG_ID, values: { workVocabulary: { statuses: [{ id: "done", labels: { de } }] } } },
    createdBy: "test", createdAt: now, updatedAt: now, rowVersion: 1,
  });
  i18nRow({ kind: "programme", programmeId: PROG }, PROG, "Fertig (Programm)");
  i18nRow({ kind: "project", projectId: PROJ }, PROJ, "Fertig (Projekt)");

  // Programme scope only → programme i18n.
  assert.equal(resolveWorkVocabulary({ programmeId: PROG }).statuses.find((s) => s.id === "done")!.labels?.["de"], "Fertig (Programm)");
  // Project + programme → the nearer (project) i18n wins.
  assert.equal(resolveWorkVocabulary({ programmeId: PROG, projectId: PROJ }).statuses.find((s) => s.id === "done")!.labels?.["de"], "Fertig (Projekt)");
});
