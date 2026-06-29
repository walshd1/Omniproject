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
        zero-at-rest             HTTP contract     SQL backend         superset-native schema
                                                                       (+ OpenProject export view)
```

This means **no new gateway code paths** and no change to the stateless guarantee: it reuses the
existing **admin-gated SQL backend** descriptor (`lib/backend-catalogue/vendors/backends/sql.json`)
and the broker's uniform HTTP contract. The broker workflow (n8n or the reference sidecar) executes
parameterised SQL against Postgres and returns the canonical envelopes the gateway already speaks.
The database also reports its real shape back to the gateway via the broker's **`describeSchema`**
manifest (see `lib/availability`), so OmniProject surfaces only the tables/fields that actually
exist and are **populated** — superset ∩ manifest.

## 2. Superset-native schema (generated) — with an OpenProject-compatible export view

The schema is **superset-native**: it is **generated from the canonical contract + `FIELD_REGISTRY`**,
so **every canonical field is a first-class column** on its owning entity's table — nothing is
shoe-horned into a generic key/value `custom_values` table. Because the registry is the *union* of
every backend's fields (CI-enforced; see [FIELD-CATALOGUE.md](FIELD-CATALOGUE.md)), this schema can
hold anything OmniProject understands, and it **grows additively** as the superset grows (a new
field → a new column via an additive `ALTER TABLE … ADD COLUMN`).

**Generation rules** (the DDL generator, deferred — see §3):

- **Tables = canonical entities.** Each entity (`project`, the work item `issue`, `programme`,
  `member`, and the CRM/service entities `account`/`contact`/`pipeline`/`service` when in scope)
  becomes a table. A field's owning table comes from its **`entity`** tag (default `issue`).
- **Columns = fields, by type.** Each `FieldDescriptor` becomes a column whose SQL type follows the
  canonical `type`: `string`→`text`, `text`→`text`, `number`→`numeric`, `date`→`date`,
  `boolean`→`boolean`, `currency`→`numeric`, `percent`→`numeric`, `duration`→`interval`,
  `enum`→`text` (+ a seeded lookup), `labels`→`text[]`.
- **Foreign keys = `reference`/`user` fields.** A `reference`-typed field becomes an FK to the table
  named by its `references` entity; a `user`-typed field becomes an FK to `users`.
- **Edge tables = the self-referential link fields.** `parentTask` is a self-FK on `issue`;
  `dependsOn`/`blocks`/`relatesTo`/`duplicateOf` become a single `issue_links(from_id, to_id, kind)`
  junction table (many-to-many).
- **Concurrency.** The work item carries a `lock_version integer` column — the hard
  optimistic-concurrency token the broker write checks (the canonical `Issue.version`).

**OpenProject portability is a projection, not the schema.** OpenProject's fields are, by
definition, a **subset** of the superset, so an **OpenProject-compatible export view** (or a
`pg_dump` transform) maps the superset-native tables onto OpenProject's
`projects` / `work_packages` (`subject`, `description`, `status_id`, `type_id`, `priority_id`,
`assigned_to_id`, `start_date`/`due_date`, `estimated_hours`, **`lock_version`** — a direct match) /
`statuses` / `types` / `enumerations` / `users` / `members`. Fields OpenProject lacks natively (story
points, RAID, EVM, billing rate, …) project into its `custom_fields`/`custom_values`. So a customer
is never trapped — they can move to a real OpenProject — but our own store keeps every field
first-class rather than as opaque custom values.

**Core v1 scope:** `project`, `issue` (the canonical core + scheduling/effort/agile columns +
`lock_version`), `programme`, `users`, `members`, the `issue_links` edge table, and seeded
status/type/priority lookups. The capability-gated extras (financial, quality, CRM, service, strategy
groups) are **first-class columns gated on at provision time** per the v1 field scope (a §7 decision).
**Out of scope for v1:** attachments, full history/journal fidelity, OpenProject's permission model,
the OpenProject web UI itself.

## 3. What ships (implementation plan — for the follow-up PRs, after sign-off)

1. **Schema-DDL generator** (`scripts/src/gen-self-host-db.ts`, **deferred**) — emits
   `infra/self-host-db/schema.sql` **from `fields.json` + the contract** using the §2 generation
   rules (tables=entities, columns=fields-by-type, FKs=reference/user, the `issue_links` edge table),
   with seed rows (default statuses/types/priorities). Re-running it after the superset grows emits an
   **additive migration** (`ALTER TABLE … ADD COLUMN`). Pinned to a documented OpenProject major
   version for the export view. *(Not built yet — see the note below.)*
2. **OpenProject export view** — a SQL view (or `pg_dump` transform) projecting the superset-native
   tables onto OpenProject's `projects`/`work_packages`/… for portability (§2).
3. **Broker workflow / sidecar** — reuse the SQL backend (`vendors/backends/sql.json`): an n8n
   workflow (or the existing reference sidecar extended) that maps each canonical action
   (`listProjects`, `listIssues`, `createIssue`, `updateIssue` with `lock_version` check, `baseline`,
   `portfolioHealth`, **`describeSchema`** → the availability manifest, …) to parameterised SQL.
   **No raw SQL from user input** — the gateway's egress guards already strip control/URL-structural
   chars; the workflow uses bound parameters only.
4. **`docker-compose.self-host-db.yml`** — `postgres` + the broker workflow + `omni-shell`, wired so
   `BROKER_URL`/`BROKER_ENDPOINTS` point at the workflow and the workflow at Postgres. Profile-gated:
   intended with `DEPLOYMENT_PROFILE=self-hosted`.

> **Build status:** this is a **design + README** document. The DDL generator and the broker workflow
> are **deferred until the §7 decisions are signed off** — provisioning a customer database is the
> gated step. The pieces this design depends on already exist and are shipped: the **`entity`** tag on
> fields, the CI-enforced **field superset**, and the broker **`describeSchema`** manifest +
> availability resolver.

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
- **Schema drift is contained to the export view.** Our own schema is superset-native and ours, so it
  never "drifts" — it only grows additively with the superset. Drift risk lives only in the
  **OpenProject export view**, which targets a **pinned major version**. Full bidirectional fidelity
  of OpenProject's extras (journals, attachments, relations, permissions) is **not** guaranteed — the
  canonical entities, fields and links are.
- **Not an ERP.** This is a PM/work-item store, not accounting; financial *fields* are first-class
  columns (gated on at provision), but it is not a general ledger.
- **Statelessness preserved.** The gateway still holds nothing; turning this on does not change the
  gateway's zero-at-rest guarantee — it only gives the broker a database to talk to.

## 7. Decision needed before implementation

1. **Pinned OpenProject version** to target the schema against (e.g. 14.x).
2. **Broker workflow form**: an n8n workflow (consistent with the reference broker) vs a small bundled
   sidecar service. (Recommendation: n8n workflow first — reuses the existing SQL backend + broker
   contract with no new long-running service.)
3. **v1 field scope**: confirm the core set above is enough, or pull specific custom-field groups
   (EVM, RAID) into v1.
