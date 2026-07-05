# Bundled-backends stress report

OmniProject talks to many backends through **one HTTP contract** below the broker
seam. The bundled backend/broker/vendor definitions live in the backend catalogue
as per-vendor JSON (`lib/backend-catalogue/vendors/<plane>/<id>.json`), validated
against `vendors/schema/<plane>.schema.json`, embedded by `scripts/src/gen-vendors.ts`
into `lib/backend-catalogue/src/vendors.generated.ts`, and reached through the
catalogue accessors (`backendCatalogue` / `getBackend` / `brokerCatalogue` /
`getBrokerDef` / `brokerSupport`).

This report records a stress pass over **every** bundled definition — enumerated
from the catalogue, never hardcoded — proving the seam holds each one up under
adversarial conditions.

## Counts (read from the catalogue)

| Plane | Count |
| --- | ---: |
| **Backends stressed** | **41** |
| Brokers stressed | 7 |
| (context) notification vendors | 11 |
| (context) output vendors | 9 |

The harness stresses the **backends** and **brokers** planes (the live data-hop
seam). Notification/output vendors are counted for context but are exercised by
their own plane catalogue tests.

## What the harness asserts (per definition)

Harness: `artifacts/api-server/src/broker/bundled-backends-stress.test.ts`
(`tsx --test`, matching the repo convention). It is production-safe: it only ever
drives the **demo** broker (sample data), never a real backend.

1. **Schema-valid + loads via the accessor.** Each def resolves through
   `getBackend` / `getBrokerDef` and passes `validateVendor(plane, def)` against
   the embedded per-plane schema — the same validation CI and the runtime loader run.
2. **Capability + transport consistency.**
   - Every declared capability key is a known `CAPABILITY_DOMAIN` (a typo'd domain
     would silently gate nothing).
   - A def maps **≥1 capability** or is a dead entry — the harness rejects a
     zero-capability backend (no purpose in the catalogue).
   - Transport is **derived from the binding** (`transportOf`) and must match the
     catalogue view; the broker set must equal `brokersForTransport(transport)`
     (`native-node` ⇒ n8n only; `import` ⇒ no live brokers).
   - A live/database backend implements the read contract (`list_projects`,
     `list_issues`) and resolves to a **real key scheme** (never keyless — so
     keyless access is hard-rejected); an `import` source is keyless with no actions.
   - `statusVocabulary` (when declared) maps **only onto canonical statuses**, so
     the vendor's dialect folds into the completion maths below the seam.
   - Every broker satisfies the **synchronous** plane invariant, exposes a
     complete `brokerSupport` map over all capability keys, and declares ≥1 transport.
3. **Demo-AS-vendor spoof gating.** `applyVendorProfile(demo, id)` presents the
   demo AS the vendor with its declared surface: every `CAPABILITY_DOMAIN` matches
   the vendor's JSON; capability-poor domains return **gated empties** (`listRaid`
   `[]`, `projectFinancials` `{}`, `resourceCapacity` `[]`, `baseline` `null`);
   the presented `kind` carries the `-demo` suffix and `live` stays `false`.
   `demoVendorFor` proves a thin-file spoof **never** appears over real data
   (`realBackend: true` ⇒ `null`) or the dev broker (`devActive: true` ⇒ `null`).
4. **describeFields reconciliation.** Reconciling the demo's `describeFields`
   (canonical registry + tenant/custom fields) against `FIELD_REGISTRY` does not
   crash; canonical fields land as `known`, non-canonical as `unknown` and surface
   as **gated passthrough** custom fields. An adversarial enumeration (duplicates,
   empty keys, emoji/garbage keys, injected canonical) is classified correctly and
   crash-free.
5. **Messy-data gauntlet.** For every bundled vendor, the demo read model is read
   AS that vendor and pushed through the messy-data transform (`messifyRows`) at
   **max intensity** across **5 seeds** (`omni`, `alpha`, `bravo`, `charlie`,
   `delta`) over projects/issues/RAID. The transform mutates values/provenance but
   must **preserve row counts** and never sever a row's `projectId`. Nothing throws.

## Per-backend pass/fail matrix

All 41 backends **PASS** every assertion. `acts` = contract actions mapped;
`caps` = capability domains enabled; `key` = resolved key scheme.

| backend | kind | acts | caps | key | schema | cap/transport | spoof gating | messy | result |
| --- | --- | ---: | ---: | --- | :---: | :---: | :---: | :---: | :---: |
| asana | live | 5 | 2 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| azure-devops | live | 5 | 3 | basic | ✅ | ✅ | ✅ | ✅ | PASS |
| celoxis | live | 5 | 5 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| clickup | live | 5 | 2 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| dolibarr | live | 5 | 3 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| dynamics365-fo | live | 5 | 3 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| dynamics365-sales | live | 5 | 4 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| dynamics365 | live | 5 | 6 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| enterprise | live | 5 | 2 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| excel | import | 0 | 3 | none | ✅ | ✅ | ✅ | ✅ | PASS |
| freshservice | live | 5 | 3 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| github | live | 5 | 1 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| gitlab | live | 5 | 2 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| google-tasks | live | 5 | 2 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| hubspot | live | 5 | 4 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| jira-service-management | live | 5 | 3 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| jira | live | 5 | 3 | basic | ✅ | ✅ | ✅ | ✅ | PASS |
| linear | live | 5 | 2 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| liquidplanner | live | 5 | 4 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| microsoft-todo | live | 5 | 2 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| monday | live | 5 | 2 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| mongodb | database | 5 | 2 | bearer | ✅ | ✅ | ✅ | ✅ | PASS |
| msproject | live | 5 | 3 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| netsuite | live | 5 | 5 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| odoo | live | 5 | 3 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| openproject | live | 5 | 5 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| oracle-fusion-erp | live | 5 | 2 | basic | ✅ | ✅ | ✅ | ✅ | PASS |
| pipedrive | live | 5 | 4 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| plane | live | 5 | 2 | per-user | ✅ | ✅ | ✅ | ✅ | PASS |
| planview | live | 5 | 8 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| primavera | live | 5 | 5 | basic | ✅ | ✅ | ✅ | ✅ | PASS |
| salesforce | live | 5 | 4 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| sap | live | 5 | 6 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| sap-s4hana-financials | live | 2 | 3 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| servicenow | live | 5 | 3 | basic | ✅ | ✅ | ✅ | ✅ | PASS |
| smartsheet | live | 5 | 2 | bearer | ✅ | ✅ | ✅ | ✅ | PASS |
| sql | database | 5 | 3 | bearer | ✅ | ✅ | ✅ | ✅ | PASS |
| todoist | live | 5 | 2 | bearer | ✅ | ✅ | ✅ | ✅ | PASS |
| trello | live | 5 | 1 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |
| wrike | live | 5 | 2 | oauth2 | ✅ | ✅ | ✅ | ✅ | PASS |
| zendesk | live | 5 | 3 | apiKey | ✅ | ✅ | ✅ | ✅ | PASS |

### Brokers (7, all PASS)

| broker | synchronous | support map | transports | result |
| --- | :---: | :---: | --- | :---: |
| http-sidecar | ✅ | complete | http | PASS |
| make | ✅ | complete | http | PASS |
| n8n | ✅ | complete | http, native-node | PASS |
| node-red | ✅ | complete | http | PASS |
| pipedream | ✅ | complete | http | PASS |
| power-automate | ✅ | complete | http | PASS |
| serverless | ✅ | complete | http | PASS |

## Findings

No **broken** bundled definitions were found — the per-vendor JSON migration left
the catalogue internally consistent. The harness is the standing regression guard.

| # | Class | Severity | Location | Repro | Status |
| --- | --- | --- | --- | --- | --- |
| F1 | Consistency (verified clean) | info | all 41 `lib/backend-catalogue/vendors/backends/*.json` | Harness `backend[*]: capability + transport mapping is internally consistent` | **PASS** — every live/database backend maps the read contract, resolves a real key scheme, and its broker set matches `brokersForTransport`. |
| F2 | Gating (verified clean) | info | `artifacts/api-server/src/broker/vendor-profile.ts:47` | Harness `backend[*]: demo-AS-vendor spoof GATES the surface` | **PASS** — the spoof exposes exactly the vendor's declared domains and never surfaces `-demo` over real data. |
| F3 | Reconciliation (hardening) | low | `artifacts/api-server/src/lib/field-registry.ts:51` `reconcileFields` | Harness `reconcile: an ADVERSARIAL describe … never crashes` | **PASS** — added a crash-proof regression over dupe/empty/garbage enumeration input (previously only the happy path was tested). |

### Follow-ups (out of scope here, documented not fixed)

The parallel wave is adding a report + a widget to the catalogue, so this pass
stayed strictly in the backends/brokers/vendor-profile area and shared helpers.
Two low-severity observations for a later, separate change:

- **FU1 — nomenclature keys are validated only at apply-time (low).** A backend's
  `nomenclature` preset keys are silently dropped by `saveLabels` if they fall
  outside the label allow-list (`artifacts/api-server/src/lib/labels.ts`). Today all
  bundled presets use valid keys (cross-checked), but a future typo would produce a
  **dead preset** with no CI signal. Suggest a guard test asserting every bundled
  `nomenclature` key is in `LABEL_CATALOG`. Not added here to avoid coupling the
  backend stress harness to the premium labels catalogue.
- **FU2 — no per-kind live adapter yet (known scope, low).** `brokerForCommand`
  (`artifacts/api-server/src/broker/registry.ts`) makes the routing *decision* for
  heterogeneous brokers, but dispatch still goes through the single active adapter.
  This is called out honestly in that file's docstring; the stress harness asserts
  the decision logic, not multi-adapter dispatch (which doesn't exist yet).

## Running it

```
cd artifacts/api-server
pnpm exec tsx --test src/broker/bundled-backends-stress.test.ts
# or as part of the suite:
pnpm test
```
