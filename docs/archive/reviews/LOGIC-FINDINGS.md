# Logic & Collision Audit — Findings

A per-definition **logic & collision** audit of OmniProject's stateless PM/PgM overlay. The target
class is bugs where the **data is individually VALID but the behaviour is FUNCTIONALLY BROKEN** —
principally **identity collisions**: two valid rows that share a `name` (or a bare `id` across
different sources) that some consumer keys / dedupes / groups / sorts on, so rows silently merge,
mis-group, double-count, drop, or render in a nondeterministic order.

Entity identity in this codebase is the composite key **`source:id`** (`qualifyId` / `qualifiedId` /
`stampSource` in `artifacts/api-server/src/broker/identity.ts`). A consumer keying on a bare `id`, or
on `name` / `title`, is a collision bug. Programme grouping by `programmeId` is **by design** (a
programme is a backend-owned grouping derived from membership), so that is not itself flagged — but an
**unstable sort** over programme rows (equal metric ⇒ nondeterministic order) is, because the DoD
requires deterministic output.

Defs stressed (auto-enumerated from the generated catalogues, not hardcoded): **36** —
16 reports + 6 widgets + 8 screens + 6 views.

## Findings

| # | Class | Severity | File:line | Status |
|---|-------|----------|-----------|--------|
| 1 | id-collision | High | `artifacts/omniproject/src/lib/roadmap.ts:108` (+ caller `components/reports/PortfolioRoadmap.tsx:86`) | fixed |
| 2 | unstable-sort | Medium | `artifacts/omniproject/src/lib/roadmap.ts` (lane + bar sort) | fixed |
| 3 | unstable-sort | Medium | `artifacts/omniproject/src/lib/exec-pack.ts:35` (`bySeverity`) | fixed |
| 4 | unstable-sort | Medium | `artifacts/omniproject/src/lib/capacity-rollup.ts:69` | fixed |
| 5 | unstable-sort | Medium | `artifacts/omniproject/src/lib/portfolio-finance.ts:92` | fixed |
| 6 | unstable-sort | Medium | `artifacts/omniproject/src/lib/portfolio-value.ts:72,122` (income + benefits) | fixed |
| 7 | unstable-sort | Medium | `artifacts/api-server/src/lib/programmes.ts:175` (`groupProgrammes`) | fixed |
| 8 | name-collision | Medium | `artifacts/omniproject/src/lib/resource-load.ts:54,84` (assignee) | follow-up |
| 9 | unstable-sort | Low | generated `SCREENS` / `VIEWS` catalogues (sort by `order`) | follow-up |

---

### 1. Roadmap issues keyed by bare `id` (id-collision) — FIXED

`buildRoadmap` looked up each project's issues with `issuesByProject[project.id]`, and the caller
built that map with `byProject[p.id] = …`. Two projects that are **individually valid** but share a
bare `id` across different sources (`jira:p1` and `ado:p1`) collide: the second overwrites the first
in the map, and both projects then read the **same (wrong) issue span** — silently mis-dating one
project's bar to the other's timeline.

**Repro (valid rows):**
```
project A = { id: "p1", source: "jira", name: "Apollo" }  issues: [2026-01-01 … 2026-02-01]
project B = { id: "p1", source: "ado",  name: "Zeus"   }  issues: [2026-06-01 … 2026-07-01]
```
Before the fix both bars derived from a single `byProject["p1"]` entry; after, they key on
`source:id` (`jira:p1`, `ado:p1`) and each reads its own issues.

**Fix:** added an optional `source` to `RoadmapProject`, an exported `roadmapKey(project)` returning
`source:id` (falling back to the bare `id` when no source is present, so single-source data is
unchanged), and keyed both the derivation and the caller through it.

Regression test: `artifacts/omniproject/src/lib/collision-stress.test.ts` →
"D_collide: two projects with the SAME bare id, different source, do NOT share issues".

### 2–7. Nondeterministic order for equal sort keys (unstable-sort) — FIXED

`Array.prototype.sort` is not guaranteed stable across engines when the comparator returns `0`, so any
sort whose comparator can tie for two **distinct** rows produces run-to-run / engine-to-engine
nondeterministic output. Every fixed site had a unique tiebreaker available (the composite
`projectId`, or the group `key` / `id` which is unique per group):

- `roadmap.ts` — lane sort tied on `start` + `name`; bar sort tied on `start` + `end`. Added
  `key` / `projectId` final tiebreakers.
- `exec-pack.ts` `bySeverity` — two equally-severe exceptions (same rag, blockers, schedule &
  budget variance) tied. Added `projectId` (the composite `source:id`) tiebreaker.
- `capacity-rollup.ts` — programmes with equal utilisation tied. Added `key`.
- `portfolio-finance.ts` — programmes with equal variance tied. Added `key`.
- `portfolio-value.ts` — income (equal unbilled) and benefits (equal realisation) tied. Added `key`.
- `programmes.ts` `groupProgrammes` — two programmes with the same `name` tied. Added `id`.

Regression tests assert output is identical when the input order is reversed
(`collision-stress.test.ts`, both SPA and api-server harnesses).

### 8. Resource load groups by bare assignee name (name-collision) — FOLLOW-UP

`resourceLoad` / `loadDeltas` (`resource-load.ts`) key a `Map` on the bare `assignee` string. Two
different people with the same display name (Alice from Jira vs Alice from Azure DevOps) are merged
into one `PersonLoad`, collapsing their task lists and mis-computing peak concurrency; `loadDeltas`
inherits the collision and can mis-flag `newlyContended`.

**Why follow-up, not fixed here:** `LoadInput` carries only `assignee: string | null` — there is no
assignee **id** or `source` on the input type. A correct fix requires plumbing a qualified assignee
identity (`source:assigneeId`) through the whole schedule-sandbox pipeline (the scenario builder, the
drag model, the API surface), which is out of scope for a surgical keying fix and touches UI plumbing
rather than a shared derivation helper. Tracked as a follow-up. The existing sort already has a stable
`assignee.localeCompare` tiebreaker, so ordering is deterministic even though the grouping is name-based.

### 9. Generated catalogue order ties (unstable-sort) — FOLLOW-UP

`SCREENS` / `VIEWS` (and `REPORTS` / `widgets`) sort by numeric `order`. If two defs ever share an
`order`, the sequence is nondeterministic. Today no collisions exist (the stress harness asserts
uniqueness), and a parallel wave is actively adding a new report + widget to the **catalogue
generation** internals — per the guardrails we do **not** touch that generation here. Documented as a
follow-up: add an `id` tiebreaker to the catalogue sort comparators when the generation code next
changes. The harness (`collision-stress.test.ts`) asserts the ordering is deterministic today and will
catch a future `order` collision.
