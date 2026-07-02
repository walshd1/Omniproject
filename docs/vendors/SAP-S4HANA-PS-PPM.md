# SAP S/4HANA (PS/PPM) — financials read-only connector

Status: **catalogued, NOT yet verified against a live S/4HANA tenant.**

This is the honesty note the backend JSON itself points at
(`lib/backend-catalogue/vendors/backends/sap-s4hana-financials.json`, `notes`).
Everything below is built from SAP's own published API documentation and
community-verified field/entity names — not from a live SAP system, because no
S/4HANA tenant is available in this build/CI environment. Treat it as a
well-researched **starting scaffold** for an operator's own SAP team to point at
their tenant and adjust, not as a pre-flight-checked integration.

## What this is (and isn't)

OmniProject is a project/programme overlay, not an ERP. It does not try to
replace SAP Project System / Portfolio and Project Management (PS/PPM) — it
reads financial **context** out of it (budget, actuals, cost center) the same
way it reads issues out of Jira or Azure DevOps, through the broker seam.

- `sap-s4hana-financials` (this connector) — **read-only**. Declares only
  `list_projects` and `list_issues`; no `create_issue` / `update_issue` /
  `delete_issue`. It exists purely to surface cost-object financial data scoped
  by cost center, for programme/portfolio financial reporting (EVM-style
  budget-vs-actual, RAG rollups) — not to manage SAP projects.
- `sap` (pre-existing, unrelated to this PR) — the write-capable WBS-element
  editor (`API_ENTERPRISE_PROJECT_SRV` create/update/delete). Kept as-is; an
  operator who wants two-way WBS sync uses that one instead of, or alongside,
  this one.

Splitting them keeps each one honest about what it actually does: a single
"SAP" connector that both edits WBS elements *and* claims to read
Controlling-scoped actuals would blur "PM overlay" into "ERP", which is
explicitly out of scope.

## Real SAP API surface referenced

| Purpose | Service / CDS view | Backing table | Wired as |
| --- | --- | --- | --- |
| WBS / Enterprise Project master data (structure, controlling area, company code, responsible cost center) | `API_ENTERPRISE_PROJECT_SRV` → `A_EnterpriseProjectElement` | — | `list_projects` (read-only `$select`, same service the `sap` backend already uses to write) |
| Actual costs per WBS element | `I_ProjectActualCosts` (released CDS view) | `ACDOCA` (Universal Journal) | `list_issues` |
| Plan / budget figures per WBS element | `API_FINPLANNINGDATA_SRV` | `ACDOCP` (financial planning) | **noted, not auto-wired** — different filter keys/cadence than the actuals view; add a second HTTP node in the generated n8n workflow |
| Cost center master data (enrichment) | `CE_COSTCENTER_0001` (Cost Center OData V4 read API) | — | **noted, not auto-wired** — add as a lookup node if you want cost-center names/attributes rather than just the code |

Sources consulted (community-verified field/service names, not a live tenant):
SAP Business Accelerator Hub (`api.sap.com`) overview pages for
`API_ENTERPRISE_PROJECT_SRV` and `CE_COSTCENTER_0001`; SAP Help Portal pages for
the WBS Element and CDS-Views-for-Project-System topics; SAP Community threads
on WBS actual-cost reporting and WBS cost-plan loading (which point at
`API_FINPLANNINGDATA_SRV` for planning data since it has no native OData
wrapper with plan-version support); SAP's own KBA index of CDS views for
checking actual costs (which names `I_ProjectActualCosts`).

## Field mapping (canonical registry — reused, not duplicated)

`fieldKeys` in the vendor JSON declares which of the **existing** canonical
fields (`lib/backend-catalogue/assets/fields.json`, documented narratively in
`docs/FIELD-CATALOGUE.md`) this connector's real data can populate — no new
fields were added to the registry:

`wbsCode`, `costCenter`, `currency`, `budget`, `plannedCost`, `actualCost`,
`committedCost`, `capitalised`, `expenditureType`, `capexAmount`, `opexAmount`,
`costCategory`, `depreciationMonths`, `purchaseOrder`, `parentTask`.

`docs/FIELD-CATALOGUE.md` already carried "SAP PS" as a source citation for
most of these (from earlier vocabulary research); this connector is what
actually turns that citation into a catalogued, connectable backend.

## Auth

**Assumption made, documented here so it can be challenged:** SAP S/4HANA
Cloud secures its published OData APIs through a Communication Arrangement,
typically using OAuth 2.0 client-credentials issued to a technical/
communication user — that's the realistic default this connector assumes
(`credentialType: "oAuth2Api"`, an n8n-managed OAuth2 credential configured for
client-credentials grant). SAP on-premise Gateway systems more commonly expose
the same services over Basic Auth (a service/communication user) instead —
switch `credentialType` to `httpBasicAuth` (and drop the OAuth2 credential) if
your target is on-prem, not Cloud.

## Why "catalogued", not "supported"

The connector is schema-valid, passes the capability-honesty and
field-superset guards, and generates a working (webhook → read-only HTTP
nodes → respond) n8n scaffold via `generateWorkflow()` — but none of that
proves the `$select`/`$filter` clauses, the exact OData service path
`I_ProjectActualCosts` is exposed under, or the field names on
`A_EnterpriseProjectElement`, match what a **specific** customer's S/4HANA
release actually serves. CDS-view analytical services in particular are
frequently republished under a generated `srvd_a2x` service id that varies by
component version. Before calling this "supported":

1. Point it at a real (sandbox, ideally) S/4HANA tenant.
2. Confirm the Gateway service catalog (`/IWFND/MAINT_SERVICE`) exposes the
   services above under the paths this connector assumes, or adjust them.
3. Confirm the `$select`/`$filter` fields resolve (some are release-dependent).
4. Re-run the workflow-verifier probe (`{ verify: true }`) end to end.

Until then, treat every URL in the vendor JSON as a well-cited starting point,
not a tested one.
