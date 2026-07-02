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

### A3. mTLS for the gateway↔broker seam; FIPS-validated crypto mode
**What:** mutual-TLS between gateway and broker (today: PSK + per-session HMAC), and a FIPS-mode for
gov.
**Why parked:** needs a certificate-management strategy (mTLS) and a validated crypto module choice
(FIPS) — both infra/policy decisions.
**Recommendation:** offer mTLS as an optional hardening for high-assurance deployments; treat FIPS as
demand-driven (only if a gov deal needs it).

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
