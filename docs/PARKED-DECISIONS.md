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

## D. Already covered / not needed (recorded so we don't re-litigate)

- **Web security headers** — already comprehensive (CSP+nonce, HSTS+includeSubDomains, COOP,
  `frame-ancestors`, nosniff, Referrer-/Permissions-Policy, CSRF). No work needed.
- **Magic-link account enumeration** — already mitigated (always answers `ok`).
- **Data map / DSAR / retention / backup / DR** — already in `ENTERPRISE-OPS.md`.
- **Component SBOM + compliance / threat-model / privacy / VPAT docs** — **built** this round
  (see the CHANGELOG).
