# Parked decisions

Items surfaced by the enterprise / cybersecurity / SME-charity gap review that need a **maintainer
decision** (architecture, positioning, business, or infrastructure) before building — so they're
parked here for us to go through together, rather than guessed at. Everything that *didn't* need a
decision has been built and merged.

Each item: what it is, why it's parked, and the recommended call.

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

---

## D. Already covered / not needed (recorded so we don't re-litigate)

- **Web security headers** — already comprehensive (CSP+nonce, HSTS+includeSubDomains, COOP,
  `frame-ancestors`, nosniff, Referrer-/Permissions-Policy, CSRF). No work needed.
- **Magic-link account enumeration** — already mitigated (always answers `ok`).
- **Data map / DSAR / retention / backup / DR** — already in `ENTERPRISE-OPS.md`.
- **SMTP/email, distroless image, component SBOM, compliance/threat-model/privacy/VPAT docs** —
  **built** in this round (see the CHANGELOG).
