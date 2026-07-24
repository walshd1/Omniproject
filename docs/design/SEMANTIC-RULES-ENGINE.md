# Semantic rules engine — a globally-applicable, chainable trigger→action engine

**Status:** phases 1–5 implemented (feature-flagged off by default); phases 6–7 (chaining
with the cross-run cascade guard, AI-initiated rules) designed, not yet built. Records the
target for generalising the existing automation/workflow machinery into one **surface-agnostic**,
**chainable** rules engine of the shape *"ON a trigger, DO an action TO a target, IF a
condition holds, gated by the initiator's permission — and safe under approvals + AI
restrictions."*

**Built so far (behind `RULES_ENGINE_EVENTS`, off by default):**
- **Phase 1** — one shared condition language: the pure predicate engine moved to
  `@workspace/backend-catalogue` (`predicate.ts`); recipes gained `when` (a full `ConditionSet`);
  `matchesConditions` now delegates to it (legacy flat `conditions` convert via `conditionSetOf`).
- **Phase 2** — surface-agnostic taxonomy: `RULE_SURFACES` (data) with event triggers **generated**
  from `surfaces × verbs`; `TriggerKind`/`ActionKind` widened to strings; `set-status`/`assign` added.
- **Phase 3** — post-commit `DomainEvent` emit at `mountEntity` (auto) + `mountCommand` (`emits`
  opt-in), in-process + out-of-band (`lib/domain-event.ts`).
- **Phase 4** — the dispatcher (`lib/rules-dispatcher.ts`): matches trigger+scope+`when`, runs
  **inform-only** recipes under the initiating principal.
- **Phase 5** — gated mutating effects. A dispatched write has no live request, so it runs as an
  AUTONOMOUS principal (`automation:rule_<id>`) and is **default-deny** under the autonomous-grant
  gate — no admin grant ⇒ no write. An approval binding (`rule.run:<id>`) takes precedence: the run
  is HELD as a proposal, nothing writes. Mutation is confined to a new `allowWrites` effect surface
  (`effectsForAutonomousContext`) so human-run *workflows* stay read+notify (unchanged). The write
  reaches the autonomous-guarded broker, which re-checks the grant (scope/fields/time/cap + AI
  containment). The target is bound from the triggering subject. Only the `issue` surface has a wired
  write effect today (matching phase 2); other surfaces remain observe/notify-only.

Companion to, and a strict **reuse** of:
- the pure workflow interpreter (`artifacts/api-server/src/lib/workflow.ts`),
- the fail-closed effect surface (`artifacts/api-server/src/lib/workflow-run.ts`),
- the automation-recipe layer (`artifacts/api-server/src/lib/automation.ts`, `lib/backend-catalogue/src/automation-catalogue.ts`),
- the predicate language (`artifacts/api-server/src/lib/predicate.ts`),
- the business ruleset (`artifacts/api-server/src/lib/ruleset.ts`) — see `RULE-BUILDER.md`,
- approval chains + AI/autonomous safety (`WORKFLOW-APPROVAL-CHAINS.md`, `AI-SECURITY.md`).

> **The house rule that governs this whole note:** *build no new engine.* Every piece below
> either already exists or is thin glue between existing pieces. The genuinely-new surface
> area is **one** thing — a domain-event dispatcher — plus **data** (a surface-agnostic
> trigger/action catalogue) and one **safety extension** (gated mutating effects). Nothing
> here loosens an existing gate.

---

## 1. What already exists (reuse, do not rebuild)

The user's sentence already maps, almost completely, onto shipped code:

| The phrasing | Where it lives today |
| --- | --- |
| **ON** a trigger | `AUTOMATION_TRIGGERS` (`automation-catalogue.ts`) — `schedule`, `issue.created`, `issue.updated`; `TriggerDef.mode ∈ event\|schedule` |
| **DO** an action **TO** a target | `AUTOMATION_ACTIONS` — `notify` / `set-field` / `add-label` / `create-issue`; `compileRecipe()` → workflow-engine JSON; `workflow.ts` runs it |
| **IF** a condition holds | `matchesConditions()` (automation) and the richer `predicate.ts` (`matches`, `all`/`any`, `eq/ne/gt/gte/lt/lte/in/nin/truthy/…`) |
| gated by the **initiator's permission** | `recipeRequirements()` → RBAC in `routes/automations.ts` ("automate only what you may edit"); `rbac.ts` `grantsSatisfy`/`requireRole` |
| **safe under approvals** | `approval-chain.ts` + `approval-service.ts` + `approval-binding.ts`; `proposeIfBound()`; `workflow.run:<id>` executor binding |
| **safe under AI restrictions** | `autonomous-grant.ts` + `broker/autonomous-guard.ts` (default-deny, scoped, capped), `ai-containment.ts`, `ai-kill.ts`, `responsibility-acceptance-service.ts` |

So there is already a working pipeline: **recipe → compile → bounded workflow interpreter →
RBAC-scoped, fail-closed effect surface**, with mutating runs deferred to approval chains /
autonomous grants. This note does **not** re-open any of that. It fills four gaps.

---

## 2. The four gaps this note closes

1. **No event dispatcher (the keystone).** `issue.created` / `issue.updated` exist as trigger
   *labels* but **nothing emits them**. A recipe runs only via the manual `POST
   /automations/:id/run` with the subject supplied in the request body. There is no code that
   observes a real domain write and fires the matching enabled recipes. *This is the one
   genuinely-new surface.*
2. **Triggers/actions are issue-shaped, not surface-agnostic.** The taxonomy hard-codes
   `issue.*` and four issue-ish actions. "Globally applicable to any surface" means the
   taxonomy must be **data-driven**: a new surface (task, risk, timesheet, project, wiki-doc,
   proof, …) becomes a **catalogue entry**, not a code change.
3. **No chaining, and no cross-run cycle guard.** A recipe can't yet "run recipe/workflow X",
   and — more importantly — once a recipe can *mutate*, its write emits a new event that can
   trigger further recipes. `workflow.ts`'s depth/step caps bound a *single* run; they do
   **not** bound an event→action→event→action **cascade**. Chaining needs a **causation guard
   on the event envelope**.
4. **Mutating effects are refused.** `makeEffects` (`workflow-run.ts:51`) throws on any action
   outside the read+notify allowlist — deliberately, so a workflow can't silently mutate. To
   let the engine "DO X to Y" we must add mutating effects **without** weakening that stance:
   every mutating effect stays behind the approval + autonomous-grant + containment pipeline.

---

## 3. Model — the generalised rule

A **Rule** (the generalised, surface-agnostic successor to `AutomationRecipe`) is:

```ts
interface Rule {
  id: string;
  label: string;
  enabled?: boolean;                         // default true
  scope: { kind: "org" } | { kind: "project"; projectId: string };

  // ON — a catalogued trigger, surface-agnostic: "<surface>.<verb>" or a schedule.
  trigger: { kind: TriggerKind; cron?: string };

  // IF — the shared predicate language (all/any nesting), evaluated against the event subject.
  when?: ConditionSet;                       // from predicate.ts — REPLACES matchesConditions

  // DO … TO — one or more catalogued actions, each naming a target.
  actions: RuleAction[];
}

interface RuleAction {
  kind: ActionKind;                          // catalogued; declares mutating + requirement + effect
  params: Record<string, unknown>;           // target + payload (e.g. { projectId, field, value })
}
```

Two deliberate changes from `AutomationRecipe`:

- **`when` uses `ConditionSet` (predicate.ts), not the bespoke `matchesConditions`.** One
  condition language across governance, cost, rulesets, and now rules — with `all`/`any`
  nesting and the richer operator set. `matchesConditions` is retired (§6.4); a back-compat
  shim maps the old flat `conditions: [{field,op,value}]` onto `{ all: [...] }` at read time so
  stored recipes keep working.
- **`trigger.kind` and `action.kind` are surface-agnostic catalogue ids** (§4), not the fixed
  `issue.*` / four-action set.

`Rule` still **compiles to the existing `WorkflowDef`** via `compileRecipe`'s successor — no
new interpreter. The generalisation is in the *catalogue* and the *dispatcher*, not the engine.

---

## 4. Surface-agnostic trigger/action taxonomy (data, not code)

Today `automation-catalogue.ts` enumerates `TriggerKind`/`ActionKind` as string unions. Make
them **catalogue-driven** so any surface participates without touching the engine.

### 4.1 Triggers

```ts
type TriggerMode = "event" | "schedule";
interface TriggerDef {
  kind: string;              // "task.created", "task.status-changed", "risk.raised", "schedule", …
  surface?: string;         // the noun: "task" | "issue" | "risk" | "timesheet" | … (absent for schedule)
  verb?: string;            // "created" | "updated" | "status-changed" | "deleted" | …
  label: string;
  mode: TriggerMode;
  subjectFields: string[];  // the field keys the event subject is guaranteed to carry (for the IF picker)
}
```

The event triggers are **generated from the write surfaces** rather than hand-listed: every
noun that flows through the Lane-1 entity pipeline (`entity-pipeline.ts` `mountEntity`) and
every verb through the Lane-2 action base (`action-base.ts` `mountCommand`) already has a
stable **action name** (`create_issue`, `update_task`, `create_raid`, …). The trigger
catalogue is derived from that same registry, so "what can fire a rule" and "what actually
gets written" cannot drift.

### 4.2 Actions

```ts
interface ActionDef {
  kind: string;             // "notify" | "set-field" | "add-label" | "assign" | "set-status" | "create:<surface>" | "run-rule" | …
  label: string;
  mutating: boolean;
  requires: ActionRequirement;   // {kind:"inform"} | {kind:"project-write"} | {kind:"collection";collection} — unchanged shape
  effect: string;           // the workflow-engine effect name it compiles to (§5)
  target?: { surface: string };  // the noun it writes (for the authoring UI + scope checks)
}
```

`create-issue` generalises to `create:<surface>`; `set-field`/`add-label`/`assign`/`set-status`
are field-writes over a target surface. **`run-rule` / `run-workflow` are new action kinds for
chaining** (§7). Each mutating action still declares its `requires` so the author-time RBAC
check ("automate only what you may edit") and the run-time re-check are unchanged.

> **Invariant carried from `RULE-BUILDER.md`:** the IF field picker and the DO target picker
> are driven by the **field catalogue** (`field-vocabulary.ts`) and, where useful, the
> **screen→fields** index — a rule is authored by guided choice, not a free-form predicate
> string.

---

## 5. The event dispatcher (the keystone — the one new surface)

### 5.1 Emit

A single **post-commit** emit at the two write chokepoints, so no route re-implements it:

- `entity-pipeline.ts` (`mountEntity`) — after a noun write succeeds.
- `action-base.ts` (`mountCommand`) — after a verb `run` succeeds (post-audit).

Both already compute a stable action name and have the actor context + the written payload.
The emit publishes a typed **event envelope** onto the existing `notify-bus` (in-process or
Redis Pub/Sub — already fleet-safe):

```ts
interface DomainEvent {
  id: string;
  surface: string;                 // "task" | "issue" | …
  verb: string;                    // "created" | "status-changed" | …
  triggerKind: string;             // "<surface>.<verb>" — matches TriggerDef.kind
  subject: Record<string, unknown>;// the written entity (+ prior values for *-changed verbs)
  scope: { projectId?: string; programmeId?: string };
  actor: { sub: string; role?: string; actorKind: "human" | "automation" | "agent" };
  causation: { depth: number; rootEventId: string; rulePath: string[] };  // §7 cycle guard
  at: number;
}
```

Emit is **best-effort and out-of-band**: a dispatcher failure must never fail the originating
write (the write already committed + audited). Emit is itself gated by a feature flag so the
whole subsystem is **off by default**.

### 5.2 Dispatch

A dispatcher subscribes to the bus and, per event:

1. Load enabled rules whose `trigger.kind === event.triggerKind` **and** whose `scope` covers
   `event.scope` (org rules match all; project rules match their project).
2. For each, evaluate `matches(rule.when, event.subject)` (`predicate.ts`) — skip on false.
3. For a surviving rule, **mint the initiating principal** and run it (§6) under the
   causation-guarded path (§7).

The dispatcher is the successor to the manual `POST /automations/:id/run` body-subject path;
that route stays as a **dry-run / test-fire** surface (author fires a rule against a sample
subject) but the production path is event-driven.

---

## 6. Permission model — "gated by whoever the initiator is"

The user's "apply it if a person with this permission level starts it" resolves to: **the run
executes as a principal, and that principal must be allowed to do every action in the rule.**
Three initiator classes, each already modelled:

- **Human-initiated (event caused by a human write).** The rule runs under an actor snapshot
  (`RunActor`, `workflow-run.ts:72`) derived from the human whose write emitted the event, but
  **never above the rule author's RBAC scope** — the author-time `recipeRequirements` check
  already bounds a rule to what its author may edit; the run re-checks. So a rule can never
  escalate: it is the **intersection** of (author's scope) ∩ (each action's requirement).
- **Schedule-initiated.** Runs under a minted **autonomous** principal
  (`mintAutonomousContext`, `autonomous.ts:114`) from the `REGISTRY` allowlist, viewer-roled
  for read/notify jobs (`scheduled-job.ts:48`); a *mutating* scheduled rule needs an explicit
  autonomous **grant** (§6.1) and is otherwise held/denied.
- **AI/agent-initiated.** An `agent:<id>:<onBehalfOf>` principal — the strictest path (§8).

### 6.1 Mutating actions stay behind every existing gate

This is the crux of "aware of approvals and AI restrictions". Adding mutating effects to the
workflow surface does **not** bypass anything. A mutating action traverses, in order (all
pre-existing):

1. **Author-time + run-time RBAC** — the rule may only carry actions its author (and the run
   principal) may perform (`grantsSatisfy`, `assertProjectScope`).
2. **Approval binding** — the compiled run binds to `workflow.run:<id>` /
   `rule.run:<id>`; `proposeIfBound()` (`approval-gate.ts:26`) holds it at **202 pending** if
   an admin/PMO bound it to a chain. Execution resumes only when the chain reaches `approved`
   (passkey-signed, separation-of-duties, `humanOnly`-aware).
3. **AI kill switch** — `aiKillEngaged()` short-circuits every autonomous write.
4. **AI containment** — `aiContainmentLevel()` sets how tight an autonomous grant must be;
   `public`/`remote` forbids wildcard scope and mandates time + count caps.
5. **Autonomous write grant at the broker seam** — `wrapWithAutonomousGuard`
   (`broker/autonomous-guard.ts:101`) runs `authorizeAutonomousWrite` before any guarded
   broker write: default-deny action/project/surface/field scope + `notAfter` + `maxWrites`,
   fail-closed audited.

So the workflow effect surface gains mutating **effect names**, but the mutation itself only
lands if it passes 2–5. The `makeEffects` allowlist stays fail-closed — it simply now includes
mutating effects that **delegate to the guarded broker methods** (which re-check the grant),
and a mutating rule with no approval binding + no autonomous grant **cannot write** (it is held
at 202, or denied by the broker guard). Concretely, a mutating effect is:

```ts
// inside makeEffects — a mutating case delegates to the GUARDED broker method, never a raw write.
case "broker.writeIssue":
  // deps.broker is the autonomous-guarded broker; if deps.ctx is an autonomous/agent actor
  // without a matching grant, wrapWithAutonomousGuard THROWS here. Humans pass the guard but
  // are still bounded by their own RBAC scope in the broker.
  return deps.broker.writeIssue(deps.ctx, /* classified write */ …);
```

No new bypass, one more effect name.

---

## 7. Chaining + the cascade cycle guard

Two chaining mechanisms, both bounded:

- **Explicit composition** — a `run-rule` / `run-workflow` action invokes another rule/workflow
  as a step. Bounded by `workflow.ts`'s existing depth/step caps **within a run**.
- **Emergent chaining** — a rule's mutating action emits its own `DomainEvent`, which may
  trigger further rules. This crosses run boundaries, so `workflow.ts`'s caps do **not** bound
  it. The **`causation` field on the envelope** does:

```
causation: { depth, rootEventId, rulePath }
```

- A write emitted by a rule-run carries `depth = parentEvent.causation.depth + 1` and appends
  the firing rule id to `rulePath`.
- The dispatcher **refuses** to fire when `depth > CASCADE_MAX_DEPTH` (env-tunable, small
  default e.g. 8), or when the candidate rule id **already appears in `rulePath`** (direct
  cycle break), and **logs the drop** (no silent truncation — mirrors the autonomous-guard /
  workflow runaway posture).
- A per-root **fan-out budget** (max total rule-runs traceable to one `rootEventId`) caps
  breadth as well as depth, so a wide fan-out can't storm the bus.

This makes chaining safe by construction: a human write can kick off a bounded cascade, and a
misauthored A→B→A loop terminates at the first repeat with an audit line, not a runaway.

---

## 8. AI-awareness (what changes when the initiator is AI)

An AI-initiated or AI-approved rule-run carries **strictly more** constraints than a human one
— all already built (`WORKFLOW-APPROVAL-CHAINS.md` §4, `responsibility-acceptance-service.ts`):

- The principal is `agent:*` ⇒ `isAutonomous` ⇒ the **full autonomous-grant gate** applies
  (default-deny; no grant ⇒ no write).
- **Containment scales the grant**: under `public`/`remote` AI exposure, the grant must
  enumerate projects/surfaces/fields (no wildcards) and carry mandatory `notAfter` + `maxWrites`.
- **AI as approver** is default-deny: `submitDecision` refuses an AI `approve` unless the action
  is `workflow.run:<id>` **and** a live, human, passkey-signed `WorkflowAcceptance` exists for
  that exact workflow version — voided by any edit (content-hash) or by the signer's
  deprovisioning. A `humanOnly` stage refuses AI even then.
- The **kill switch** (`aiKillEngaged`) stops all agent writes instantly, fleet-wide.

Net: turning a rule "autonomous" is not a toggle a rule author can self-grant — it requires the
human responsibility-acceptance + autonomous-grant path, exactly as an AI-run workflow does
today. The rules engine inherits this rather than re-implementing it.

---

## 9. Where the three "rules" planes converge (and where they stay separate)

The repo has several rule-shaped systems. This note **unifies the condition language** across
them but keeps their **effects** distinct — they are different by design:

| Plane | Effect | Direction | Stays / converges |
| --- | --- | --- | --- |
| **Business ruleset** (`ruleset.ts`) | block / warn a write | **restrict-only**, tighten-only across scope | stays a *guard*; converges onto `predicate.ts` per `RULE-BUILDER.md` (comparison rules) |
| **Governance rules** (`governance-rules.ts`) | require/forbid/disable a feature | restrict-only | already on `predicate.ts`; unchanged |
| **Cost rules** (`cost-rules.ts`) | margin/overhead uplift | data transform | already on `predicate.ts`; unchanged |
| **Rules engine** (this note) | **DO an action** (notify / mutate / chain) | **additive/effectful**, gated | new; the only plane that *acts* rather than *restricts* |

The important line: the business ruleset and governance rules **restrict** and must stay
restrict-only (a rule can never *grant*). The rules engine **acts**, and every action it takes
is gated by §6. Sharing one condition language (`predicate.ts`) is the unification; sharing
effects would be a category error.

---

## 10. Phasing (each step self-contained + testable, feature-flagged off by default)

1. **Condition unification.** Point `Rule.when` at `predicate.ts` `ConditionSet`; add the
   back-compat shim from flat `conditions[]`; delete `matchesConditions`. *Pure; no dispatch.*
2. **Surface-agnostic catalogue.** Derive `TriggerDef`/`ActionDef` from the entity/command
   registries; generalise `create-issue` → `create:<surface>` and add field-write actions
   (`set-status`, `assign`). *Data + validation; still no auto-fire.*
3. **Event emit.** Post-commit `DomainEvent` emit at `mountEntity` + `mountCommand`, behind a
   flag, onto `notify-bus`. Best-effort; never fails the write. *The keystone, read-only side.*
4. **Dispatcher.** Subscribe, match trigger+scope+`when`, run the (still read/notify-only)
   compiled workflow under the initiating principal. *Auto-fire for inform-only rules.*
5. **Gated mutating effects.** Add mutating effect names to `makeEffects`, delegating to the
   autonomous-guarded broker; wire `proposeIfBound` so a bound mutating rule holds at 202.
   *Mutation, fully gated — no new bypass.*
6. **Chaining + cascade guard.** `run-rule`/`run-workflow` actions; `causation` depth/cycle/
   fan-out guard in the dispatcher with drop-logging. *Chaining, bounded.*
7. **AI-initiated rules.** Allow an `agent:*` principal to be a rule initiator under the
   existing responsibility-acceptance + grant path. *Inherits §8; no new AI authority.*

Phases 1–4 deliver the visible win — "when a task's status changes to blocked, notify the PM"
fires automatically — with **zero** mutation risk. Phases 5–7 add mutation + chaining strictly
behind the existing safety pipeline.

---

## 11. Open questions

- **Ordering / idempotency.** The bus is fan-out, not a durable queue. For *inform* effects
  at-least-once is fine; for *mutating* cascades, do we need a dedupe key (`rootEventId` +
  action) so a redelivered event can't double-write? Lean yes — reuse `maxWrites` + an idem key.
- **`*-changed` prior values.** `set-status` triggers want `{ from, to }`. The entity pipeline
  has the prior row on update; the envelope should carry `subject.__prev` for changed-verbs, or
  triggers can only see the new value. Decide the contract in phase 3.
- **Schedule triggers** already have a home (`scheduled-job.ts` mints viewer-roled principals);
  a *mutating* scheduled rule is the one case with no human-in-the-loop at fire time — it should
  **require** an autonomous grant + (recommended) an approval binding, never run mutating on a
  bare schedule.
- **Author-time cascade preview.** Can the builder show "this rule can trigger rules X, Y (depth
  2)" statically from the trigger/action catalogue, so an author sees a potential loop before it
  ships? Nice-to-have; static `action.target.surface → trigger.surface` graph.
- **Per-surface opt-in.** Should event emit be per-surface toggleable (emit for tasks but not
  timesheets) to bound blast radius during rollout? Probably yes — a `surfaces` allowlist on the
  emit flag.
