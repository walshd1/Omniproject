import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request } from "express";
import { RULE_SURFACES, type AutomationRecipe } from "@workspace/backend-catalogue";
import { onDomainEvent, emitEntityWrite, type DomainEvent } from "./domain-event";
import { dispatchDomainEvent } from "./rules-dispatcher";
import { wikiEntity } from "../routes/wiki";

/**
 * Live-trigger EMIT COVERAGE — the layer the dispatcher/schedule tests don't exercise (they hand-craft events
 * with the right triggerKind). Here we verify which advertised RULE_SURFACES actually EMIT a domain event on a
 * write, and lock the `wiki_doc` entity → `wiki-doc` surface alignment (without it, "When a wiki document is …"
 * recipes silently never fired). Also documents, in an executable form, which advertised surfaces are still
 * observe-only-not-emitting so the gap can't drift unnoticed.
 */

// Surfaces that a mounted write path EMITS today (so an event trigger on them actually fires).
const EMITTING_SURFACES = new Set(["issue", "task", "wiki-doc"]);
// Advertised trigger surfaces that have NO emitting write path yet — a recipe on them is inert until one is
// wired (risk rides the `raid_entry` entity under a different name; project/timesheet have no Lane-1 entity).
// Kept explicit so wiring one later is a deliberate move-to-EMITTING, and adding a surface forces a decision.
const OBSERVE_ONLY_SURFACES = new Set(["risk", "project", "timesheet"]);

const tick = () => new Promise((r) => setImmediate(r));
const fakeReq = () => ({ headers: {}, params: {}, query: {} } as unknown as Request);

test("emit-coverage classification is exhaustive over RULE_SURFACES (no surface unaccounted for)", () => {
  for (const s of RULE_SURFACES) {
    const classified = EMITTING_SURFACES.has(s.key) || OBSERVE_ONLY_SURFACES.has(s.key);
    assert.equal(classified, true, `RULE_SURFACES key "${s.key}" is neither emitting nor documented observe-only — classify it (wire emit, or add to OBSERVE_ONLY_SURFACES with a reason)`);
  }
  // and the two sets don't overlap
  for (const k of EMITTING_SURFACES) assert.equal(OBSERVE_ONLY_SURFACES.has(k), false, `${k} is in both sets`);
});

test("the wiki entity emits under the advertised 'wiki-doc' surface, not its internal 'wiki_doc' name", () => {
  assert.equal(wikiEntity.entity, "wiki_doc");            // audit/broker name unchanged
  assert.equal(wikiEntity.eventSurface, "wiki-doc");      // rules-engine trigger surface aligned
  assert.ok(RULE_SURFACES.some((s) => s.key === "wiki-doc"), "wiki-doc must be an advertised trigger surface");
});

test("emitEntityWrite stamps triggerKind from the given surface (wiki-doc.created, not wiki_doc.created)", async () => {
  const seen: DomainEvent[] = [];
  const off = onDomainEvent((e) => { seen.push(e); });
  try {
    emitEntityWrite(fakeReq(), "wiki-doc", "create", "p1", { result: { id: "w1", title: "Runbook" } });
    await tick();
  } finally { off(); }
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.surface, "wiki-doc");
  assert.equal(seen[0]!.triggerKind, "wiki-doc.created");
  assert.equal(seen[0]!.subject["id"], "w1");
});

test("end-to-end: a wiki-doc.created event now matches a wiki-doc inform recipe (the fix's payoff)", async () => {
  const recipe: AutomationRecipe = {
    id: "wiki-welcome", label: "Notify on new wiki doc", scope: { kind: "org" },
    trigger: { kind: "wiki-doc.created" },
    actions: [{ kind: "notify", params: { to: "docs@x.io", message: "A wiki doc was created" } }],
  };
  const evt: DomainEvent = {
    id: "evt-w", surface: "wiki-doc", verb: "created", triggerKind: "wiki-doc.created",
    subject: { id: "w1", projectId: "p1", title: "Runbook" }, scope: { projectId: "p1" },
    actor: { sub: "u1", actorKind: "human" }, causation: { depth: 0, rootEventId: "evt-w", rulePath: [] }, at: 1,
  };
  const r = await dispatchDomainEvent(evt, [recipe]);
  assert.deepEqual(r.ran, ["wiki-welcome"]);
});
