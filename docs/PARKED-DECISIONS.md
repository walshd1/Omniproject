# Parked decisions

Items surfaced by the enterprise / cybersecurity / SME-charity gap review that need a **maintainer
decision** (architecture, positioning, business, or infrastructure) before building — so they're
parked here for us to go through together, rather than guessed at. Everything that *didn't* need a
decision has been built and merged.

Each item: what it is, why it's parked, and the recommended call.

---

## 0. Stateful-data policy (the rule that governs every item below)

The default is unchanged: **stateless, zero-at-rest overlay**. Where a feature seems to *need* state,
apply this ladder **in order** and stop at the first rung that works:

1. **Can it be code or a JSON import?** Do that. No persistence. *(All four enterprise reports shipped
   so far — Monte Carlo, Portfolio Roadmap, Critical Path, plus the dependency overlay — live here:
   they derive over the read model or a user-supplied JSON bundle and store nothing.)*
2. **Is it just transient state memory?** Hold it **ephemerally** — write only when there is a specific
   need, and **delete the moment the state changes**. Browser-session/volatile, never the server.
3. **Must it truly persist?** Then: **encrypted by default** (config-crypto AES-256-GCM), kept for the
   **shortest necessary lifetime**, and the end-goal is always **write-back to the customer's own
   backend via the broker**. OmniProject is the courier, never the system of record. No new database.
4. **If customer *data* values must be held at all**, never store them legibly. Each value is abstracted
   as **`{ hash(field), hash(vendor), hash(column), value }`** and then **encrypted** — so a leaked
   file reveals neither the schema it came from nor which system/column it maps to. The customer owns
   the data and the key; OmniProject makes **no warranty** and stores nothing it isn't told to.

**Consequence for stage-gates (E3 below):** the gate *model* is rung 1 (code/JSON); advancing a gate
**writes the status straight back to the backend field via the broker** (rung 3's end-state — no local
store at all); only if a customer enables that screen with *no* backing field do we fall to a rung-2/4
encrypted, short-lived, hash-abstracted local record. Default off, customer-owned, disclaimed.

---

## A. Architecture / positioning

### A1. First-party lightweight backend ("built-in projects")  ⚑ biggest market lever
**What:** a small, first-party store so a tiny org with **no** existing PM tool (and no Jira/n8n) can
use OmniProject standalone. Today the demo broker is sample-data-only; durable persistence exists in
*dev* mode but there is no real standalone backend.
**Why parked:** it directly tensions with the core **"stateless, zero-at-rest overlay"** identity — a
first-party backend *does* store customer data at rest. That's a positioning decision, not a coding
one.
**Recommendation:** build it, but framed honestly as **"OmniProject can also *be* a (small) system of
record"** — a separate, clearly-labelled backend module that stores its own data (encrypted at rest
like config), distinct from the stateless *overlay* role. It's the single biggest unlock for the
SME/charity segment. Needs your yes/no on shipping a first-party data store.

### A2. Managed / hosted offering (or one-click deploy)
**What:** a hosted tier or marketplace one-click deploys (Render/Railway/Fly/DO), since self-host is a
hard barrier for charities.
**Why parked:** business model + infrastructure + ongoing-ops decision.
**Recommendation:** at minimum publish one-click deploy templates; a managed tier is a bigger
commitment to weigh.
**Status:** platform comparison done — Railway is the strongest first target (only one of the four
that imports an existing `docker-compose.yml`-shaped stack directly, plus existing community
templates for both n8n and Authentik). A manual, hands-run recipe is written up at
`docs/ops/RAILWAY-DEPLOY.md` (Tier 1: omni-shell + n8n, demo auth accepted — the actual "no IT
person, no SSO to configure" target; Tier 2: real per-user logins via Authentik). Tier 2 now has an
actual config-as-code path, not just a sketch: `deploy/railway/` ships `railway.json` files for
omni-shell and for a custom Authentik image (`deploy/railway/authentik/Dockerfile`) that bakes in
the OmniProject OAuth-app blueprint at build time — solving the one real gotcha (Railway has no
bind-mount equivalent for the read-only blueprint mount `docker-compose.standalone.yml` uses).
Turning either tier into a real "Deploy on Railway" button still needs a maintainer to run it once
in their own Railway account and use Railway's "Create Template" action — that URL can't be
predicted or fabricated in advance.

### A3. mTLS for the gateway↔broker seam; FIPS-validated crypto mode
**What:** mutual-TLS between gateway and broker (today: PSK + per-session HMAC), and a FIPS-mode for
gov.
**Why parked:** needs a certificate-management strategy (mTLS) and a validated crypto module choice
(FIPS) — both infra/policy decisions.
**Recommendation:** offer mTLS as an optional hardening for high-assurance deployments; treat FIPS as
demand-driven (only if a gov deal needs it).

### A4. Native mobile app (App Store / Google Play listing)
**What:** a real installable, store-listed mobile app, beyond the PWA that already ships today
(`lib/pwa.ts` — installable, app-shell-only offline caching, zero-at-rest preserved). The codebase
already reserves a `nativeBridge` capability flag (`lib/platform.ts`) for exactly this, naming
Capacitor as the anticipated wrapper — this isn't a new architectural choice, just finishing one
already started.
**Why (the same itch, not a bolt-on feature):** README's "Why OmniProject exists" names three
things — tool sprawl, nobody trusting a second copy of their data, and migration risk killing the
project before it starts. Mobile is where tool sprawl bites hardest: the head-of-projects checking
status between meetings, away from a laptop, is exactly who ends up opening five apps on a phone to
piece together "where do things actually stand." A native listing doesn't change what OmniProject
*is* to answer that — it's still a live window onto the tools already run, never a fourth (or fifth)
place data lives. That's precisely why Capacitor (wrap the existing SPA) was the right call over a
from-scratch React Native/Expo rewrite: the zero-at-rest promise is a property of the *web app*
(`pwa.ts`'s app-shell-only caching — nothing project-specific ever touches the device), and wrapping
it natively inherits that property for free rather than requiring it be re-earned in a parallel
codebase. The only things a store listing genuinely adds are discoverability (an icon and a listing
non-technical stakeholders recognise as "a real app," not a bookmarked browser tab) and OTA update
plumbing (§ below) — not a second architecture to keep honest.
**Why parked:** app-store accounts, code signing/CI, and ongoing store-compliance upkeep are a real
ongoing-ops commitment, same category as A2.
**Status:** tooling researched. **Ionic Appflow (the "batteries-included" Capacitor build/submit
service) was discontinued for new customers in Feb 2025** — existing customers only, support ends
Dec 31 2027 — so it's not a viable foundation to build on now. The live path is **Capacitor +
Fastlane** (the open-source iOS/Android build-and-submit CLI, unaffected by Appflow's shutdown) run
on a CI that already understands mobile builds — **Codemagic** is the natural Appflow successor
(free tier, purpose-built for Capacitor/Ionic) since Apple's toolchain (Xcode/codesign) is Mac-only
and can't run on ordinary Linux CI. If OTA updates (shipping JS/asset bundle fixes without a full
store review) are wanted later, **Capgo** (`@capgo/capacitor-updater`) is the actively-maintained
open-source successor to Appflow Live-Update — it only ships static bundle diffs (no user/app data),
matching `pwa.ts`'s app-shell-only posture, and should be **self-hosted** rather than pointed at
Capgo's cloud to keep "nothing leaves your infra" fully intact.
**One real gotcha:** app-store listings require privacy disclosures (Apple's Privacy Nutrition
Label + `PrivacyInfo.xcprivacy` manifest — which Apple explicitly lists Capacitor itself as
requiring; Google's Data Safety form) regardless of self-hosting, since they ask what the *app*
collects, not where it's stored. Not a blocker, but a tripwire: adding any crash-reporting/analytics
SDK later would force new disclosures neither Capacitor nor Fastlane require today.
**Recommendation:** prototype Capacitor + Fastlane on Codemagic's free tier before committing
further; defer OTA (and self-host it via Capgo, not their cloud) until genuinely needed.

---

## B. Supply chain / release (infra + policy)

### B0. Distroless runtime image + seccomp profile
**What:** swap the runtime base from `node:22-bookworm-slim` to a **distroless** (or Chainguard) image
and add a seccomp/AppArmor profile — the last-mile reduction of attack surface on top of the existing
read-only-fs / cap-drop / non-root posture.
**Why parked:** distroless has **no shell and only the `node` binary**, so the compose
`["CMD","node","-e",…]` healthchecks depend on `node` being on the image's `PATH`. CI's image-smoke
boots the container but does **not** exercise the *compose healthcheck*, so a wrong assumption could
break `docker compose up` (dependents never start) without CI catching it. Needs a real `compose up`
to confirm (and possibly absolute-path the healthchecks).
**Recommendation:** do it together with one `compose up` to validate the healthcheck path; low effort,
real hardening once confirmed.

### B1. Container image signing + SLSA provenance (cosign)
**Why parked:** requires deciding to **publish the image to a registry** (e.g. GHCR) and granting CI
`packages: write` + `id-token: write`. See [`SUPPLY-CHAIN.md`](./SUPPLY-CHAIN.md) §Parked.
**Recommendation:** yes once you confirm the registry; it's a small CI addition after that.

### B2. Secret-scanning gate (gitleaks) tuning
**Why parked:** the repo has intentional test fixtures that look like secrets; a blocking gate needs a
tuned allowlist to avoid false positives — best done in one watched iteration. Also: turn on GitHub's
native **secret scanning + push protection** in repo settings (zero-config).
**Recommendation:** do the allowlist together; enable native push-protection now.

### B3. Signed release tags + the 0.7.0 release itself
**Why parked:** releasing is maintainer-owned (you tag/publish). Draft is ready in
[`RELEASE-NOTES-0.7.0-DRAFT.md`](./RELEASE-NOTES-0.7.0-DRAFT.md).

---

## C. Market fit (SME / charity) — content & business

### C1. Charity/non-profit licensing tier
**What:** a clear free/discounted tier. The premium/licence machinery exists; the **offer** needs
defining.
**Why parked:** pricing/business decision.

### C2. i18n locale breadth
**What:** the i18n framework + translation layer ship; non-English locale **content** is limited.
**Why parked:** needs a decision on **which languages** to prioritise and human-quality translations.
**Recommendation:** pick the top 3–4 languages for your target NGOs; the framework is ready.

### C3. Self-hosted web font (privacy / air-gap / CSP cleanliness)
**What:** bundle JetBrains Mono as a static asset instead of the Google Fonts `<link>`, removing a
third-party request (better for privacy, charities, air-gapped, and a cleaner `font-src 'self'` CSP).
**Why parked:** needs the woff2 font files committed (couldn't fetch them in the build sandbox) and a
licence check (JetBrains Mono is OFL — fine to bundle).
**Recommendation:** straightforward once the font files are added; low effort, real privacy win.

### C4. Real email sending (magic-link without n8n)
**What:** `sendMagicLink` is currently a **stub** (it logs the link); an SMTP sender would make
passwordless sign-in actually work for a small org — a real charity unlock (most have Google
Workspace / Microsoft 365 SMTP).
**Why parked:** needs an SMTP client **dependency** (e.g. nodemailer) whose **esbuild bundling** into
the self-contained runtime needs verifying (dynamic requires / optional deps), and SMTP can't be
end-to-end tested in the build sandbox. Credentials would come from env (`SMTP_URL`), never stored.
**Recommendation:** add nodemailer + a small `lib/email` (env-config, disabled when unset), verify the
bundle, then wire `sendMagicLink`. Worth doing — just wants a watched first build.

---

## E. Enterprise analytics — the "implement whatever you can statelessly" round

**Shipped (stateless, rung 1 — derive-only, nothing stored):**
- **Monte Carlo schedule/effort risk** — `lib/monte-carlo` + `MonteCarloRisk` (PR #277).
- **Portfolio Roadmap** — cross-programme timeline, `lib/roadmap` + `PortfolioRoadmap` (PR #278).
- **Critical Path (CPM)** — forward/backward-pass solver, `lib/critical-path` + `CriticalPath` (PR #279).

The rest of the enterprise-EPM gap needs **fields the canonical model doesn't carry**, or a stateful
decision — so they're parked here rather than guessed:

### E1. Benefits realisation tracking
**What:** planned-vs-actual benefit curves, benefit owners, realisation dates — the "did the programme
deliver value" view boards ask for.
**Why parked:** there is **no canonical benefit field** (the registry has cost/effort/schedule, not
benefits). It can't be derived from what backends expose today.
**Recommendation:** either (a) **extend the field registry** with a `benefits` group (planned/actual
value, realise-by date, owner) gated on a backend that can carry them — the clean, stateless route; or
(b) accept benefits as a **JSON import** (rung 1) the user maintains and we visualise. (a) is the right
long-term call; needs your yes on adding the field group.

### E2. Capitalisation (CapEx/OpEx) split + cost-rate roll-up
**What:** classify effort/cost as capital vs operating expense and roll up a blended cost using per-role
rates — finance-grade reporting large orgs need for the balance sheet.
**Why parked:** needs a **capex/opex classification field** and **role cost-rates**, neither canonical.
Deriving capex from a label convention would be guesswork.
**Recommendation:** add a small `finance` field-group extension (`capexOpex` enum, `costRate`) gated on
a costed backend; or take **rates as a JSON config import** (rung 1) and classification from a customer
field mapping. Wants your call on the field-group vs JSON-config route.

### E3. Stage-gate governance (PRINCE2 / phase-gate)
**What:** define gates (e.g. SOBC → OBC → FBC, or Discovery → Alpha → Beta → Live) and advance/hold a
project through them with an auditable decision.
**Why parked (the one feature that wants state):** the gate *model* is fine as code/JSON, but recording
*"this project is at gate 3, approved on date X by Y"* is state. Per **§0**, the answer is **write the
gate status back to a backend field via the broker** (e.g. a status/customField) — no OmniProject
store. Only the no-backend-field fallback needs the encrypted, short-lived, hash-abstracted local record.
**Recommendation:** build the gate model (JSON, like methodology packs) + a write-back action to a mapped
backend field; ship the local-store fallback **off by default**, encrypted, disclaimed, customer-owned.
Larger than a report and touches the write path — worth doing deliberately, not blind. Wants your go.

### E4. Dynamics 365 Finance & Operations connector — catalogued, not tenant-verified (backlog #141)
**What:** `dynamics365-fo` (`lib/backend-catalogue/vendors/backends/dynamics365-fo.json`) — a
capability-honest, catalogued read backend for D365 F&O's Project Management and Accounting module
(distinct from the existing `dynamics365` = Project Operations/Dataverse entry). Real F&O OData entities
(`ProjectsV2`, `ProjectTasks`, `ProjProposalCost`, `ProjCostTrans`), sourced and cross-checked against
Microsoft's Common Data Model schema docs. Full detail: `docs/vendors/DYNAMICS-365-FO.md`.
**Why parked (as "supported," not "catalogued"):** this environment has no live F&O tenant to test
against — same posture as SAP/NetSuite/Planview/Primavera already in the catalogue, all of which carry
a "confirm against your instance" caveat, just made explicit here because it's a brand-new entry rather
than an established one. Schema-valid, typechecked, passes the full bundled-backends stress harness, and
`generateWorkflow()` produces a real n8n scaffold — but no request has ever round-tripped a real tenant.
**Recommendation:** treat as catalogued/available-to-select, not marketed as "certified." Before calling
it supported: verify the entity names + `ProjectTasks` composite-key shape against a real environment's
`/data/$metadata`, confirm the Azure AD OAuth2 app-registration scopes, and run the generated workflow
against that tenant end-to-end.

---

## D. Already covered / not needed (recorded so we don't re-litigate)

- **Web security headers** — already comprehensive (CSP+nonce, HSTS+includeSubDomains, COOP,
  `frame-ancestors`, nosniff, Referrer-/Permissions-Policy, CSRF). No work needed.
- **Magic-link account enumeration** — already mitigated (always answers `ok`).
- **Data map / DSAR / retention / backup / DR** — already in `ENTERPRISE-OPS.md`.
- **Component SBOM + compliance / threat-model / privacy / VPAT docs** — **built** this round
  (see the CHANGELOG).
- **Gateway-side multi-instance data-broker fan-out (backlog #108)** — investigated and closed,
  not built. The ask: have the gateway itself hold *several distinct adapter instances of
  potentially the same kind* (e.g. two separate Jira-kind endpoints) and fan a single read across
  them in one request, merging by `qualifiedId`. What's already built and covers the real need:
  - **Cross-kind capability routing already exists and is intentionally single-target.**
    `connectedBrokers()`/`brokerForCommand()` (`artifacts/api-server/src/broker/registry.ts`)
    pick ONE connected broker *kind* per command/read (primary first, else the first kind that
    supports the required capability/transport) — e.g. n8n for the data hop, Make for outbound
    events. `connectedBrokers()` explicitly **dedupes by kind**: the registry has no concept of
    two simultaneous connections of the *same* kind, by design, not oversight.
  - **The existing same-kind pool (`BROKER_URLS`, and the `kind=url1|url2` form in
    `BROKER_ENDPOINTS`, see `artifacts/api-server/src/broker/router.ts` /
    `artifacts/api-server/src/broker/n8n/index.ts`) is a *horizontal-scale replica pool*, not a
    fan-out source list.** `webhookPool()`/`orderedTargets()` round-robin and fail over across the
    URLs on the assumption every entry is an identical instance of the *same* logical backend
    (redundancy/throughput), and pick exactly one per call. Repurposing it to mean "N distinct
    data sources, read all of them and merge" would silently break that existing horizontal-scaling
    contract (every listed URL would take live traffic on every read) for a case it wasn't built
    for.
  - **Merging genuinely distinct same-kind backends (e.g. two Jira orgs) is already the broker's
    job, one level below the seam, by architecture.** Per `docs/BROKER.md` and
    `docs/ARCHITECTURE.md`, the reference broker (n8n) runs "one workflow per backend" and is
    exactly the layer built to fan a request out to N backends, tag rows by `source`, and return
    ONE merged read model through the same uniform HTTP contract the gateway already consumes via
    a single adapter. The gateway is deliberately kept structurally incapable of knowing how many
    backends of a kind exist — that's the point of the seam (`getBroker()` / the `Broker`
    interface) — and the identity/merge machinery for that boundary already exists and is reused
    correctly there (`qualifyId`/`stampSource` in `artifacts/api-server/src/broker/identity.ts`).
    Duplicating that fan-out/merge logic gateway-side for same-kind instances would re-implement,
    above the seam, the exact job the broker/workflow layer already does below it — working against
    the "structurally incapable of knowing" boundary the architecture guard enforces
    (`broker-guard.test.ts`), for zero net new capability.
  - **Even the simpler, already-built piece is unvalidated by real use.** `routeBrokerCall()`
    (`artifacts/api-server/src/broker/router.ts`) — route ONE command to ONE specific connected
    kind's endpoint — has full test coverage (`router.test.ts`) but as of this investigation has
    **no production caller**; no route handler invokes it yet. Building the strictly harder
    same-kind multi-instance fan-out-and-merge on top of a single-dispatch mechanism that no real
    request path uses yet would be speculative abstraction stacked on unvalidated abstraction —
    against this codebase's explicit bias against building ahead of a demonstrated need.

  **Conclusion:** no genuine unmet need found. Cross-kind capability split (n8n for data + Make
  for events) is real and already built; same-kind multi-instance fan-out is not — it would
  duplicate the broker/workflow layer's job, collide with the existing replica-pool semantics, and
  has no concrete customer scenario behind it in the repo (no RFC, issue, or test asks for it).
  Closed without code; revisit only if a specific deployment surfaces a case the broker/workflow
  layer genuinely cannot handle (e.g. it cannot itself reach two same-kind backends for a hard
  network-segmentation reason) — which none of the current backends/docs describe.

## F. Vendor connectors catalogued but unverified against a live tenant

### F1. SAP S/4HANA (PS/PPM) financials read-only connector
**What:** `sap-s4hana-financials` (`lib/backend-catalogue/vendors/backends/sap-s4hana-financials.json`)
— a read-only connector reading SAP Project System/PPM cost-object financials (budget, actuals,
cost center) via SAP's published OData surface (`API_ENTERPRISE_PROJECT_SRV`, the CDS view
`I_ProjectActualCosts`, noting `API_FINPLANNINGDATA_SRV` for plan/budget and `CE_COSTCENTER_0001`
for cost-center enrichment). It passes every automated gate this repo has (schema, capability-honesty,
field-superset, typecheck, the n8n-generator producing a genuinely read-only scaffold) — but **no
S/4HANA tenant is available in this environment**, so none of that proves the exact OData paths,
`$select`/`$filter` fields, or service-catalog names match a real customer's release.
**Why parked (as "supported"):** this is not a design decision needing a maintainer call — it's a
factual gap (no live tenant to test against) that only real-world verification against SAP itself can
close. See `docs/vendors/SAP-S4HANA-PS-PPM.md` for the full detail and the verification checklist.
**Recommendation:** keep labelled "catalogued", not "supported", until a maintainer (or a design
partner with an actual S/4HANA sandbox) runs the workflow-verifier probe against a real system and
confirms/adjusts the field and service names.

---

## G. Self-service extensibility

### G1. Zero-restart activation of an admin-authored backend/vendor (backlog #137 follow-on)
**What:** backlog #137 asked for self-service custom-backend authoring in the admin UI, so a
customer's team can add a new vendor without a core-repo code change. **Investigated first, not
assumed:** the runtime-load half of this already existed (backlog #31) — `OMNI_CONFIG_DIR/vendors/
backends/*.json` is read at boot by `artifacts/api-server/src/lib/config-dir.ts`, validated against
the same embedded schema as the shipped catalogue, and merged over the defaults via the vendor
overlay (`lib/backend-catalogue/src/vendor-overlay.ts`, `registerVendor`/`withOverlay`) — so the gap
was genuinely just the missing authoring UI, not a missing persistence mechanism. **Shipped this
round:** `CustomBackendAdmin` (`artifacts/omniproject/src/components/settings/CustomBackendAdmin.tsx`
+ `artifacts/omniproject/src/lib/backend-authoring.ts`) — a guided, admin-gated form that builds a
`BackendManifest & N8nBinding` document, validates it against the *exact* schema the config-dir
loader enforces (`validateVendor("backends", …)`, shared unchanged), shows a live JSON preview, and
exports the file for the operator to place.
**Why the remaining gap is parked, not built:** exporting a file still requires an operator to place
it in the mounted config directory and **restart (or otherwise reload) the gateway process** —
`loadConfigDir()` only runs at boot. There is no live, admin-triggered "register this backend now,
no restart" path, and building one would mean either (a) an API endpoint that lets the SPA write
into the server's mounted filesystem — wrong direction for a stateless/zero-at-rest gateway whose
only persistence is the operator's own folder — or (b) a genuine **hot-reload mechanism** for the
backend catalogue (re-run `loadConfigDir()` and safely swap the in-memory overlay while requests are
in flight, plus decide what happens to a broker/workflow already wired against the old definition)
that doesn't exist today and touches more than this slice's scope.
**Recommendation:** if "no restart at all" becomes a real requirement, add a `POST /api/setup/
config-dir/reload` (admin, step-up gated like other config-mutating actions) that re-runs
`loadConfigDir()` in place — `registerVendor`'s overlay swap is already safe to call at runtime (it's
how tests exercise it), so the main new work is the endpoint + a UI trigger next to the existing
`GET /api/setup/config-dir` status read, not a new storage layer. Left undone here because it's an
operational/reload-safety decision (do in-flight requests see old or new definitions mid-swap?)
better made deliberately than bundled into a UI-authoring slice.
