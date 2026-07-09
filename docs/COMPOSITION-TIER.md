# Composition tier + self-host DB adoption

A stateless, role-aware layer between the broker (north seam) and the store adapters (south seam),
plus a gated, wizard-wired way for an operator with **no existing PM tool** to let OmniProject's own
database become a system-of-record (or an augmenting store) for a slice of the work-item superset.

> **Prefer connecting your existing tool.** OmniProject is a stateless overlay — its value is that
> your real PM tool stays the single source of truth and nothing migrates. Self-host adoption is the
> **non-preferred**, opt-in, admin/PMO-gated path, and it ships with a *disclose-not-insure* posture:
> the operator owns, secures, backs up and warrants the data; OmniProject discloses that boundary, it
> does not cover it.

## 1. The composition tier — combine on read, scatter on write, hold nothing

The tier is the pure "brain" that sits between the broker and one-or-more **store adapters**. It
holds no data: a read **combines** each store's fragment into one record; a write **scatters** a patch
to each field's single owner.

```
broker (north seam) ──▶ Compositor ──▶ StoreAdapter[]  (south seam)
                        │  read  = combine fragments (role precedence, honest availability)
                        │  write = scatter patch to each field's single writer
                        └─ stateless: holds only the adapter list
```

**Store roles + precedence** (`authoritative ▸ augmenting ▸ cache`):

- **authoritative** — owns and writes the field; wins on read.
- **augmenting** — may only own/read a field **no authoritative store can store** (the *augmenting
  guard*), so it fills gaps rather than shadowing the system of record.
- **cache** — never writes; always **last** in the read order; a cache hit is `sourced` data carried
  with a `cached` **freshness** (freshness ≠ provenance — we never invent a "cached" provenance).

**Honest availability.** Every composed field reports one of `present | empty | absent | unavailable`:
a real value; an owner that's up but has nothing; a field no store can even surface; or an owner that
was **down** (so we genuinely don't know — a partial, not a silent empty). Writes are honest too: a
field with no writer is surfaced as **unpersistable** (never dropped), and a multi-store write that
partly fails returns an honest **partial** (no cross-store transaction is faked).

Code: `artifacts/api-server/src/composition/` — `types.ts` (vocabulary), `ownership.ts`
(`resolveOwnership` + the augmenting guard), `combine.ts` (`combine`/`isPartial`), `scatter.ts`
(`scatter`), `compositor.ts` (`Compositor` over `StoreAdapter[]`), `index.ts` (barrel).

## 2. Self-host DB adoption — domains, gating, adapter, wizard

The self-host store plugs into the composition tier as **one more `StoreAdapter`**; the gateway still
holds nothing. Adoption is expressed in **domains** — named, gated bundles of canonical fields derived
from `FIELD_REGISTRY`:

| Domain | Gate | Unlocks |
| --- | --- | --- |
| `issues` | core (always) | The work-item spine: items, status, people, scheduling, links. |
| `resources` | cost | Effort, estimates, agile sizing. |
| `financials` | storage | Budgets, actuals, EVM. |
| `baseline` | storage | Schedule baselines + critical path. |
| `history` | storage | Actual dates + history (time-travel). |
| `quality` | storage | RAG health, blockers, defects. |
| `raid` | storage | The risk register (probability/exposure/response). |
| `benefits` | storage | Planned-vs-actual benefit value. |
| `strategy` | storage | Goals, KPIs, OKRs, value-stream alignment. |

- **`domains.ts`** — the nine domains, resolved against the live field registry (disjoint partition;
  every key is a real registry field). Each is a governed catalogue id `selfhost:<domain>`.
- **`capability-gating.ts`** — `resolveGating({mode, org, programme?, project?})` reuses the org →
  programme → project **feature-resolution** model wholesale (monotonic narrowing + PMO
  require/forbid locks). `buildSelfHostCapability` turns the live domains into the `StoreCapability`
  the compositor reads; `domainRowsForScope` is the admin/wizard read model.
- **`adapter.ts`** — `SelfHostDbAdapter implements StoreAdapter` over an injected `SelfHostDbPort`
  (`readRows`/`writeRow`). The adapter enforces the capability: a field the gating hasn't enabled is
  never read up, never written down. It speaks **no SQL** — the port does (the port's concrete
  implementation is the broker's parameterised-SQL workflow; see [SELF-HOST-DB.md](SELF-HOST-DB.md)).
- **`setup-wizard.ts`** — the pure state machine behind the wizard step: `initialWizardState`,
  `wizardReducer`, `guardrails`, `canComplete`, `toConfig`, `holdsOnlyCopy`. Modes are
  `off | augmenting | system-of-record`.
- **`runtime.ts`** — the one bridge from live settings to a `GatingInput` for a scope, so the gateway
  and the admin/wizard screens resolve adoption identically.

## 3. Data-responsibility — "disclose, don't insure"

Adopting the self-host DB moves the **only copy** of some data into infrastructure OmniProject neither
operates nor backs up nor warrants. So the model has exactly **one hard gate** — a data-responsibility
acknowledgement — enforced in three places so it can't be bypassed:

1. **Wizard** (`guardrails`/`canComplete`): a non-off mode can't complete until acknowledged; the
   other three guardrails are *warnings* that inform the choice (prefer an existing tool; augmenting
   fills gaps only; system-of-record makes your DB authoritative).
2. **Settings validation** (`validateSelfHost`): a non-off `selfHost.mode` without
   `acknowledgedDataResponsibility: true` is rejected (400) — same trust class as `loggingSync`.
3. **UI** (`SelfHostDbStep`): the "in your database — your responsibility" disclosure + ack checkbox
   gate the Save button; the admin screen surfaces the "holds the only copy" banner.

## 4. React — wizard step + admin screen

- **`setup/SelfHostDbStep.tsx`** — the wizard step: mode radios, extra-capability checkboxes, the
  guardrail callouts, the holds-only-copy disclosure + ack, POSTing `toConfig` to
  `POST /api/setup/self-host`. Admin-only.
- **`settings/SelfHostCapabilitiesAdmin.tsx`** — the admin/PMO screen: per-domain toggles scoped
  org / programme / project (admin governs org adoption; PMO/admin narrow per programme/project;
  everyone else read-only). Reuses the existing governance mutations for scoped narrowing.

Gateway: `GET/POST /api/setup/self-host` (admin/PMO) resolve + persist adoption; `selfhost:<domain>`
ids are registered in the governance catalogue so a PMO can mandate/forbid a domain like any feature.

## 5. CI guard — zero-at-rest above the seam

A new guard, **`guard-zero-at-rest-above-seam`**, makes the stateless guarantee structural: it fails
CI if anything above the south seam (the gateway `src`, the SPA `src`) imports a persistence layer (a
SQL/NoSQL driver, an ORM, a query builder, an embedded KV store). All data-at-rest lives **below** the
seam — in a real backend or behind the injected `SelfHostDbPort`. Wired into the `verify` job.

## 6. Tests

- **Composition** (`node:test`): ownership incl. the augmenting guard (both directions +
  store-only); combine incl. present/empty/absent/unavailable + cache-fallback freshness; scatter
  incl. unpersistable + ordering; compositor incl. downed-store partial read, failed-augmenting
  partial write, and statelessness.
- **Self-host** (`node:test`): domains (disjoint partition, gates), capability-gating (scope
  narrowing + locks), adapter (capability-filtered read/write), setup-wizard (the one BLOCK guardrail,
  `canComplete`, `toConfig`, `holdsOnlyCopy`), plus the `POST /api/setup/self-host` route (400 without
  the ack) and `validateSelfHost`.
- **React** (`vitest`): the wizard step (mode/ack/guardrails/POST) and the admin screen (RBAC, org
  adoption POST, locks).

> **Test-runner note:** the api-server package uses `node:test` (`tsx --test "src/**/*.test.ts"`), not
> vitest — the composition/self-host colocated tests follow that, and the SPA tests use vitest.

## 7. Scope & limits

- **Stateless preserved.** Turning self-host on gives the broker a database to talk to; it does **not**
  change the gateway's zero-at-rest guarantee (now CI-enforced above the seam).
- **Non-preferred by design.** The wizard steers first-time users to connect an existing tool first.
- **Portability.** The self-host store is superset-native; an OpenProject-compatible export view is the
  documented exit path (see [SELF-HOST-DB.md](SELF-HOST-DB.md)).
- **The port is the SQL boundary.** This PR ships the composition tier, the gating/adapter/wizard, the
  governance + settings wiring, the React, the CI guard and the tests. The concrete `SelfHostDbPort`
  (the parameterised-SQL broker workflow) and the DDL generator remain as documented in SELF-HOST-DB.md.
