# Optional stateful self-host database backend (design)

> **Prefer connecting your existing tool.** OmniProject is a *stateless overlay* — its whole value
> is that your real PM tool (Jira, OpenProject, Plane, a spreadsheet, …) stays the single source of
> truth and nothing migrates. **This mode is only for those who have NO existing tool** and want a
> complete, self-contained, self-hosted system. It is the **non-preferred** deployment; everything
> below is opt-in and profile-gated.

Status: **design (not yet implemented).** This doc is for sign-off before any implementation PRs.

## 1. Principle — the database is a *backend below the broker seam*, not state in the gateway

The gateway stays **stateless / zero-at-rest**. We do **not** add a database to OmniProject. Instead
we ship an **optional backend that the broker routes to** — exactly like Jira or OpenProject, except
this one is a Postgres database we provide for people with nothing to connect. The gateway holds
nothing; the data lives in the customer's Postgres, on the customer's infrastructure.

```
SPA ──▶ Gateway (stateless) ──▶ broker seam ──▶ broker workflow ──▶ Postgres (customer-owned)
        zero-at-rest             HTTP contract     SQL backend         OpenProject-compatible schema
```

This means **no new gateway code paths** and no change to the stateless guarantee: it reuses the
existing **admin-gated SQL backend** descriptor (`lib/backend-catalogue/vendors/backends/sql.json`)
and the broker's uniform HTTP contract. The broker workflow (n8n or the reference sidecar) executes
parameterised SQL against Postgres and returns the canonical envelopes the gateway already speaks.

## 2. OpenProject-compatible schema — portability, not lock-in

The schema mirrors **OpenProject's core tables**, so a customer is never trapped: a `pg_dump` from
this database can be loaded into a real OpenProject instance, and conversely OmniProject can later be
pointed at a real OpenProject. The schema is **derived from the canonical contract / `FIELD_REGISTRY`**
mapped onto OpenProject's tables:

| Canonical (broker contract) | OpenProject table.column | Notes |
| --- | --- | --- |
| `Project.id` / `Project.name` | `projects.id` / `projects.name` (+ `identifier` slug) | |
| `Issue.id` | `work_packages.id` | the work item |
| `Issue.projectId` | `work_packages.project_id` | |
| `Issue.title` | `work_packages.subject` | |
| `Issue.description` | `work_packages.description` | |
| `Issue.status` | `statuses.name` via `work_packages.status_id` | seed a default status set |
| `Issue.version` (concurrency token) | `work_packages.lock_version` | **direct match** — OpenProject uses optimistic locking too |
| `Issue.priority` | `enumerations` (type `IssuePriority`) via `priority_id` | |
| `Issue.assignee` | `users` via `assigned_to_id` (`login`/`mail`) | |
| `Issue.startDate` / `dueDate` | `work_packages.start_date` / `due_date` | |
| `Issue.estimateHours` | `work_packages.estimated_hours` | |
| `Issue.loggedHours` | `Σ time_entries.hours` | derived |
| `Issue.type` | `types` via `type_id` | Task / Milestone / Bug / Feature seed |
| `Issue.labels` | `custom_values` (a "Labels" custom field) | OpenProject core has no tag column |
| Story points, RAID, risk/quality, EVM, billing-rate, etc. | `custom_fields` + `custom_values` | the capability-gated field groups land as custom fields |
| `ProjectMember` | `members` + `member_roles` + `roles` | |
| History / journals | `journals` (+ `*_journals`) | optional v2 |

**Core v1 scope:** projects, work_packages (subject/description/status/type/priority/assignee/dates/
estimate/lock_version), statuses, types, priorities (enumerations), users, members/roles, and the
capability-gated extras as custom fields. **Out of scope for v1:** attachments, full journals/history
fidelity, relations/dependencies, OpenProject's permission model, the OpenProject web UI itself.

## 3. What ships (implementation plan — for the follow-up PRs)

1. **Schema DDL** (`infra/self-host-db/schema.sql`) — the OpenProject-compatible tables above, with
   seed rows (default statuses/types/priorities). Pinned to a documented OpenProject major version.
2. **Broker workflow / sidecar** — reuse the SQL backend (`vendors/backends/sql.json`): an n8n
   workflow (or the existing reference sidecar extended) that maps each canonical action
   (`listProjects`, `listIssues`, `createIssue`, `updateIssue` with `lock_version` check, `baseline`,
   `portfolioHealth`, …) to parameterised SQL. **No raw SQL from user input** — the gateway's egress
   guards already strip control/URL-structural chars; the workflow uses bound parameters only.
3. **`docker-compose.self-host-db.yml`** — `postgres` + the broker workflow + `omni-shell`, wired so
   `BROKER_URL`/`BROKER_ENDPOINTS` point at the workflow and the workflow at Postgres. Profile-gated:
   intended with `DEPLOYMENT_PROFILE=self-hosted`.
4. **Migration / portability notes** — `pg_dump` → load into a real OpenProject (version-matched);
   and the reverse (point OmniProject's broker at an existing OpenProject via its API — the preferred
   path once they have one).

## 4. docker-compose shape (sketch)

```yaml
services:
  db:        # CUSTOMER-OWNED data. They back it up, secure it, patch it, run HA.
    image: postgres:16
    volumes: [ "omni-db:/var/lib/postgresql/data" ]
    environment: { POSTGRES_DB: omniproject, POSTGRES_PASSWORD: "${DB_PASSWORD:?set me}" }
  broker:    # the SQL backend workflow (n8n / sidecar) — speaks the broker HTTP contract
    image: omniproject-sql-broker:latest
    environment: { DATABASE_URL: "postgres://postgres:${DB_PASSWORD}@db:5432/omniproject" }
  omni-shell:
    image: omniproject-shell:latest
    environment:
      DEPLOYMENT_PROFILE: self-hosted
      BROKER_URL: "http://broker:8080/omniproject"
      SESSION_SECRET: "${SESSION_SECRET:?openssl rand -hex 32}"
volumes: { omni-db: {} }
```

## 5. Responsibility boundary (hard)

This is **customer-owned infrastructure**. OmniProject ships the schema, the broker workflow, the
compose file and these docs. **The customer owns and is solely responsible for**: database
governance, **backups**, **security** (network, credentials, encryption-at-rest of the volume),
**high availability / DR**, and **updates/patching** of Postgres and the broker workflow. OmniProject
does not operate, back up, or warrant this database. (This is the same posture as the logging-sync
egress: a deliberate, documented step outside the stateless default, at the operator's risk.)

## 6. Honest scope & limits

- **Non-preferred by design.** Running our DB dilutes the overlay value (no migration, your tools as
  source of truth). Keep it secondary; the wizard should steer first-time users to connect an
  existing tool.
- **Schema drift.** OpenProject's schema changes across releases; we target a **pinned major version**
  and state it. Full bidirectional fidelity (journals, attachments, relations, permissions) is **not**
  guaranteed — core work-items + projects + the canonical fields are.
- **Not an ERP.** This is a PM/work-item store, not accounting; financial *fields* are captured as
  custom values, not a general ledger.
- **Statelessness preserved.** The gateway still holds nothing; turning this on does not change the
  gateway's zero-at-rest guarantee — it only gives the broker a database to talk to.

## 7. Decision needed before implementation

1. **Pinned OpenProject version** to target the schema against (e.g. 14.x).
2. **Broker workflow form**: an n8n workflow (consistent with the reference broker) vs a small bundled
   sidecar service. (Recommendation: n8n workflow first — reuses the existing SQL backend + broker
   contract with no new long-running service.)
3. **v1 field scope**: confirm the core set above is enough, or pull specific custom-field groups
   (EVM, RAID) into v1.
