# Design: OmniStore — a first-party, stateful system-of-record sidecar

**Status:** design / proposal · **Author:** (AI-assisted) · **Audience:** maintainers + implementers

## 1. Goal & positioning

Today OmniProject is a **stateless overlay**: it brokers over an external system of record (Jira,
OpenProject, a SQL sidecar) and holds no work-item data itself. This design adds **OmniStore** — a
first-party, **Postgres-backed, stateful sidecar that _is_ a full work-tracking system of record**.
Paired with the OmniProject overlay it becomes a complete, self-hostable product that can **replace
Jira/Linear/OpenProject** rather than sit on top of one — while the gateway stays exactly as it is:
stateless, DB-credential-free, and unaware that this backend is "first-party."

The design constraint that makes this clean: **OmniStore wires in like any other backend.** It
implements the existing broker HTTP sidecar contract — nothing in the gateway core changes, and it
must pass the existing `http-conformance.test.ts` acceptance suite. Everything Jira-class beyond
today's contract is added as **additive, capability-gated actions** (backward compatible: a backend
that doesn't advertise the capability is never called for it).

Why this is competitive: self-hosted + **data-sovereign** (your Postgres, not a vendor cloud),
MIT-licensed (vs. per-seat SaaS), and you get the **portfolio/PMO layer for free** on top of the
execution tracker. Honest non-goals below (§13).

### Optional — never required

OmniStore is an **opt-in convenience, not a dependency**. OmniProject's whole reason for being is the
stateless overlay: brokering over the system of record you *already* run (Jira, OpenProject, a custom
SQL sidecar) with zero data at rest. That stays **first-class and the default**. OmniStore is simply
the answer to "we don't have a backend / we want one from you" — a **one-stop-shop** option you can
turn on, run yourself, and turn off (or migrate off) at will. It advertises capabilities through the
same `get_capabilities` seam as any other backend, so choosing it is a config decision, not a lock-in.
Crucially, an org can run **both at once** and cut over per project (§11) — so adopting OmniStore is
never a one-way door.

## 2. How it wires in (the contract — unchanged)

OmniStore is an HTTP service that speaks the broker sidecar protocol (see
`broker/reference-sidecar.ts`, `docs/ops/DATABASE-BACKENDS.md`, `docs/BROKER-HTTP-BINDING.md`):

- **Transport:** `POST` per action; the action name in `X-OmniProject-Action`; body
  `{ payload: {…}, userContext?, origin, idempotencyKey }`.
- **PSK (optional):** when `BROKER_PSK` is set the request body is a sealed `{ v, enc }` envelope;
  OmniStore decrypts with the vendored opener and **encrypts its reply the same way**.
- **Response signing:** HMAC-sign the reply (`X-Omni-Resp-Sig` / `X-Omni-Resp-Ts`) so the gateway can
  verify it came from a key-holder (reuse `signBrokerResponse`).
- **Error taxonomy:** `404` not-found, `409` conflict (return the current row for optimistic
  concurrency), `401/403` unauthorized, **`429` + `Retry-After` for backpressure** (the gateway now
  backs off on this — see the backpressure work), `5xx` unavailable.
- **Idempotency:** honour the `idempotencyKey` header (dedupe retried writes).
- **Drop-in:** `BROKER_URL=https://omnistore.internal` (or `BUILTIN_BROKER=sql` +
  `SQL_SIDECAR_URL`). Advertise capabilities via `get_capabilities`; the gateway lights up only what
  you return `true` for.

**Existing wire actions OmniStore must serve** (the current contract):
`list_projects`, `get_project`†, `create_project`, `update_project`, `list_issues`, `get_issue`,
`create_issue`, `update_issue`, `delete_issue`, `list_project_members`, `project_summary`,
`get_project_history`, `get_baseline`, `get_raid`, `create_raid_entry`, `get_portfolio_health`,
`get_resource_capacity`, `get_project_financials`, `get_notifications`, `get_capabilities`,
`get_fx_rates`, `list_activity`, `list_task_items`, `create_task_item`, and the GTD-task actions
`list_tasks`/`get_task`/`create_task`/`update_task`, plus archive `archive_save`/`archive_get`/
`archive_list`. († some are optional; serve what you advertise.)

## 3. The Jira gap — and how each piece maps

| Jira-class capability | Mapping strategy |
|---|---|
| Issues + CRUD, optimistic concurrency | **Exists** — `list_issues`/`get_issue`/`create_issue`/`update_issue`/`delete_issue` + `version` |
| Comments & discussion | **Additive action** — `add_comment` / `list_comments` (cap: `comments`) |
| Attachments | **Additive** — `add_attachment` / `list_attachments`, blob in object store, row is metadata (cap: `attachments`) |
| Issue links / dependencies (blocks, relates, duplicates) | **Additive** — `add_issue_link` / `list_issue_links` (cap: `links`) |
| Workflows / status transitions | **Additive** — `transition_issue` + workflow defs; enforced in-store (cap: `workflow`) |
| Custom fields | **Additive** — field defs + typed values; **already** surfaced via the field-registry/`describe_fields` seam (cap: `custom_fields`) |
| Boards & sprints (Scrum/Kanban) | **Additive** — `list_sprints` / `board_state` / `update_sprint` (cap: `agile`) |
| Search / JQL | **Additive** — `search_issues` with a **structured, parameterised filter** (never raw SQL from client) + keyset paging (cap: `search`) |
| Watchers / subscriptions | **Additive** — `watch_issue` / `list_watchers`; drives notifications (cap: `watchers`) |
| Activity / history / audit trail | **Exists** — `get_project_history` / `list_activity` / `replay`, backed by an append-only events table |
| Hierarchy (epics → stories → sub-tasks) | Modelled with `parent_id` + issue `type`; surfaced through existing issue reads |
| Bulk operations | Served by OmniProject's **bulk-action engine** through the contract; the store just needs efficient single-writes |
| Webhooks / realtime | **Additive/internal** — an outbox → webhook so OmniProject SSE + external tools fire on change |
| Notifications | **Exists** — `get_notifications`, fed by the events/outbox |

Everything in "Additive" is **capability-gated**: OmniProject already governs backend capabilities, so
an org running OmniStore gets the full set, while the same gateway talking to Jira just doesn't call
the actions Jira's adapter doesn't advertise.

## 4. Data model (Postgres)

Core tables (abbreviated DDL — every mutable row carries `version int` for optimistic concurrency and
`updated_at timestamptz` for the change-token cursor + keyset paging):

```sql
-- Identity/tenancy: a single deployment is one tenant; scope is enforced by userContext (see §9).
create table projects (
  id            text primary key,
  omni_instance_id text unique,          -- the gateway-minted correlation GUID
  name          text not null,
  identifier    text,
  description    text,
  programme_id   text,
  status        text,                    -- live/closed vocabulary
  version       int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table issues (
  id            bigserial primary key,   -- internal; expose a stable string id
  key           text unique not null,    -- e.g. "REF-1234" (per-project sequence)
  project_id    text not null references projects(id),
  parent_id     bigint references issues(id),   -- epic/story/sub-task hierarchy
  type          text not null default 'task',   -- epic|story|task|bug|subtask
  title         text not null,
  description    text,
  status        text not null,
  priority      text,
  assignee      text,
  reporter      text,
  labels        text[] not null default '{}',
  story_points  numeric,
  start_date    date,
  due_date      date,
  version       int  not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
) partition by range (updated_at);        -- range-partition at scale

create table issue_comments   (id bigserial pk, issue_id bigint, author text, body text, created_at timestamptz);
create table issue_links      (id bigserial pk, from_issue bigint, to_issue bigint, type text);  -- blocks|relates|duplicates
create table issue_attachments(id bigserial pk, issue_id bigint, filename text, size bigint, uri text, added_by text, added_at timestamptz);
create table watchers         (issue_id bigint, watcher text, primary key (issue_id, watcher));

-- Configurable workflow (the thing Jira workflows do): statuses + allowed transitions per scheme.
create table workflow_schemes (id text pk, name text);
create table workflow_statuses(scheme_id text, status text, category text);   -- todo|in_progress|done
create table workflow_transitions(scheme_id text, from_status text, to_status text);
create table project_workflow (project_id text, issue_type text, scheme_id text);

-- Custom fields (typed), surfaced via describe_fields.
create table custom_field_defs (id text pk, project_id text, key text, label text, type text, options jsonb);
create table custom_field_values(issue_id bigint, field_id text, value jsonb, primary key (issue_id, field_id));

-- Append-only event log — powers history, activity, replay, audit, notifications, and the outbox.
create table events (
  id         bigserial primary key,
  ts         timestamptz not null default now(),
  actor      text,
  project_id text,
  issue_id   bigint,
  action     text not null,      -- issue.created, issue.transitioned, comment.added, …
  before     jsonb,
  after      jsonb
);

-- Reliable outbound webhooks / notifications.
create table outbox (id bigserial pk, event_id bigint, delivered bool default false, attempts int default 0);

-- Members/capacity/financials/raid/baselines/tasks(GTD)/fx — one table each, straightforward.
-- Materialised rollups for the portfolio reads (refresh incrementally):
create materialized view portfolio_health as
  select project_id, count(*) total,
         count(*) filter (where status_category = 'done') completed, …
  from issues_with_category group by project_id;
```

**Indexes (the hot keys the gateway filters/sorts by):** `issues(project_id)`, `issues(status)`,
`issues(assignee)`, `issues(updated_at)`, composites `(project_id, status)` and
`(project_id, updated_at)`; `events(project_id, ts)`; unique `issues(key)`. Full-text: a
`tsvector` column + GIN index (and `pg_trgm` for fuzzy) for `search_issues` text queries.

## 5. API surface — action → SQL mapping

- **Reads** compile to a single indexed query. `list_issues` gains an optional `{ limit, after }`
  **keyset cursor** (the additive contract change already on the roadmap): `where project_id = $1 and
  updated_at < $after order by updated_at desc limit $n`, returning the last row's `updated_at` as
  the next cursor. Un-paged callers still get the whole project (bounded by a server cap).
- **`search_issues`** takes a **structured filter** — `{ where: [{field, op, value}], sort, limit,
  after }` — compiled to **parameterised** SQL against an allow-listed column set. Never accept raw
  SQL/JQL strings from the client (injection + DoS). This is the Jira-JQL analogue, kept safe.
- **Writes** run in a transaction: apply the change, **bump `version`**, append an `events` row, and
  enqueue an `outbox` row — atomically. `update_issue` honours `expectedVersion` → `409` with the
  current row. `transition_issue` validates the transition against `workflow_transitions` → `400/409`
  on an illegal move.
- **Idempotency:** an `idempotency_keys(key, response, created_at)` table; a repeated
  `idempotencyKey` returns the stored response instead of re-applying (matches the gateway's
  minute-bucketed key).
- **Portfolio reads** (`get_portfolio_health`, `get_project_financials`) read the **materialised
  rollups** — one query, not a per-project scan. This is what makes 10k projects fast (and pairs with
  the gateway's aggregate-read follow-up).

## 6. Workflow engine

A project+issue-type maps to a workflow scheme (statuses grouped into `todo|in_progress|done`
categories, and an allowed-transitions set). `update_issue`/`transition_issue` reject a status change
that isn't an allowed transition. Category drives `project_summary`/`portfolio_health` "done" counting
so it stays consistent with OmniProject's canonical vocabulary. Schemes are admin-configured (seeded
with a sensible Scrum + Kanban default).

## 7. Search & filtering (safe)

Structured filter contract only. The compiler:
1. validates every `field` against the allow-list (core columns + registered custom fields),
2. maps `op` to a safe operator (`eq|neq|in|contains|gt|lt|between|is_null`),
3. binds every `value` as a parameter,
4. always applies the keyset `limit`/`after` and a hard max page size.
Text search uses the `tsvector`/trigram indexes. Result: JQL-class expressiveness, zero injection
surface, bounded cost.

## 8. Events, history, activity, webhooks

The `events` table is the single source for `get_project_history`, `list_activity`, `replay`, the
audit trail, and notifications. Every write appends one event in the same transaction (no lost/ghost
events). An **outbox worker** (LISTEN/NOTIFY or a short poll) delivers webhooks — this is how
OmniProject's SSE/notification stream and any external integration fire on change, reliably and
exactly-once-ish (dedupe on `event_id`).

## 9. Security

- **PSK envelope** decrypt + **HMAC response signing** (vendored openers/signers — the reference
  sidecar shows exactly how).
- **Row-level scope:** the gateway forwards a **signed `userContext`** (verified identity + data
  scope: user / programme / all). OmniStore enforces it in SQL (`where programme_id = any($scope)` /
  owner checks) — the row-level boundary beneath the gateway's coarse RBAC. A leaked/over-broad token
  still can't pivot the whole portfolio.
- **No secrets to the gateway:** DB credentials live only in OmniStore. TLS everywhere; mTLS optional.
- **Audit:** the `events` log is the tamper-evident record; optionally hash-chain it like the gateway
  audit chain.

## 10. Built to scale OUT (horizontal, every tier)

The whole stack is designed to **scale out, not just up** — add replicas, not just bigger boxes. This
mirrors the gateway, which is already stateless and fleet-scaled (N replicas + Redis shared-state).

**Tier 1 — the OmniStore app is stateless ⇒ N replicas behind a load balancer.**
- No in-process session/state: every request is self-contained (auth rides the PSK/`userContext`
  envelope; idempotency + optimistic `version` live in Postgres, not memory). So you run as many
  OmniStore replicas as you need behind a plain L7 LB / Kubernetes `Deployment` + HPA, and any replica
  can serve any request. Two replicas racing the same write are made safe by `expectedVersion` → `409`
  and the `idempotency_keys` table (dedupe is in the DB, shared across replicas).
- Backpressure is per-replica AND fleet-aware: each replica sheds with `429 + Retry-After` on its own
  pool saturation; the LB spreads load; the gateway backs off. Autoscale on pool-utilisation / p99.

**Tier 2 — the outbox/webhook workers scale as competing consumers.**
- Delivery is a **leased-work queue** on the `outbox` table (`SELECT … FOR UPDATE SKIP LOCKED`), so K
  worker replicas process disjoint batches with no coordination and no double-send (dedupe on
  `event_id`). Add workers to raise delivery throughput linearly.

**Tier 3 — Postgres scales out along a clear ladder (adopt only as far as you need):**
1. **Read replicas** — route reads to replicas, writes to the primary; the gateway's read-through +
   fleet cache already cut read volume. Covers most growth.
2. **Connection scale-out** — **pgbouncer** (transaction mode) fronts the pool so hundreds of app
   replicas multiplex onto a bounded backend connection count (the #1 lockout-avoider at 1000+ users).
3. **Partitioning** — range-partition `issues`/`events` by `updated_at` (or by programme) so no single
   table/index is the ceiling; old partitions detach cheaply.
4. **Horizontal sharding** — when one primary isn't enough, shard by **tenant/programme** (the natural
   boundary — cross-programme queries are already the rare case). Two clean options:
   - **Citus** (distributed Postgres): distribute `issues`/`events` on `programme_id`, reference-table
     the small config tables — same SQL, transparent scale-out.
   - **App-level shard routing**: a shard map (`programme_id → dsn`) resolved from the `userContext`
     scope; the store opens the right pool. Keeps vanilla Postgres.
   Either way the wire contract is unchanged — the gateway never knows.
5. **Aggregates don't fan out** — `get_portfolio_health`/`get_project_financials` read **materialised
   rollups** refreshed incrementally (or per-shard rollups merged), so portfolio reads stay O(1) in
   project count even across shards.

**Design rules that keep scale-out honest** (enforce in the build):
- No cross-shard transaction on the hot path; a write touches one programme's shard.
- No unbounded read — every list is keyset-paged with a hard max page.
- No sticky sessions / no in-memory caches that must be coherent across replicas (use Postgres or the
  shared cache).
- Everything idempotent + version-checked, so retries and concurrent replicas are always safe.

**Prove it:** the `docker-compose.loadtest.yml` profile scaled to **multiple OmniStore replicas + a
Postgres primary/replica (or a 2-node Citus)**, a seed generator at 10k projects / millions of issues /
1000 concurrent users, and published p50/p95/p99 + throughput numbers — the load-proof that turns the
scale-out claim from design into evidence.

## 11. Migration & interop (the on-ramp off Jira)

- **Importer:** a `POST /import/jira` (or reuse OmniProject's CSV/field-mapper import) that ingests a
  Jira export → projects/issues/comments/links/custom fields, preserving keys where possible.
- **Dual-run:** because OmniProject can broker over *multiple* backends, an org can run **Jira and
  OmniStore side by side** during migration and cut over per project — de-risking the switch.

## 12. Deployment & acceptance

- **Package:** a container + Postgres + pgbouncer; a `docker-compose.omnistore.yml` profile and a Helm
  chart value. One-command quickstart.
- **Acceptance gate:** OmniStore **must pass `http-conformance.test.ts`** (structural + read
  conformance over the wire) — the same bar every backend meets. Add an OmniStore-specific suite for
  the additive actions (workflow, search, comments, links, idempotency, scope enforcement, 429).

## 13. What this is NOT (honest non-goals)

- Not a Jira **marketplace/ecosystem** — no third-party app store on day one.
- Not the years of UX refinement/templates Jira has; MVP UX is functional, not polished.
- Not a hosted SaaS with SLAs/support — it's self-hosted software (that's the point, and the trade-off).
- Not "done" the moment it compiles — the competitive claim needs the load-proof (§10) and one real
  migration (§11).

## 14. Build phases

1. **MVP SoR** — projects + issues (CRUD, version, hierarchy) + comments + configurable workflow +
   `search_issues` + events/history + idempotency + PSK/HMAC + scope. Passes conformance. *This alone
   is a usable Jira alternative through the OmniProject UI.*
2. **Agile** — boards, sprints, board_state; velocity/burndown feed the existing reports.
3. **Fields & attachments** — custom fields (typed, via `describe_fields`) + attachments (object store).
4. **Links & watchers & webhooks/outbox** — dependencies, subscriptions, realtime notifications.
5. **Scale-out hardening** — multi-replica stateless app tier + HPA, competing-consumer outbox
   workers, read replicas → pgbouncer → partitioning → (optional) programme-sharding/Citus, materialised
   rollups, and a multi-replica loadtest at 10k/1000 with published p50/p95/p99 + throughput.
6. **Migration tooling** — Jira/CSV importer + dual-run cutover guide.

Each phase is independently shippable and leaves the gateway untouched (additive, capability-gated).
