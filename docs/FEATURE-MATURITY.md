# Feature maturity & readiness audit

A skeptical, feature-by-feature read of what is **production-ready**, what is **beta**, and what is
**prototype / nominal**, plus the **buried debt** worth knowing before we expose features through the
hierarchical gating model. Maturity tiers: **stable** (shipped, tested, safe to default-on) · **beta**
(works, some rough edges / partial tests) · **prototype** (experimental / unproven) · **nominal**
(declared/reference, not production-validated).

The right-hand **Gate default** column feeds the org→programme→project gating model: the rule is
**everything ON by default** unless a **safety / cost / storage** concern argues for OFF-by-default.

> Audited by four parallel reviewers (reports · feature-modules · tools/AI/accessibility ·
> platform/infra). This is a living document — update it as features mature.

---

## 1. Reports (SPA, mostly stateless derivations)

| Report | Maturity | Tests | Key debt | Gate default |
| --- | --- | --- | --- | --- |
| Benefits Realisation | stable | partial | no error-state test; chart clamps to 8 rows (tail hidden) | **ON** |
| CapEx / OpEx | stable | partial | annualised-charge edge cases untested; silent "Uncategorised" | **ON** |
| Critical Path (CPM) | stable | good | 8h/day hardcoded; cycle alert doesn't say how to break it | **ON** |
| Monte Carlo risk | stable | good | naive done-status match; tornado clamps to 8 | **ON** |
| Portfolio Roadmap | stable | good | span from any date can skew axis; today-marker tz assumption | **ON** |
| Portfolio KPI | stable | partial | RAG colour map assumes RED/AMBER/GREEN, else silent fallthrough | **ON** |
| Resource Heatmap | stable | good | >150% over-allocation visually clipped; no zero-capacity empty state | **ON** |
| Project Trend | beta | good | history endpoint unpaginated; empty-vs-error both render "no history" | **ON** |
| Earned Value (EVM) | beta | good | **6-period linear trend is a demo-only derivation**, not real history | **ON** (label provenance) |
| Scenario Sandbox | stable | good | volatile snapshots only; global reset (no per-project) | **ON** |
| Schedule Sandbox | beta | good | cyclic edges silently dropped; no sanity bound on shift size | **ON** |
| Dependency Links | beta | partial | volatile sessionStorage; drift re-read side-effect; no edge cap | **ON** |
| Portfolio Trends | beta | partial | auto-capture runs only while tab open; **sessionStorage quota can silently drop captures** | **OFF-by-default** — *storage* |
| Time Travel | beta | partial | requires the logging-server egress opt-in | **OFF-by-default** — *cost/privacy* (already capability-gated) |

**Top report debt:** (1) several charts/tables silently clamp to 8 rows — add "view all"/pagination;
(2) hardcoded assumptions without user control (CPM 8h/day, EVM 6-period trend, roadmap tick heuristic);
(3) volatile client stores (Dependency Links, Portfolio Trends, sandboxes) have no quota warning or
crash-recovery prompt; (4) free-form backend values normalised by heuristic (benefit status regex, RAG
colours) can mis-bucket niche backends; (5) silent mode-switches/fallbacks need "why is this empty?" copy.

---

## 2. Feature modules (the toggleable registry)

| Module | Kind | Maturity | Tests | Key debt | Gate default |
| --- | --- | --- | --- | --- | --- |
| grid | UI-only | beta | e2e | optimistic-concurrency safe; no bulk-payload size cap | **ON** |
| savedViews | backend | stable | partial | **unbounded array in config bundle**; no per-user RBAC | **ON** (cap size) |
| myWork | UI-only | beta | partial | N+1 per-project issue fetches; inbox capped 100 | **ON** |
| dashboards | backend | stable | partial | **unbounded array in config bundle**; no bad-widget handling | **ON** (cap size) |
| sidePanel | UI-only | beta | partial | **undeclared dependency on `presence`** | **ON** |
| globalSearch | UI-only | beta | partial | no debounce/cancel on rapid queries | **ON** |
| odata | backend | beta | partial | **no `$filter/$select` size/depth limits**; generic 502 | **OFF-by-default** — *cost* (BI egress) |
| integrations | backend | beta | partial | silently drops portfolio health on broker error | **OFF-by-default** — *cost* (egress) |
| presence | backend | beta | full | **SSE streams, in-memory rooms, no connection cap; per-replica only** | **OFF-by-default** — *cost* |
| predictivePrefetch | UI-only | prototype | partial | **multiplies broker calls by N projects; no metrics** | **OFF-by-default** — *cost* |

**Gating mechanism — now shipped + hardened (PRs #284–#287 + the hardening pass).** The flat
`disabledFeatures` array has been replaced by the **org→programme→project** model: a pure
`feature-resolution` resolver (monotonic narrowing, hard `require`/`forbid` locks) over a unified
**governance catalogue** (feature modules ∪ `report:*` ∪ `methodology:*`), per-scope config, scoped
`GET/PUT /api/features`, scope-aware `requireFeature`, and the 3-level admin UI. The security + maturity
pass on the new boundary then closed: the parent **ceiling now excludes ancestor `forbid` locks** (not
just soft disables); **catalogue-id validation**, **require∩forbid conflict rejection** and a
**`__proto__`/`constructor`/`prototype` key guard** on the write endpoints; **semantic audit** of every
governance mutation; and **server-side enforcement of the report/methodology planes** (a `forbid
report:x` / `forbid methodology:x` is withheld from `/api/setup/reports` + `/api/setup/methodologies`,
not just hidden in the admin table).

**Scope-ownership is now enforced statelessly** — a governance write checks that the caller manages the
named programme/project by pulling their **visible project graph live from the backend** (their forwarded
token; the backend's access control is the oracle), so there's no IDOR and no user→scope directory to
hold (`SECURITY-AUDIT.md §2`). The project ceiling now also uses the project's **real** server-resolved
programme, closing the old client-supplied-`programmeId` widening.

**Residual gating debt (tracked):** (1) **No size quotas** on the per-scope config maps (shared with the
broader config-bundle quota debt). (2) The per-scope override store is **per-replica RAM** like the rest
of settings — fleet changes don't auto-propagate. (3) A project whose `programmeId` points at a deleted
programme resolves under **org-only** policy (stale-hierarchy edge) — benign now that the ceiling is
server-resolved, but worth a "programme not found" surfacing.

---

## 3. Tools / AI / accessibility

| Feature | Maturity | Tests | Key debt | Gate default |
| --- | --- | --- | --- | --- |
| Tools registry + egress/consent | stable | partial | SSRF-guarded; tri-state governance; everything off until enabled | **OFF-by-default** — *safety* |
| AI kill-switch | stable | yes | global on/off, audited; RAM-only unless durable opt-in | **OFF-by-default** |
| Dictation / STT | stable | yes | browser path is local; **Whisper path ships audio in plaintext over HTTPS** | **OFF-by-default** — *privacy/cost* |
| NL → canonical action | beta | yes | closed-vocab safe; **planner accuracy unbenchmarked; no rate-limit** | **OFF-by-default** — *safety* |
| Health / anomaly watch | stable | yes | pure rules, read-only autonomous actor; no ML thresholds | **ON / admin-choice** |
| Portfolio copilot | stable | yes | Q&A model call is read-only, egress-scoped, injection-hardened; the chat surface also offers action-invocation via the SAME NL→action planner + confirm gate as the command palette (backlog #134); **hallucination/accuracy untested; no token budget; every message costs a planner call before Q&A** | **OFF-by-default** — *safety/cost* |
| Switch-scan (a11y) | stable | yes | **no live-region announcement of the highlighted control** | **ON** (accessibility) |
| User a11y prefs | stable | partial | localStorage cache unencrypted; prefs not in audit log | **ON** (accessibility) |
| Governance log | stable | partial | **RAM-only ring buffer (200), lost on restart** — compliance gap | core (admin) |
| Copilot personas | prototype | partial | feature-gated; no selection-logic tests | preview |

**Top AI/tools debt:** (1) governance log is ephemeral (RAM-only) — a SOC2/audit gap; (2) NL→action
planner has no accuracy benchmark, fallback, or rate-limit; (3) Whisper dictation egresses plaintext
audio — document on-device mode for sensitive contexts; (4) switch-scan lacks screen-reader
announcements; (5) personas remain prototype.

---

## 4. Platform / infrastructure (mostly CORE — not gateable)

| Area | Maturity | Tests | Key debt | Gating role |
| --- | --- | --- | --- | --- |
| Auth (OIDC/OAuth2/SAML, CSRF, HMAC seam, step-up, revocation) | stable | yes | **session cap is per-replica RAM** | **CORE** |
| Broker plane (router, per-kind routing, vendor profile) | stable | yes (44) | multi-kind **decision logic done, per-kind adapter instances not wired**; malformed vendor rows now **fail-soft-repaired to contract shape** at the read seam by an always-on sanitizer (`broker/sanitizer.ts`) — also strips `__proto__`/`constructor`/`prototype` keys and surfaces an `X-OmniProject-Data-Repaired` signal | **CORE** |
| Backends catalogue (41) | stable + nominal | partial | ~7 real & tested; all 41 are `catalogued` (built from public docs), **none yet `verified` against a live instance** (see `lib/backend-catalogue/vendors/README.md`); **SQL/Mongo sidecars untested against real DBs**; >15 nominal references | core (real) / optional (nominal, admin) |
| Notification channels | beta | yes | MQTT/MCP nominal; Slack/Teams/Discord/webhook/SMTP real (`sendMagicLink` uses real SMTP via `nodemailer` once `SMTP_URL` is set, falling back to log-only) | optional — MQTT/MCP **OFF**, chat/SMTP **ON if configured** |
| Config-as-JSON + crypto + durable state | stable | yes | **settings store per-replica RAM** (fleet changes don't propagate); audit-chain head in-RAM unless file set | **CORE** |
| Dev mode / debug bundle | beta | yes | hard-gated to non-prod; dev-persist per-instance | optional — **OFF in prod** — *safety* |
| Capability / field manifest | stable | yes | no runtime drift detection (re-import to refresh) | **CORE** |
| Read cache / single-flight | stable | yes | single-flight always-on; read cache opt-in TTL | single-flight CORE; cache optional (**OFF**) |
| Raw API escape hatch | stable | yes | gated + step-up + admin | optional — **OFF** — *safety* |

> **Correction vs the agents' parked view:** the **benefits (E1)** and **CapEx/OpEx (E2)** field groups and
> their reports are now **shipped** (PRs #281/#282) — they are no longer parked, and neither is **SMTP
> C4** (real email sending — see PARKED-DECISIONS.md §C4). Remaining parked items (first-party backend
> A1, hosted A2, mTLS/FIPS A3, distroless B0, cosign B1, gitleaks B2, stage-gates E3) stay in
> `PARKED-DECISIONS.md`.

---

## 5. Cross-cutting "biggest debt" shortlist (impact-ranked)

1. **Per-replica RAM registries** (session cap, settings, audit-chain head, presence rooms, governance
   log) don't share across a fleet — correctness/compliance risk at >1 replica. Fix: adopt the existing
   `sharedState` seam (Redis-backed when `REDIS_URL` set). *Known-parked (TECH-DEBT §2).*
2. **SQL / MongoDB sidecars untested against real databases** — admin-only, but a parameterisation bug
   could corrupt a customer DB. Needs real-instance smoke tests. *Known-parked (TECH-DEBT §1).*
3. **No resource quotas** on config-bundle arrays (saved views, dashboards) or on presence connections /
   predictive-prefetch volume — DoS / cost-blowout surface. Add caps + metrics.
4. **Silent truncation / volatile-store data-loss** in several reports — add pagination and quota
   warnings so insight isn't quietly dropped.

**Assurance — "declared == built" is now enforced.** The catalogue↔implementation drift that hid six
unrendered reports is closed by the **report-coverage guard** (`guard-report-coverage`, in the CI verify
job): every report in the catalogue must map to a real, page-wired, tested component (or be classified as
surfaced via another plane), and the map can't carry stale entries — so a new report fails CI until it's
built and tested. The guard core (`scripts/src/lib/coverage.ts`) is generic; adding another hand-wired
plane is one more `checkCoverage(...)` call. Data-driven planes (screens/views/methodologies) stay
declared==built by construction through their generic renderers.

Test **quality** (not just presence) is separately gated by **StrykerJS mutation testing** over the
financial-derivation core (`artifacts/omniproject/stryker.conf.json`, `docs/MUTATION-TESTING.md`), run
**weekly** in CI (`.github/workflows/mutation.yml`) — scoped to the money math, not per-PR — so a
surviving mutant flags a test that would still pass if the derivation were wrong.

---

## 6. Default-gating summary (input to the org→programme→project model)

**ON by default** (cheap, safe, valuable): all stable reports; grid, savedViews, myWork, dashboards,
sidePanel, globalSearch; health-watch; switch-scan + a11y prefs.

**OFF by default** — seeded at the org level, admin opts in:

| Feature | Reason class |
| --- | --- |
| predictivePrefetch, presence, odata, integrations | **cost** (broker-call multiplier / SSE / BI egress) |
| Portfolio Trends, read cache | **storage** (client quota) / staleness |
| Time Travel, dictation/Whisper, copilot, NL→action, tools/egress, AI kill-switch default, raw API, dev mode | **safety / privacy / cost** (egress, paid providers, unproven accuracy, impersonation) |
| SMTP / MQTT / MCP notification channels | **cost / ops** (external relay config) |

Everything not listed as OFF defaults ON, per the policy.
