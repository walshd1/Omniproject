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
If `SQL_SIDECAR_URL` is unset it falls back to a **non-persistent** in-memory store with a loud
warning (never a silent "persist into nowhere"). Live verification against a real PostgreSQL sidecar
is still yours to do — the contract is exercised in CI against a mock sidecar.

## Bulk loading from a sheet first?

If the legacy system can export a spreadsheet, you can also use the Excel/CSV
**import** path (`docs/ops/IMPORT.md`) — the same column/field mapper — to load
rows once, rather than standing up a live sidecar.
