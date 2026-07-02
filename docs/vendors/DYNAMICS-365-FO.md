# Dynamics 365 Finance & Operations (Project Management and Accounting) — connector notes

Backend id: `dynamics365-fo` (`lib/backend-catalogue/vendors/backends/dynamics365-fo.json`).
Backlog #141 — "ERP connector: Microsoft Dynamics 365 Finance & Operations
read-only broker adapter".

## What this is (and isn't)

This is a **catalogued, capability-declared** backend, exactly like SAP S/4HANA,
Oracle NetSuite, Planview and every other enterprise entry in
`lib/backend-catalogue/vendors/backends/`: a broker-neutral manifest + n8n
binding an operator can select in the setup wizard, generate a starting n8n
workflow from, and then plug their own tenant credentials into. It is **not**
a new system of record — OmniProject stays a stateless overlay; this connector
only *reads* project/financial context from a Dynamics 365 F&O tenant the
operator already runs, the same way the existing Jira/ADO/SAP connectors do.

**Distinct from the sibling `dynamics365` backend.** Microsoft ships two
different products under the "Dynamics 365 project" umbrella and this
repository already covers one of them:

| | `dynamics365` (existing) | `dynamics365-fo` (this connector) |
| --- | --- | --- |
| Product | Project Operations | Finance & Operations — Project Management and Accounting (PMA) module (classic F&O/AX) |
| Data platform | Dataverse | F&O's own OData v4 Web API |
| Entities | `msdyn_project` / `msdyn_projecttask` | `ProjectsV2` / `ProjectTasks` / `ProjCostTrans` / `ProjProposalCost` |
| Credential | n8n's Dataverse-specific `microsoftDynamicsOAuth2Api` | generic `oAuth2Api` (n8n has no dedicated F&O credential) |
| Character | task/schedule-first (real backlog, baseline) | finance-first (budget/actual cost; no backlog, baseline or RAID) |

Declaring both, with different credential types and honestly different
capability sets, is the point: a customer who says "we're on Dynamics 365"
might mean either product, and conflating them would either silently fail to
authenticate or silently under/over-claim what can be read.

## What is mapped, and from where

The entity names in the binding are **real, documented** F&O data
entities — not invented — sourced from Microsoft's own Common Data Model
schema reference and the F&O OData documentation:

- `ProjectsV2` — the OData entity set for the project header (data entity
  `ProjProjectV2Entity`, underlying table `ProjTable`) → `list_projects`.
- `ProjectTasks` — the project's work-breakdown-structure (WBS) task lines,
  the closest F&O analogue to an "issue" → `list_issues` / `create_issue` /
  `update_issue` / `delete_issue`.
- `ProjProposalCost` — project estimate/proposal cost lines → backs `budget`
  and `plannedCost`.
- `ProjCostTrans` — posted actual-cost transactions → backs `actualCost` and
  `costCategory`.
- F&O's standard financial-dimension framework (e.g. the `CostCenter`
  dimension) → backs `costCenter`.
- F&O's project capitalisation feature (investment/asset-related projects) →
  backs `capitalised` / `expenditureType` / `capexAmount` / `opexAmount`.

Every canonical field the manifest references (`fieldKeys` in the JSON) is an
**existing** field in `lib/backend-catalogue/assets/fields.json` — nothing was
duplicated; `scripts/src/guard-superset.ts` enforces that in CI.

## Capability-honest scoping

Declared capabilities: `financials`, `issues`, `scheduling`. Explicitly
**not** declared:

- `baseline` — F&O's PMA module has no MS-Project/Primavera-style immutable
  EVM baseline concept.
- `raid` — no risk/issue register entity.
- `resources` — F&O does support resource assignment on project tasks, but no
  OData entity for it was confirmed against primary sources during this pass,
  so the capability is left off rather than guessed at. A follow-up PR can
  turn it on once an entity is verified.
- `portfolio` — F&O has "project groups" for categorisation, but that's not
  the same as a cross-project portfolio roll-up, so this stays off rather
  than over-claiming.

## What has NOT been verified

**This connector has not been tested against a live Dynamics 365 Finance &
Operations tenant** — none was available in this environment. Every URL,
entity name, field name and OData composite-key shape in
`dynamics365-fo.json` is a **reference mapping**, sourced from Microsoft's
public documentation and cross-checked against multiple independent sources,
in the same spirit as every other enterprise entry in this catalogue (SAP,
NetSuite, Planview, Primavera all carry the same "confirm against your own
instance" caveat in their `notes` field — see
`lib/backend-catalogue/src/backend-catalogue.ts`'s file header: "These are
*reference* mappings — every team should verify paths/fields against their
own backend version").

Before this connector should be described as **"supported"** rather than
**"catalogued,"** an operator with a real F&O environment needs to:

1. Confirm the exact entity names (`ProjectsV2`, `ProjectTasks`,
   `ProjProposalCost`, `ProjCostTrans`) are enabled (`IsPublic`) and reachable
   at `<env>/data/$metadata` on their tenant/version.
2. Confirm the `ProjectTasks` composite key shape used by `update_issue` /
   `delete_issue` (`dataAreaId` + `ProjectId` + `ProjectTaskId` is a reference
   guess, not a verified key order).
3. Confirm the Azure AD app registration's OAuth2 scopes/consent against a
   real F&O environment (this binding assumes a standard client-credentials
   or delegated OAuth2 flow via a generic n8n `oAuth2Api` credential, not
   n8n's Dataverse-specific credential).
4. Run `generateWorkflow()`'s output through an actual n8n instance pointed at
   the tenant and confirm the read/write round-trips.

Until that verification happens, treat this exactly as the codebase already
treats SAP/NetSuite/Planview: a well-scoped, capability-honest starting point
for an operator's own integration effort, not a certified turnkey connector.
See also `docs/PARKED-DECISIONS.md` for the broader "reference mapping,
confirm against your instance" convention this follows.
