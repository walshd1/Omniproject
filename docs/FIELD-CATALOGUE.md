# Field catalogue — the cross-product superset

A grouped, typed catalogue of the data fields the leading project/work, finance/
ERP-PSA, CRM and ITSM backends capture on their primary work items, deals and
tickets. It is the source list for extending the **canonical field registry**
(`lib/field-registry.ts`) — every field here is *gated* (surfaced/stored only
when the wired backend supports it), so the registry can be a superset without
forcing anything on a backend that doesn't have it.

**How to read it.** Each field has a canonical camelCase `key`, a `type`, the
notable products that expose it, and a ★ when it is *best-in-class* (advanced but
high-value). Fields already in the registry are listed under "Existing" for
context and not re-added.

**Provenance / honesty.** The CRM/sales rows marked **[v]** were verified against
primary vendor docs (HubSpot default deal properties; Pipedrive Deals API) by the
research pass. The remaining rows are curated from the well-documented field
models of the named products (Salesforce Opportunity, Primavera P6 / MS Project
EVM, ServiceNow/Zendesk tickets, Azure DevOps, Jira, etc.); they are *candidates*
to confirm against each backend's live API enumeration when it is wired — which
is exactly what `reconcileFields()` does. Nothing here is load-bearing until a
backend declares it.

**Types** extend the registry vocabulary with `currency`, `percent`, `boolean`
and `duration` for precision (all gated like any other field).

---

## Existing (already in the registry — not re-added)
`title, status, description · assignee, reporter, watchers · priority, labels,
type, component, resolution, severity, fixVersion, environment · startDate,
dueDate, milestone, baselineStart, baselineFinish · estimateHours, loggedHours,
remainingHours · storyPoints, sprint, epic, rank · budget, plannedCost,
actualCost, currency, billable, costCenter · programmeId, parentTask, dependsOn ·
completionPct`

---

## core / people
| key | type | products | ★ |
| --- | --- | --- | --- |
| `summary` | string | Jira (alias of title) | |
| `externalKey` | string | all (e.g. Jira key, ServiceNow number) | |
| `owner` | user | Asana, Smartsheet, ServiceNow (separate from assignee) | |
| `approver` | user | ServiceNow, OpenProject, Wrike | |
| `team` | string | Azure DevOps, Linear, ClickUp | |
| `stakeholders` | labels | MS Project, Wrike, Smartsheet | |
| `followers` | labels | Asana, Zendesk (collaborators) | |

## classification
| key | type | products | ★ |
| --- | --- | --- | --- |
| `category` | string | ServiceNow, Zendesk, Jira SM | |
| `subcategory` | string | ServiceNow | |
| `tags` | labels | most (distinct from `labels` where both exist) | |
| `flagged` | boolean | Jira (Flagged/impediment), Asana | |
| `confidentiality` | enum | Azure DevOps, OpenProject | |

## schedule
| key | type | products | ★ |
| --- | --- | --- | --- |
| `actualStart` | date | MS Project, Primavera P6, Smartsheet | |
| `actualFinish` | date | MS Project, Primavera P6, Smartsheet | |
| `targetDate` | date | Linear, Azure DevOps | |
| `expectedCloseDate` | date | Pipedrive, HubSpot (Close date) **[v]** | |
| `duration` | duration | MS Project, Primavera P6, Smartsheet | |
| `freeFloat` | duration | Primavera P6, MS Project | ★ |
| `totalFloat` | duration | Primavera P6 (slack) | ★ |
| `criticalPath` | boolean | MS Project, Primavera P6, Smartsheet | ★ |
| `constraintType` | enum | MS Project, Primavera P6 (ASAP/MSO/…) | |
| `slaTarget` | duration | ServiceNow, Jira SM, Zendesk | |
| `slaDueAt` | date | ServiceNow, Jira SM, Zendesk | ★ |

## effort / time
| key | type | products | ★ |
| --- | --- | --- | --- |
| `originalEstimateHours` | number | Jira, Azure DevOps (Original Estimate) | |
| `workEffort` | number | MS Project (Work), Primavera (units) | |
| `percentWorkComplete` | percent | MS Project, Primavera P6 | |
| `physicalPercentComplete` | percent | Primavera P6 | ★ |
| `capacity` | number | Azure DevOps, Jira (team capacity) | |

## agile
| key | type | products | ★ |
| --- | --- | --- | --- |
| `acceptanceCriteria` | text | Azure DevOps, Jira | |
| `businessValue` | number | Azure DevOps, SAFe tools | |
| `riceScore` | number | ProductBoard, Jira (RICE apps) | ★ |
| `wsjf` | number | Jira/SAFe, Azure DevOps | ★ |
| `moscow` | enum | many (Must/Should/Could/Won't) | ★ |
| `confidence` | percent | Linear, RICE frameworks | ★ |
| `valueArea` | enum | Azure DevOps (Business/Architectural) | |
| `iterationPath` | reference | Azure DevOps | |
| `areaPath` | reference | Azure DevOps | |

## financial — earned value (EVM)  ★ group
| key | type | products | ★ |
| --- | --- | --- | --- |
| `plannedValue` | currency | Primavera P6 (BCWS), MS Project | ★ |
| `earnedValue` | currency | Primavera P6 (BCWP), MS Project, D365 PO | ★ |
| `budgetAtCompletion` | currency | Primavera P6 (BAC), MS Project | ★ |
| `estimateAtCompletion` | currency | Primavera P6 (EAC), MS Project | ★ |
| `estimateToComplete` | currency | Primavera P6 (ETC), MS Project | ★ |
| `costVariance` | currency | Primavera P6 (CV), MS Project | ★ |
| `scheduleVariance` | currency | Primavera P6 (SV), MS Project | ★ |
| `varianceAtCompletion` | currency | Primavera P6 (VAC) | ★ |
| `costPerformanceIndex` | number | Primavera P6 (CPI), MS Project | ★ |
| `schedulePerformanceIndex` | number | Primavera P6 (SPI), MS Project | ★ |

## financial — billing & cost
| key | type | products | ★ |
| --- | --- | --- | --- |
| `billRate` | currency | D365 Project Ops, NetSuite, Odoo | ★ |
| `costRate` | currency | D365 Project Ops, NetSuite (per-resource) | ★ |
| `committedCost` | currency | SAP PS, D365 PO (PO/commitment) | ★ |
| `purchaseOrder` | string | SAP PS, NetSuite, Dolibarr | |
| `revenue` | currency | D365 PO, NetSuite, Odoo | |
| `invoicedAmount` | currency | NetSuite, Odoo, Dolibarr | |
| `margin` | percent | D365 PO, NetSuite, Odoo | ★ |
| `capitalised` | boolean | SAP PS, NetSuite (capex vs opex) | ★ |
| `forecastCost` | currency | SAP PS, D365 PO | |
| `wbsCode` | string | SAP PS, Primavera P6 (WBS) | |

## financial — CapEx / OpEx split  (E2 — gated by `financials`)
The explicit capitalisation split + cost-rate roll-up dimensions for finance-grade
reporting (complements the existing `capitalised` boolean and `costRate`/`billRate`).
These fields are typed on `Issue` and surfaced by the **CapEx / OpEx** report
(`lib/capex` — capital vs operating split, category roll-up, annual depreciation charge).
| key | type | products | ★ |
| --- | --- | --- | --- |
| `expenditureType` | enum | SAP PS, NetSuite, D365 (capex/opex/mixed) | ★ |
| `capexAmount` | currency | SAP PS, NetSuite (capitalised portion) | ★ |
| `opexAmount` | currency | SAP PS, NetSuite (operating portion) | ★ |
| `costCategory` | string | SAP PS, NetSuite (GL/cost category for roll-up) | |
| `depreciationMonths` | number | SAP PS, NetSuite (useful-life for capex amortisation) | |

## benefits realisation  (E1 — new group + `benefits` domain)  ★
Quantified, trackable benefits so a programme can show planned-vs-actual value
realisation. A dedicated `benefits` capability domain gates the group (a backend
can carry benefits without a full portfolio rollup). Complements the lighter
`expectedBenefit`/`benefitRealised` already under `strategy`. These fields are typed
on `Issue` and surfaced by the **Benefits Realisation** report (`lib/benefits` —
planned-vs-actual, realisation %, risk-adjusted forecast, RAG by status).
| key | type | products | ★ |
| --- | --- | --- | --- |
| `benefitType` | enum | MSP/PRINCE2 tooling, Planview (cashable/non-cashable/…) | ★ |
| `benefitOwner` | user | MSP tooling, Planview | |
| `plannedBenefitValue` | currency | MSP tooling, Planview (target) | ★ |
| `actualBenefitValue` | currency | MSP tooling, Planview (realised to date) | ★ |
| `benefitMeasure` | string | MSP tooling (the KPI/unit being moved) | |
| `benefitBaseline` | number | MSP tooling (starting metric value) | |
| `benefitTarget` | number | MSP tooling (target metric value) | |
| `benefitStartDate` | date | MSP tooling (realisation start) | |
| `benefitDueDate` | date | MSP tooling (realise-by) | |
| `benefitStatus` | enum | MSP/Planview (on_track/at_risk/realised/missed) | ★ |
| `benefitConfidence` | percent | Planview (realisation confidence) | |

## risk & quality  (new group)
| key | type | products | ★ |
| --- | --- | --- | --- |
| `healthStatus` | enum | Jira (RAG), Smartsheet, Wrike (Green/Amber/Red) | ★ |
| `riskLevel` | enum | ServiceNow, OpenProject, PRINCE2 tools | |
| `probability` | enum | RAID/risk registers (likelihood) | |
| `impact` | enum | ServiceNow, Jira SM (impact) | ★ |
| `urgency` | enum | ServiceNow, Jira SM | ★ |
| `blocked` | boolean | Jira, ClickUp, Linear | ★ |
| `blockedReason` | string | Jira, ClickUp | |
| `mitigation` | text | RAID/risk registers | |
| `qaStatus` | enum | Azure DevOps (test), Jira | |
| `defectCount` | number | Azure DevOps, Jira | |

## CRM / sales  (new group)
| key | type | products | ★ |
| --- | --- | --- | --- |
| `dealValue` | currency | HubSpot (Amount), Pipedrive (value), Salesforce (Amount) **[v]** | ★ |
| `dealProbability` | percent | Pipedrive, HubSpot, Salesforce (Probability) **[v]** | ★ |
| `forecastProbability` | percent | HubSpot **[v]** | ★ |
| `forecastCategory` | enum | HubSpot, Salesforce (ForecastCategory) **[v]** | ★ |
| `dealStatus` | enum | Pipedrive (open/won/lost) **[v]** | |
| `dealStage` | reference | HubSpot, Pipedrive (stage_id), Salesforce (StageName) **[v]** | |
| `pipeline` | reference | HubSpot, Pipedrive (pipeline_id) **[v]** | |
| `dealOwner` | user | Pipedrive (owner_id), HubSpot, Salesforce **[v]** | |
| `account` | reference | Salesforce (AccountId), Pipedrive (org_id) **[v]** | |
| `contact` | reference | Pipedrive (person_id), HubSpot, Salesforce **[v]** | |
| `leadSource` | enum | Salesforce, HubSpot, Pipedrive | |
| `nextStep` | string | Salesforce (NextStep) | |

## service / ITSM  (new group)
| key | type | products | ★ |
| --- | --- | --- | --- |
| `slaBreached` | boolean | ServiceNow, Jira SM, Zendesk | ★ |
| `firstResponseAt` | date | Zendesk, Jira SM, ServiceNow | |
| `resolvedAt` | date | ServiceNow, Zendesk, Jira SM | |
| `reopenCount` | number | Zendesk, ServiceNow | |
| `csatScore` | number | Zendesk, ServiceNow, Salesforce | ★ |
| `csatComment` | text | Zendesk, ServiceNow | |
| `sentiment` | enum | Zendesk (AI), ServiceNow | ★ |
| `channel` | enum | Zendesk, ServiceNow, Jira SM (web/email/phone) | |
| `requester` | user | Zendesk, ServiceNow, Jira SM | |
| `affectedService` | reference | ServiceNow (CMDB CI), Jira SM | ★ |
| `changeType` | enum | ServiceNow (standard/normal/emergency) | ★ |
| `changeRisk` | enum | ServiceNow | |

## CRM / sales — derived/roll-up  ★
| key | type | products | ★ |
| --- | --- | --- | --- |
| `weightedValue` | currency | HubSpot (Weighted amount), Pipedrive (weighted_value) **[v]** | ★ |
| `forecastAmount` | currency | HubSpot (Forecast amount = amount × forecast prob) **[v]** | ★ |
| `expectedRevenue` | currency | Salesforce (ExpectedRevenue = Amount × Probability) | ★ |

## relationship
| key | type | references | products |
| --- | --- | --- | --- |
| `blocks` | reference | task | Jira, Linear, Azure DevOps |
| `relatesTo` | reference | task | Jira, Azure DevOps, Linear |
| `duplicateOf` | reference | task | Jira, Linear, Zendesk |
| `accountRef` | reference | account | Salesforce, Pipedrive |
| `contactRef` | reference | contact | Salesforce, Pipedrive, HubSpot |

## strategy  (new group — portfolio-tier, project + programme)
Strategic alignment: what each project/programme contributes to. Gated by the
`portfolio` domain, so it surfaces at the project **and** programme level.

| key | type | meaning | products |
| --- | --- | --- | --- |
| `strategicGoals` | labels | the strategic goals this thing supports | Planview, Jira Align, MS Project for the web |
| `kpis` | labels | KPIs it is measured by / contributes to | Planview, ServiceNow SPM |
| `objectives` | labels | linked objectives / OKRs | Jira Align, Planview, Asana Goals |
| `strategicTheme` | enum | the theme / investment pillar | SAFe tools, Planview |
| `valueStream` | string | SAFe value stream / portfolio lane | Planview, Jira Align |
| `strategicContribution` | percent | how much it contributes to the goal | Planview, ServiceNow SPM |
| `expectedBenefit` | text | the benefit case | PRINCE2/MSP tooling, Planview |
| `benefitRealised` | percent | benefit realised to date | MSP tooling, Planview |

---

## New capability domains implied
Adding the groups above implies three new capability **domains** so they gate
cleanly (each maps a field group → domain, the existing mechanism):

- **`crm`** — CRM/sales fields + the `account`/`contact`/`deal` entities.
- **`service`** — ITSM/service fields (SLA, CSAT, change).
- **`quality`** — risk & quality fields (health, impact/urgency, blocked).

EVM and billing fields stay under the existing **`financials`** domain; schedule
floats/critical-path under **`scheduling`**; agile prioritisation under
**`issues`** (the agile group's domain). A backend only ever sees a group when it
declares the domain — so a pure issue tracker shows none of the CRM/ITSM/finance
fields, and a CRM backend lights up the sales group.

---

## Next step
`lib/field-registry.ts` is extended with these as gated `FieldDescriptor`s (new
groups `crm`/`service`/`quality`, new types `currency`/`percent`/`boolean`/
`duration`), and `lib/capabilities.ts` gains the `crm`/`service`/`quality`
domains + `GROUP_DOMAIN` mappings. When a real backend is wired, `reconcileFields`
diffs its enumerated API against this superset: matches wire up automatically,
genuinely-new fields are reported for a deliberate registry edit, and anything
still unknown rides the `customFields` passthrough.

## The superset is enforced and vendor-extensible

The registry is the **union of every backend's fields** — and that's now guaranteed by the build,
not just by convention:

- **A vendor can grow it.** A backend descriptor (`vendors/backends/<id>.json`) may declare an
  optional `fields[]` array; `gen-fields` merges those into the superset (dedup by key; a
  conflicting type/group redefinition is an error). Add a vendor whose API exposes a new field and
  the superset grows with it.
- **Every backend ⊆ superset.** A backend may only *reference* canonical fields it actually
  supports via `fieldKeys[]`, and the `guard-superset` CI check fails the build if any of those
  isn't in the superset. So OpenProject — like every other backend — is a strict subset by
  construction; the superset can only ever be a superset.
- **`entity` tag.** Each field may declare the canonical `entity` (table) it belongs to (default
  `issue`) — the grouping key the superset-native self-host-DB schema generator uses to place a
  field as a column on the right table.
