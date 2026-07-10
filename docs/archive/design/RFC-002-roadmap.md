# RFC-002 — Roadmap & backlog (post-0.4.0 build session)

**Status:** Living backlog for prioritisation. No commitments to dates.

This captures everything queued during the big build session, with honest status
(**Done** / **Foundation laid** / **Not started**), dependencies, rough effort,
and risk — so the next moves can be chosen deliberately rather than FIFO.

## The architectural through-line

Almost every item below is the same shape: **OmniProject maps and surfaces
whatever a backend captures, gated by capability, above a swappable broker seam.**
The recent work made that real — a comprehensive field registry, per-field/entity
surface-vs-store capabilities, a custom-field passthrough, and create/validate
flows. So most remaining items are now "**declare more gated fields/entities + a
UI**", not new architecture.

## Legend
- **Done** — shipped & merged this session.
- **Foundation laid** — the backend/contract/engine exists; needs the rest (usually UI).
- **Not started** — design + build still to do.
- **Possible (deferred)** — designed and deliberately *not* built; pull-driven,
  with explicit trigger conditions before it goes on the queue.
- Effort: S ≈ ≤1 day · M ≈ 2–4 days · L ≈ ~1 week · XL ≈ multi-week.

---

## A. Data model & mapping  — *largely Done*

| Item | Status | Notes |
| --- | --- | --- |
| Field/entity capability map (surface vs store) | **Done** (#88) | Backend-driven; SPA gating helpers. |
| Canonical field registry + enumerate/reconcile | **Done** (#89) | New-backend field discovery. |
| Field relationships + create-time validation | **Done** (#90) | required + referential integrity. |
| Comprehensive state-of-the-art field superset | **Done** (#97) | Grouped; financial/effort/agile/classification/relationship. |
| Custom-field passthrough (`Issue.customFields`) | **Done** (#97) | Maps any non-canonical data, gated. |
| **Per-backend manifest field declaration + generator emission** | **Not started** | M | So the runtime map is truly per-backend from the workflow, not just derived. |
| **IssueDialog field-level gating** (read-only/hidden per `fields`) | **Not started** | S–M | Wire the field map into the edit dialog. |

## B. Creation & taxonomy

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| Brokered project create/update + dialog | **Done** (#91/#92) | | incl. programme grouping (derived). |
| New Task dialog (requires a project) | **Done** (#93) | | task = exactly one project. |
| Assignee dropdown → write-access members only | **Done** (#95) | | |
| Task child **issues & notes** — backend | **Done** (#94) | | gated `entities.issue`/`note`. |
| Task children **UI** (raise issue / add note on a task) | **Foundation laid** | M | wire #94 into the task detail/dialog. |
| **Copy/paste (duplicate task)** — clone-and-tweak through the broker | **Not started** | S | re-send a create pre-filled from a source task. |
| **Programme-as-entity** (`createProgramme` for backends with a real programme object) | **Not started** | M | gate on a backend declaring programme-as-entity; dialog picks derived-vs-entity. |

## C. Financials  — *Foundation laid*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| Financial fields (budget, planned/actual cost, currency, billable, cost centre) | **Done** (#97) | | in the registry, gated on `financials`. |
| **Financials on project & task (surfaced + editable)** | **Not started** | M | render/edit the financial fields where supported. |
| **Programme-level financial roll-up from tasks** | **Not started** | M | aggregate task → project → programme; reuse the EVM/portfolio plumbing. |
| Existing EVM report (CPI/SPI) | **Done** (pre-session) | | already gated on `financials`. |

## D. Resource planning  — *Foundation laid*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| Members carry skills + capacity; portfolio `/resources` aggregate | **Done** (#96) | | pure aggregation, gated `entities.member`. |
| **Resource-planning view (live)** — people, skills, capacity, allocation | **Not started** | M | a `/resources` page or extend the heatmap. |
| **What-if resource modelling** (capacity in the schedule sandbox) | **Not started** | M–L | "does moving this work exceed someone's capacity?" — integrate with the schedule what-if. |

## E. CRM / Salesforce  — *Not started*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| **View Salesforce/other CRM data** (accounts, opportunities, contacts, cases) | **Not started** | L | new gated entities + a read surface; architecturally just "more entities + custom fields" via the existing model + a CRM-shaped n8n workflow. |

## F. Exploration & what-if  — *mixed*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| Snapshots → trends, auto-snapshot, scenario sandbox, dependency-by-hash | **Done** (pre/early session) | | |
| Schedule what-if (drag bars, dependency knock-ons) | **Done** (#85) | | in `/explore`. |
| Snapshot-replica engine + interception seam | **Done** (#86) | | the load-bearing part. |
| **Explore replica increment 2** (mount the live views snapshot-backed, editable) | **Foundation laid** | L | a provider that installs the interceptor + a capture/import picker. |
| **Live Gantt drag-to-reschedule** (write-through) | **Not started** | M | the live counterpart of the what-if drag. |

## G. Security & access  — *Not started (highest care)*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| **Delegation / temporary access transfer** (consent-based, time-boxed, audited, revocable) | **Possible (deferred) — NO-GO for now, design complete ([RFC-004](RFC-004-delegation.md) limits + [RFC-005](RFC-005-secure-delegation-design.md) hardened design)** | L | **Decision (2026-06): designed, deliberately not built.** Pull-driven — Authentik (reference IdP) can't do RFC 8693 token exchange, so a default deployment gets only Phase 1 (OmniProject-side elevation + audit; backend writes still go as X); the genuinely valuable Phase 2 needs a token-exchange-capable IdP (Entra/Okta PIM, Keycloak, Zitadel). Highest-risk item, pre-community, no validated demand. **Greenlight only when:** a real user asks **and** runs a token-exchange-capable IdP (or accepts Phase-1-only) **and** a named security reviewer owns the §15/§17 checklist. Design is warm and de-risked — Phase 1 ≈ days when triggered. Full reasoning in RFC-005 "Decision — NO-GO" note. |
| **Admin-only translation-layer editor** (correct the field/entity mapping) | **Done** (#118) | M | admin-gated overrides persisted in gateway settings (config, not project data). |

## H. Scale & ops  — *mixed*

| Item | Status | Effort | Notes |
| --- | --- | --- | --- |
| n8n load-balancing pool + failover (`BROKER_URLS`) | **Done** (#98) | | gateway→n8n hop. |
| CI builds + smoke-boots the Docker image | **Done** (#84) | | |
| **n8n-at-scale load harness** (queue mode + real backend) | **Foundation laid** ([runbook](../../ops/LOAD-HARNESS.md)) | M | Harness shipped: drives reads **and** the write path, labels the broker it measured (demo runs marked `UNVERIFIED`, never passed off as n8n), structured report + verdict, tested pure core. **Still pending:** an actual queue-mode n8n + real-backend run to record numbers — the tool exists, the proof does not yet. |
| **Short-TTL gateway read cache** (optional scale relaxation) | **Foundation laid** | M | `lib/read-cache.ts` shipped — OFF by default (`READ_CACHE_TTL_MS=0`); a hot read becomes `getReadCache().wrap(...)`. Ephemeral, same trust class as the OData/Power-BI egress. |
| **Security/audit prep** (egress inventory + SBOM) | **Done** | | [Egress & trust-boundary inventory](../../ops/EGRESS-INVENTORY.md) consolidates the "stateless asterisks"; CI runs `pnpm audit` (blocks on critical) + emits an SBOM. Helps the CISO persona now and an eventual SOC 2. |
| **HTTP broker seam proven** (reference sidecar + conformance over the wire) | **Done** | | `reference-sidecar.ts` + `http-conformance.test.ts` — any binding-speaking sidecar (incl. a DB broker) drops in. |
| **Upstream-timing headers** (gateway vs broker latency) | **Done** | | `X-Omni-Upstream-Ms` / `X-Omni-Total-Ms`; load-test compose (`docker-compose.loadtest.yml`) brings up n8n queue mode + OpenProject. |

---

## Recommended sequencing

A pragmatic order that delivers visible value early and front-loads the risky bit:

1. **Make the recent backend work clickable** (fast wins, foundations already laid):
   Task-children UI (B) → Copy/paste duplicate (B) → IssueDialog field gating (A) →
   Resource-planning view (D) → Financials on project/task + programme rollup (C).
2. **Delegation** (G) — **done as design, deferred as build (NO-GO for now).** Pull-driven; revisit only on the trigger conditions in the §G row. Not in the active queue.
3. **Explore replica increment 2** (F) and **what-if resource/financial modelling** (D/C) — the higher-value modelling surfaces.
4. **CRM/Salesforce** (E) and **programme-as-entity** (B) — net-new surfaces.
5. **Scale validation**: n8n load harness (H), then the read cache if the numbers call for it.

> Pick any item and I'll build it as a tested, single-purpose PR. The "Foundation
> laid" rows are the cheapest high-value next steps.
