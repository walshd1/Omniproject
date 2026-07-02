# Oracle Fusion Cloud ERP (Project Financial Management) — connector status

Backlog #139. A catalogued, capability-declared backend for Oracle Fusion Cloud
ERP's **Project Financial Management** module: `lib/backend-catalogue/vendors/backends/oracle-fusion-erp.json`.

## Status: CATALOGUED, NOT LIVE-VERIFIED

This connector has been designed against Oracle's **published REST API documentation**
for Project Financial Management (the `fscmRestApi/resources/11.13.18.05/*` resources
cited below), the same reference-mapping discipline every other ERP backend in this
catalogue uses (SAP S/4HANA, Oracle NetSuite, Oracle Primavera P6, Microsoft Dynamics
365). It has **not** been exercised against a live Oracle Fusion tenant — no Fusion
pod was available in this environment. Treat every path, field name and auth
assumption below as a **reference starting point**, not a certified integration.

**Before calling this "supported" rather than "catalogued," a maintainer with access
to a real Fusion tenant must:**

1. Confirm the resource paths resolve on their pod's API version (Oracle revs
   `fscmRestApi` roughly quarterly; `11.13.18.05` is the version this mapping was
   designed against — an older/newer pod may expose a different version segment).
2. Confirm the field names on `projectCosts` / `projectBudgets` / `projectBudgetSummary`
   / `projectCommitments` match what their ledger's flexfield configuration actually
   returns (Oracle Fusion is heavily descriptive-flexfield-customisable per tenant —
   `costCenter` in particular is a GL segment/flexfield that varies by chart of
   accounts).
3. Confirm which auth mode their tenant enforces (Basic vs. OAuth2/IAM — see below)
   and swap the n8n credential accordingly.
4. Run `pnpm --filter @workspace/scripts run verify-broker` (or the generated
   workflow's own `{ verify: true }` probe) against a real deployed workflow before
   flipping any customer over from "catalogued" to "supported" in customer-facing
   docs.

## What is genuinely mapped (capability-honest)

Only two capability domains are declared `true`, matching what the real API can
actually populate for this module:

| Domain | Declared | Backing resource |
| --- | --- | --- |
| `financials` | **true** | `projectCosts` (actual/raw/burdened cost), `projectBudgets` + `projectBudgetSummary` (budget), `projectCommitments` (PO/requisition/supplier-invoice commitments) |
| `issues` | **true** | `projectPlans/{projectId}/child/tasks` (WBS/schedule tasks) — the generic "work item" proxy every catalogued backend maps to, required by the broker contract's `list_issues` action |
| `scheduling`, `resources`, `baseline`, `portfolio`, `raid`, `blockers`, `history` | **false** | Not mapped in this slice. Oracle Fusion's Project *Management* module (as opposed to the narrower Financial Management scope of this connector) does expose scheduling/resource/baseline data via other resources — a follow-up connector variant could turn these on, but this slice stays scoped to financial context per backlog #139. |

**Financial data is read-only structurally, not just by convention**: the
OmniProject broker contract (`ContractAction` in `lib/backend-catalogue/src/backend-manifest.ts`)
has no write action for cost/budget/commitment data on *any* catalogued backend.
The `create_issue`/`update_issue`/`delete_issue` actions this connector implements
write only to the WBS task proxy (`projectPlans/.../child/tasks`), mirroring exactly
how SAP writes `A_EnterpriseProjectElement`, NetSuite writes `projectTask`, and
Primavera writes `activity` — none of those write financial ledger entities either.

## Real Oracle Fusion REST resources cited

All under `https://<pod>.fa.<region>.oraclecloud.com/fscmRestApi/resources/11.13.18.05/`:

- `projects` — GET, list projects.
- `projectPlans/{ProjectId}/child/tasks` — GET/POST/PATCH/DELETE, WBS/schedule tasks.
- `projectCosts` — GET, actual cost transactions (`rawCost`, `burdenedCost`, `quantity`).
- `projectBudgets` / `projectBudgetSummary` — GET (+POST/PATCH/DELETE for budget
  versions, not used here), budget amounts.
- `projectCommitments` — GET, PO/requisition/supplier-invoice committed cost.

Source: Oracle's published REST API docs for Fusion Cloud Project Management
(`docs.oracle.com/en/cloud/saas/project-management/*/fapap/`), spot-checked across
several quarterly doc revisions (20b–26b) during this pass — the resource *names*
have been stable across that range; the version segment in the URL path changes.

## Canonical field mapping (reuses the existing registry — nothing duplicated)

| Canonical field (`assets/fields.json`) | Oracle Fusion source |
| --- | --- |
| `budget` | `projectBudgets` / `projectBudgetSummary` (budget version amount) |
| `plannedCost` | `projectBudgets` planning amount |
| `actualCost` | `projectCosts.rawCost` / `burdenedCost` |
| `currency` | `projectCosts` currency code / `projects` project currency |
| `costCenter` | `projectCosts` expenditure organisation / GL cost-centre segment (tenant-specific — verify against your chart of accounts) |
| `committedCost` | `projectCommitments` total committed cost |
| `purchaseOrder` | `projectCommitments` document number |
| `wbsCode` | `projectPlans` task number |

No new canonical fields were added — every mapped field already existed in the
registry (contributed by SAP/NetSuite/Primavera/D365 previously), declared via the
vendor JSON's `fieldKeys[]` and enforced as a subset by the `guard-superset` CI check.

## Auth: Basic by default, OAuth2 as the documented alternative

Oracle Fusion Cloud REST APIs sit behind a global Oracle Web Services Manager (OWSM)
security policy that accepts **HTTP Basic authentication** (Fusion user name/password)
over TLS out of the box — this is the default this connector scaffolds
(`credentialType: "httpBasicAuth"`, matching the same pattern Primavera P6 uses in
this catalogue). Basic auth **does not work** if multi-factor authentication is
enforced on the integration user. Tenants with MFA or an OCI IAM identity domain in
front of Fusion should instead configure **OAuth2 client-credentials** against Oracle
IAM (a confidential application in the IAM identity domain linked to the Fusion
instance) and swap the n8n credential type accordingly — this is a config change in
the generated n8n workflow, not a change to this connector's manifest.

## Why this is scoped narrowly

Backlog #139 asks for a **read-only ERP financial connector**, and OmniProject is
explicitly a project/programme overlay, not an ERP replacement. This connector reads
project financial *context* (budget, actual cost, commitments) from a real Oracle
Fusion tenant the same way OmniProject reads issues from Jira — it does not attempt
to manage Fusion's GL, AP, procurement, or any accounting workflow, and it declares
no capability the cited REST resources don't genuinely back.
