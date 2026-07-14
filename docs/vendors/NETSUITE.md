# Oracle NetSuite — capability-honest connector notes

This is the read-through-write-capable catalogue entry for Oracle NetSuite
(`lib/backend-catalogue/vendors/backends/netsuite.json`), the reference **major
ERP** backend (enterprise tier, alongside SAP, Dynamics 365 and Primavera).
OmniProject is a project/programme overlay, **not** an ERP — this connector's
whole job is to *read project-accounting context* out of NetSuite (and, like
every other catalogued PM tool, mirror OmniProject's own issue/task writes back
onto NetSuite project tasks). Nothing here lets OmniProject originate financial
transactions.

## Status: catalogued, not live-verified

Every bundled backend in the catalogue carries this caveat in its own `notes`
field and is tracked as **"nominal"** (declared/reference, not
production-validated) in `docs/FEATURE-MATURITY.md` §4 — NetSuite is not a
special case, but because it is the ERP/financial-context reference connector
it is worth saying explicitly, in one place:

- The record/field mapping below was authored from NetSuite's **public
  SuiteTalk REST Web Services documentation** (the record catalog + the
  SuiteTalk REST/SuiteQL overview), not from a live NetSuite account — **no
  NetSuite tenant is available in this development environment.**
- It passes every *structural* check the catalogue can run without a live
  account: schema validation, capability/transport consistency, demo-vendor
  spoof gating, the messy-data gauntlet, and generating a real, importable
  15-node n8n workflow (`lib/backend-catalogue/src/workflow-generator.ts` →
  `artifacts/n8n-blueprints/generated/omniproject-netsuite.json`).
- It has **not** been exercised against a real NetSuite account — record IDs,
  exact field names, SuiteQL grammar edge cases, and the account's SuiteTalk
  API version are all things only a live tenant can confirm.
- **Before calling this "supported" rather than "catalogued,"** an operator
  (or a follow-up change) must run it against a real NetSuite sandbox/account
  and fix whatever the live API disagrees with. Until then, treat it as a
  verified-correct **starting point**, not a tested integration.

## What's actually mapped (real SuiteTalk REST record types)

| NetSuite record (SuiteTalk REST v1) | OmniProject concept | Capability domain |
| --- | --- | --- |
| `job` | project (`list_projects`) | `portfolio` |
| `projectTask` | issue/task (`list_issues`, `create_issue`, `update_issue`, `delete_issue`) | `issues`, `scheduling` (task start/end/planned work) |
| `resourceAllocation` | resource assignment against a job/projectTask | `resources` |
| `job` job-costing fields (`estimatedCost`/`actualCost`) + the `expenseReport` and `timeBill` transaction records that roll up into them | project financials (→ canonical `budget`/`plannedCost`/`actualCost`) | `financials` |

Declared capabilities: `issues`, `portfolio`, `financials`, `resources`,
`scheduling` = true; `baseline`, `blockers`, `history`, `raid` = false — NetSuite
has no first-class baseline/blocker/RAID record surfaced here, so those domains
stay honestly gated off rather than faked from adjacent fields.

**Reads, not just single-record CRUD.** The REST record endpoints
(`/services/rest/record/v1/<record>`) used by the contract actions above are
single-record operations. The realistic way to pull *aggregated*
budget-vs-actual numbers across `job`/`projectTask`/`expenseReport`/`timeBill`
is NetSuite's **SuiteQL** endpoint (`POST /services/rest/query/v1/suiteql` with
a SQL-like `q`), which this catalogue entry calls out in its `notes` field as
the path a real financials integration should use for roll-ups, rather than
paging every child transaction record by hand.

**Canonical field reuse.** No NetSuite-specific fields were invented — project
financials land on the existing canonical `budget`/`plannedCost`/`actualCost`/
`currency`/`costCenter` fields (`docs/FIELD-CATALOGUE.md` "Existing" group),
and NetSuite is already cited against the finance-catalogue fields it
genuinely supports: `billRate`, `costRate`, `purchaseOrder`, `revenue`,
`invoicedAmount`, `margin`, `capitalised`, `expenditureType`, `capexAmount`,
`opexAmount`, `costCategory`, `depreciationMonths` (`docs/FIELD-CATALOGUE.md`,
financial — billing & cost / CapEx-OpEx groups).

## Auth: OAuth 1.0a Token-Based Authentication (TBA), by default

NetSuite's SuiteTalk REST supports both **OAuth 1.0a TBA** (consumer key/secret
+ token key/secret + account/realm id) and **OAuth 2.0 client-credentials
(M2M)**. This catalogue entry defaults to **TBA** (`credentialType:
"oAuth1Api"`) because it remains the more common self-service setup for a
single-tenant integration configured entirely through an n8n-managed
credential — no different in shape from how Dynamics 365 models its OAuth2
credential. An operator on OAuth 2.0 can swap the credential type without
touching the URLs, since the binding only references `$env.NETSUITE_BASE_URL`
plus the n8n-managed credential.

## Verification performed in this change

- `pnpm --filter @workspace/scripts run gen-vendors` — schema-valid, embeds
  cleanly, no drift.
- `pnpm --filter @workspace/scripts run gen-n8n-blueprints` — regenerated
  `artifacts/n8n-blueprints/generated/omniproject-netsuite.json` straight from
  `generateWorkflow()`; inspected it node-by-node (webhook → verify/loop guards
  → switch router → 5 SuiteTalk REST HTTP nodes with `oAuth1Api` credential
  placeholders → normalize → respond).
- `artifacts/api-server/src/broker/bundled-backends-stress.test.ts` — all 163
  assertions pass, including NetSuite's schema/capability/spoof-gating/messy-data
  checks.
- `lib/backend-catalogue` unit tests (100/100) and typecheck — clean.

## Verification NOT performed (the honest gap)

- No call was made against a real NetSuite account or sandbox — none is
  available in this environment.
- SuiteQL query shape, exact `projectTask`/`resourceAllocation` field names,
  and OAuth 1.0a TBA header signing were not exercised end-to-end against
  NetSuite; they follow the documented SuiteTalk REST contract but are
  unverified in practice.
