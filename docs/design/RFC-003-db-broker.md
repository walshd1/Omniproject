# RFC-003 — Optional database broker (SQLite · Postgres · MongoDB)

**Status:** Design — not started. No commitment to dates.
**Author:** build session.
**Supersedes/Depends:** builds on the broker seam ([BROKER.md](../BROKER.md), [adr/0001](../adr/0001-broker-boundary.md)), the published contract ([CONTRACT.md](../CONTRACT.md)), the conformance suite, and the field registry / capability model.

---

## 0. The unbreakable rule

> **The database is an OPTION, never a REQUIREMENT.** OmniProject is a stateless,
> zero-data-at-rest, read-through overlay by default. A database-backed mode
> exists because *some customers* might want OmniProject to be their system of
> record (a "blank canvas" with no existing backend) — **not** because the
> product needs one. The core must build, boot, test, and ship with **no database
> driver present and no database configured**, forever.

This RFC treats that rule as a structural invariant to be **enforced by tests and
packaging**, not merely stated in prose (§5). If any part of the design would make
a database load-bearing for the core, the design is wrong.

---

## 1. Why this is cheap (and why the seam earns its keep)

Everything above the broker seam talks only to the `Broker` interface in
OmniProject's own vocabulary. A database mode is therefore **one more `Broker`
implementation**, not a re-architecture. We already have the template:
`DemoBroker` is effectively an in-memory database — it holds collections, mutates
them, recomputes roll-ups, enforces optimistic concurrency (`version`), and even
persists to disk in dev mode (`lib/dev-persist.ts`). A real DB broker is
"DemoBroker, but the store is SQLite/Postgres/Mongo instead of a JS object."

Two recent investments pay off immediately:

- **Conformance suite** (`broker/conformance.ts`): the new broker is validated
  against the published contract the moment it exists — DemoBroker-style reference
  pass plus a live pass.
- **Field registry + capability model**: a DB broker *owns its schema*, so it can
  declare full capabilities and surface the **entire** registry (incl. the
  financials/CRM/ITSM fields). The blank-canvas user gets the richest field set
  precisely because nothing is gated off by a limited backend.

---

## 2. Goals / non-goals

**Goals**
- One `DbBroker` implementing the full `Broker` contract, backed by a pluggable
  store with **three** drivers: SQLite, PostgreSQL, MongoDB.
- Pass the broker conformance suite as a first-class broker.
- "Any field" persistence: store the whole field registry (and unknown
  passthrough fields) without a migration per field.
- Strictly opt-in selection; the default deployment is unchanged.

**Non-goals**
- Becoming the recommended mode. The read-through overlay stays the identity.
- Cross-database federation, sharding, or analytics warehousing.
- Replacing n8n for customers who have a real system of record.
- A migration/ORM framework. We want the thinnest persistence that satisfies the
  contract.

---

## 3. Architecture

### 3.1 A persistence **port**, three **adapters**

Write the broker logic **once** and vary only the storage:

```
        Broker interface  (unchanged, published contract)
                 ▲
          DbBroker  ── implements Broker once: roll-ups, version/CAS checks,
                 │     capability declaration, provenance="sourced"
                 ▼
            Store (port)  ── narrow persistence interface the broker needs
              ├─ SqliteStore ─┐
              ├─ PostgresStore ┼─ share a SqlStore base (dialect-parameterised)
              └─ MongoStore   ─┘ (document-native)
```

`DbBroker` contains all the domain behaviour (the same logic DemoBroker has);
`Store` is just CRUD + query primitives (`listProjects`, `getIssue`,
`upsertIssue(cas)`, `listIssues(projectId)`, `members(projectId)`, `addRaid`, …).
SQLite and Postgres share a `SqlStore` (same SQL, parameterised dialect/driver);
Mongo is its own adapter over the identical logical shape.

### 3.2 Schema: stable core columns + a JSON blob (so "any field" works)

To honour the registry's "map anything" model without a migration per field:

- **SQL (SQLite/Postgres):** a small set of **indexed core columns** —
  `id`, `project_id`, `status`, `version`, `programme_id`, `updated_at` — plus a
  `data JSON` (SQLite) / `JSONB` (Postgres) column carrying the full normalised
  row (every registry field + unknown passthrough). New canonical fields = a
  registry edit only; **no DDL**. Promote a JSON field to an indexed column only
  when query performance demands it.
- **Mongo:** the document *is* the normalised row; `ensureIndexes` on the same
  core keys. Naturally schemaless — ideal for the long-tail registry.

This mirrors how the contract already treats entities (`Row` = open record), so
the store stays faithful to the seam.

### 3.3 Optimistic concurrency (already in the contract)

`version` column / document field. `upsertIssue` does a compare-and-swap on
`expectedVersion`; a mismatch throws `BrokerError("conflict")` → the gateway maps
it to **409** exactly as today. SQL: `UPDATE … WHERE id=? AND version=?`. Mongo:
`findOneAndUpdate({_id, version}, …)`. No new contract surface.

### 3.4 Roll-ups & provenance

Denormalised counts (`issueCount`, `completedCount`) and the financial fields are
maintained on write (the `recountProject` pattern DemoBroker already uses), so
programme/portfolio roll-ups and the financials work unchanged. Responses are
tagged `provenance: "sourced"` — for a DB broker the database *is* the source of
record.

---

## 4. Selection & configuration (opt-in, never default)

`getBroker()` selection order becomes — **DB only when explicitly asked for**:

```
1. OMNI_BROKER set?           → that broker (sqlite | postgres | mongodb | n8n | demo)
2. else BROKER_URL set?       → N8nBroker            (unchanged)
3. else                       → DemoBroker           (unchanged default)
```

A database is reached **only** via an explicit `OMNI_BROKER=sqlite|postgres|mongodb`
(plus `OMNI_DB_PATH` / `OMNI_DB_URL` / `OMNI_MONGO_URI`). With no DB env, the
selection is byte-for-byte what it is today. There is no implicit fallback into a
database, ever.

---

## 5. Enforcing "optional, never required" (the structural guarantees)

This is the heart of the RFC. Each guarantee is a mechanism, not a promise:

1. **Optional dependencies only.** `better-sqlite3`, `pg`, `mongodb` go in
   `optionalDependencies` (or a separate workspace package), **never**
   `dependencies`. `pnpm install` for the core never fetches them; a missing
   native build can never break the core.
2. **Lazy driver load.** Each adapter `await import("pg")` (etc.) **inside** the
   adapter, only after the DB broker is selected. If the driver is absent and the
   DB isn't selected, nothing is imported and nothing fails. Selecting a DB whose
   driver isn't installed yields a clear, actionable error — not a crash at boot.
3. **Default is never a DB.** Guard test: with the env cleared, `getBroker()`
   returns `DemoBroker` (or `N8nBroker` when `BROKER_URL` is set) — **never** a DB
   broker.
4. **Core is DB-free above the seam.** Extend the architecture-guard
   (`broker-guard.test.ts` style) so no module **outside `broker/db/`** imports a
   database driver or `DbBroker` directly — same discipline that keeps n8n behind
   the seam.
5. **CI proves it.** The existing build/test/smoke jobs already run with **no DB
   installed**; make that explicit — a job asserting the full suite + demo-mode
   smoke boot pass with zero DB drivers present. The DB adapters get their own
   opt-in job (services: postgres, mongo) running the **same conformance suite**.
6. **Docs keep the default identity.** The stateless single-container / multi-
   replica deployment remains the documented default; DB mode is a *separate,
   clearly-labelled opt-in profile*, framed as "OmniProject as system of record",
   not as the main path.

If all six hold, a database can never silently become required.

---

## 6. Capabilities, contract & conformance

- **Full capabilities.** A DB broker owns its schema, so it declares every domain
  (`issues, scheduling, resources, financials, portfolio, baseline, blockers,
  history, raid`, + future `crm/service`) and surfaces the whole field registry
  via `fieldMap()`. The blank-canvas user sees the complete, best-in-class field
  set.
- **No contract change.** `DbBroker` implements the *existing* `Broker`
  interface; the published contract (v1) is unchanged. It is added to the
  conformance matrix: **DemoBroker = reference, n8n = real-world, DbBroker = owned
  store** — all three pass the same suite.
- **Time-travel/history.** Optional. A DB broker *could* serve real history from
  an append-only audit/events table (a genuine upgrade over derived history), but
  that's a later increment, still gated by the `history` capability + the existing
  egress opt-in.

---

## 7. Scale, replicas & data-at-rest (the honest trade-offs)

| Concern | SQLite | Postgres | MongoDB |
| --- | --- | --- | --- |
| Best for | solo / small team / evaluation | teams, multi-replica | document-heavy / schemaless preference |
| Replicas | single node (or Litestream/LiteFS for backup) | shared DB → app stays stateless, multi-replica safe | shared DB → multi-replica safe |
| Ops weight | near-zero (a file) | moderate (managed PG) | moderate (managed Mongo) |

Key point: **the app stays stateless even in DB mode** — the database is a
*shared* store, exactly as n8n is a shared broker today. Horizontal scaling of the
gateway is unaffected for Postgres/Mongo; SQLite is the single-node convenience
option.

**Data-at-rest is the real cost.** The moment OmniProject stores the truth, the
operator inherits backup, retention, and encryption-at-rest duties, and the
"smaller compliance blast radius" claim becomes *mode-specific*. This must be said
plainly in the DB-mode docs. RBAC/OIDC actor enforcement at the gateway is
unchanged (writes still happen "as" the real user).

---

## 8. On-ramp / migration story (a feature, not a trap)

DB mode is a great **on-ramp**: start on the built-in database with zero external
systems, get the full UI and field set immediately; later, when a real system of
record arrives (Jira, SAP, …), **swap the broker** and keep the same UI. To make
that exit credible, ship a **broker-agnostic export** (projects/issues/members as
JSON/CSV via the existing export surface) so data is never trapped. The seam means
"migrate off us" is a config change, not a rebuild — which is itself a selling
point and keeps us honest about lock-in.

---

## 9. Rollout (phased, each behind the rule)

- **Phase 1 — SQLite MVP.** Prove the `Store` port + `DbBroker` against the
  conformance suite; JSON-blob schema; `OMNI_BROKER=sqlite`. Smallest surface,
  validates the whole approach. (S–M)
- **Phase 2 — Postgres.** `SqlStore` dialect split; multi-replica deploy profile;
  migration runner for the core columns; opt-in CI service. (M)
- **Phase 3 — MongoDB.** Document adapter; same conformance pass. (M)
- **Phase 4 (optional) — sourced history** from an events table. (M–L)

Each phase keeps §5 intact: optional deps, lazy load, default unchanged, guard +
CI green with no DB.

---

## 10. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Positioning dilution ("so it *does* store data") | DB is an opt-in *mode*, never the default; docs lead with stateless overlay; §5 keeps it structurally optional. |
| Data-at-rest compliance burden | Documented honestly as mode-specific; export tool for exit; encryption/backup as operator duties. |
| Native driver friction (better-sqlite3 build) | `optionalDependencies` + lazy import → never blocks core install/CI. |
| Migration debt as the registry grows | JSON/JSONB blob schema → new fields need no DDL; promote to columns only on demand. |
| Multi-replica races | DB-enforced CAS on `version` (the contract's optimistic-concurrency model) + transactions. |
| "DB becomes required" creep | The six guards in §5, enforced in CI. |

---

## 11. Decision asks

1. Confirm the **JSON-blob + core-columns** schema (vs full normalised schema).
   Recommended: blob — matches the "any field" registry, minimises migrations.
2. Confirm **`optionalDependencies` + lazy import** as the packaging mechanism for
   the rule (vs a separate installable plugin package). Recommended: optional deps
   for Phase 1; consider a plugin package if the driver set grows.
3. Confirm **phase order** (SQLite → Postgres → Mongo).

No code until these are settled. The seam means the eventual build is a contained
adapter, not a rewrite — and the rule in §0 stays unbreakable by construction.
