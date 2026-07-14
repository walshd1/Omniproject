# Database backends — raw SQL & MongoDB (admin-only)

For internally-hosted or legacy systems that have **no API** — just a database —
OmniProject can broker directly against a relational store (PostgreSQL, MySQL,
SQL Server) or MongoDB. These are **admin-only** backends: raw datastore access is
technical configuration, so only an admin can wire them, and they are hidden from
the wizard for everyone else.

## How it stays safe

The gateway is stateless and never holds your database credentials, and — this is
the important part — **it never sends raw SQL (or a raw Mongo query) over the wire.**

Instead you run a small **sidecar** next to your database. The gateway POSTs a
*contract action* plus typed parameters:

```
POST $SQL_SIDECAR_URL/create_issue
Authorization: Bearer $SQL_SIDECAR_TOKEN
{ "title": "...", "assignee": "...", "projectId": "..." }
```

and the sidecar maps that action to a **parameterised statement you define for your
schema**, binding the values (never string-concatenating them). So:

- There is no SQL/query string on the wire for anyone to inject into.
- The database credentials live only in the sidecar, not the gateway.
- Your database's own grants still apply — the sidecar connects as a role you choose.
- The seam is the same contract every other backend implements, so the rest of
  OmniProject (capabilities, the business ruleset, reports) works unchanged.

This mirrors the reference HTTP-sidecar broker (see `docs/BROKER-HTTP-BINDING.md`)
— a database backend is just a sidecar whose binding talks SQL/Mongo instead of a
third-party REST API.

## Wiring it

1. Deploy the reference sidecar beside your DB and configure, per contract action
   (`list_projects`, `list_issues`, `create_issue`, `update_issue`, `delete_issue`),
   the parameterised query/operation and the column→canonical-field mapping for
   your schema.
2. Set the env the catalogue asks for:
   - SQL: `SQL_SIDECAR_URL`, `SQL_SIDECAR_TOKEN`
   - Mongo: `MONGO_SIDECAR_URL`, `MONGO_SIDECAR_TOKEN`
3. As an **admin**, select the `sql` / `mongodb` backend and point the broker at it.

The per-action query and field mapping are **reference** — confirm them against
your real schema/collection before going live. Capabilities (scheduling,
financials, …) light up only for the fields your mapping actually populates.

## No n8n? Point the built-in broker straight at the sidecar

The wiring above forwards through the broker (n8n). A small org with **no n8n** can instead use the
**built-in broker** to talk to the same sidecar directly — the gateway still holds no DB
credentials (the sidecar does), so the stateless posture is unchanged:

```
BUILTIN_BROKER=sql          # (aliases: sidecar | postgres | mysql | mssql)
SQL_SIDECAR_URL=https://sidecar.internal:8443
SQL_SIDECAR_TOKEN=…         # optional bearer
```

The built-in broker (`broker/builtin/SidecarStore`) POSTs one action per operation to
`$SQL_SIDECAR_URL/<action>` with `{ "payload": { … } }`, unwrapping a `{ success, data }` reply and
honouring **409** (optimistic-concurrency conflict, with the current `version`) and **404**
(not found). Beyond the five actions above it also calls `get_project`, `create_project`,
`update_project`, `get_issue`, `list_raid`, and `add_raid`, plus the GTD-task actions
`list_tasks`, `get_task`, `create_task`, and `update_task`, so implement those in your sidecar too.

**Self-managed archive** (`ARCHIVE_STORE=sidecar`, reusing `SQL_SIDECAR_URL`): when a project is
closed with the `archive` disposition, OmniProject captures a snapshot (the project row, its issues,
its GTD tasks, and OmniProject's own project settings — programme memberships, relink aliases,
closed/retired status)
and POSTs `archive_save`; reports retrieve it later via `archive_get` (`{ guid }` → snapshot, 404 if
absent) and `archive_list` (→ `[{ guid, archivedAt }]`). Implement those three to hold closed-project
data outside the SOR. Unset ⇒ a non-persistent in-memory archive (with a warning).
If `SQL_SIDECAR_URL` is unset it falls back to a **non-persistent** in-memory store with a loud
warning (never a silent "persist into nowhere"). Live verification against a real PostgreSQL sidecar
is still yours to do — the contract is exercised in CI against a mock sidecar.

## Scaling the sidecar at massive scale (10k projects / 1000 users)

The gateway is a stateless overlay — it holds no DB and never over-fetches (portfolio reads are
bounded/paged, exports stream, and repeated reads coalesce fleet-wide via the optional shared cache).
So the scale tuning lives in **your sidecar**, over the same wire contract. The recipe:

- **Connection pooling.** Put **pgbouncer (transaction mode)** in front of Postgres and size the
  sidecar's own pool to `max_connections / replicas`. This is the single biggest lockout-avoider under
  1000 concurrent users.
- **Backpressure — 429 + `Retry-After`.** When the pool/queue saturates, reply **429** with a
  `Retry-After` header. The gateway honours it: `callBroker` backs off (bounded, capped at 3s) and
  re-sends a small fixed number of times, then surfaces a clean `rate_limited` (HTTP 429) — it never
  hammers a struggling sidecar. (The reference sidecar demonstrates this via `SIDECAR_MAX_INFLIGHT`.)
- **Indexes on the hot keys** the gateway filters/sorts by: `project_id`, `programme_id`, `status`,
  `updated_at`, `assignee` — plus composites for common pairs (`(project_id, status)`,
  `(programme_id, updated_at)`). The `updated_at` index is what makes the change-token cursor cheap.
- **Keyset (cursor) pagination**, not `OFFSET`:
  `WHERE updated_at < $cursor ORDER BY updated_at DESC LIMIT $n`. Return the last row's `updated_at`
  as the next cursor. (The neutral `list_issues` contract returns a full project's issues today;
  bounding it with an optional `{ limit, after }` cursor is the one forward-compatible contract
  addition on the roadmap — until then, page inside the sidecar and keep result sets sane.)
- **Read replicas.** Route reads to replicas, writes to the primary; the gateway's read-through + the
  optional shared cache already cut read load.
- **Partitioning.** Range-partition the big table (`issues`) by `updated_at` (or hash by programme) so
  queries and vacuum stay fast at tens of millions of rows.
- **Materialised rollups.** Back `get_portfolio_health` / `project_financials` with incrementally
  refreshed materialised views/summary tables, so the portfolio aggregates become one indexed query
  instead of a per-project scan.
- **Hygiene.** Prepared statements, autovacuum tuning for the high-write tables, and a
  `statement_timeout` so a runaway query can't pin a connection.

None of this changes the gateway or the wire contract — a scaled sidecar still "drops in" (point
`BROKER_URL`/`SQL_SIDECAR_URL` at it) and passes the same conformance suite.

## Bulk loading from a sheet first?

If the legacy system can export a spreadsheet, you can also use the Excel/CSV
**import** path (`docs/ops/IMPORT.md`) — the same column/field mapper — to load
rows once, rather than standing up a live sidecar.
