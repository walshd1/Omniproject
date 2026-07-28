# IAM & Security — best-in-class assessment

> Companion to `docs/FEATURE-ROADMAP.md`, applying the same competitive-gap lens to **user / role
> management and security**. Unlike the PPM feature areas, IAM + security is already at or near
> best-in-class and structurally enforced (CI guards + coverage ratchets), so this is a *confirm-the-moat,
> then a focused gap wave* assessment — not a rebuild. Sourced from a read of the live tree; file
> references are indicative anchors, not a contract.

## Where OmniProject already leads (context — NOT gaps)

**Authentication.** OIDC (Auth Code + PKCE), SAML 2.0, generic OAuth2, passwordless magic-link, native
local scrypt, read-only (optionally programme-scoped) API tokens, and a self-closing first-admin
bootstrap — all funnelled through one `establishSession()` seam. Sessions are **sealed AES-256-GCM +
signed httpOnly cookies** (not JWTs), with idle + absolute timeout, key-version + per-user revocation,
rotating-token **fork/replay detection (assume-breach → fleet-wide revoke)**, a concurrent-session cap,
and impossible-travel checks. (`api-server/src/routes/auth.ts`, `lib/session-*.ts`, `lib/session-crypto.ts`.)

**Step-up / re-auth.** Genuine per-method round-trip (OIDC `prompt=login`+`max_age=0` with `auth_time`
verify, SAML `ForceAuthn` bound to the same `sub`, WebAuthn passkey assertion), a 5-minute freshness
window invalidated by impossible-travel, gating locks, key-revoke, raw-SQL, role-map, custom-roles, and
config export. (`lib/step-up.ts`, `lib/passkey.ts`.)

**RBAC.** A deliberately **fixed, statically-verifiable** model: a linear base ladder
(`guest < viewer < contributor < manager < programmeManager`) **plus two orthogonal authorities**
(`pmo` = business governance, `admin` = technical config — neither implies the other), with hardware/
phishing-resistant **strong-auth withheld-by-default for the authorities**. The admin-editable role-map
*cannot invent a role or permission*; custom roles are **hard-capped at a base role**; capability
governance is a tri-state (`off`/`user-defined`/`public`) **default-deny** capability × surface matrix;
scoped overrides are **tighten-only**; sensitive ops require dual-control/four-eyes; and AI/automation
authority is a **default-deny, time-boxed, capped autonomous grant**. (`lib/rbac.ts`,
`lib/custom-roles.ts`, `lib/capability-governance.ts`, `lib/scope.ts`, `lib/ruleset-scope.ts`,
`lib/autonomous-grant.ts`.)

**Provisioning & identity.** Full **SCIM 2.0** (Users + Groups, Okta + Entra PATCH encodings,
deprovision-at-gate), a scoped **guest portal** (`read`/`comment`, one project, curated fields), and
cross-instance **federation**. Group-first assignment throughout.

**Security posture.** SLSA build-provenance + SBOM **attestations**; **promote-by-digest + admission**
enforced at three fail-closed layers (in-process boot gate, k8s init container, native
`ValidatingAdmissionPolicy` requiring digest-pinned images); a **signed migration runner**;
**hash-chained, optionally Ed25519-anchored, audit**; AES-256-GCM at-rest sealing with **KMS/BYOK** +
pluggable vault (HashiCorp / AWS / Azure / HTTP / local); a CI **zero-at-rest guard** forbidding any
persistence layer above the south seam; comprehensive **SSRF/egress** defense with data-residency; the
ratcheted **three-lane write model** + IDOR route-scope ratchet; prototype-pollution stripping;
CSP/CORS/CSRF/HSTS; and CI security (CodeQL, semgrep, gitleaks, dependency-advisory-block, mutation
testing). Documented in `SECURITY.md`, `docs/THREAT-MODEL.md`, `docs/SUPPLY-CHAIN.md`, and companions.

## Deliberate architectural stances (state so nobody "fixes" them)

- **Single-tenant per deployment + federation** — no shared-DB `tenantId` column by design.
- **Group-first assignment** — no per-individual grants; the overlay owns no user directory, so identity
  lives in the IdP/SCIM and grants attach to groups.
- **RBAC as defence-in-depth** — the gateway tier is coarse; the brokered systems-of-record re-enforce on
  every write with the user's forwarded token.

## Gap analysis — ranked, classified by lane

**In-lane** = pure functional-core engine / governed record / CI guard (the catalogue pattern; high fit).
**Out-of-lane** = IdP feature, CI/infra, or SPA surface (valuable, but a different kind of work).

| # | Gap | Severity | Lane |
|---|-----|----------|------|
| **S1** | **No ABAC / policy-expression language** — authz is coarse role tiers; no "allow if `resource.status=X ∧ scope=Y ∧ time<Z`". `predicate.ts` already exists (powers rules + stage-gate criteria) and can be reused for an authorization-policy evaluator. | High | **In-lane (pure)** |
| **S2** | **No access-review / recertification** — no periodic "confirm these people still need admin" campaign (a SOC 2 / ISO 27001 staple). | High | **In-lane (pure)** |
| **S3** | **No separation-of-duties (SoD) conflict detection** — dual-control exists per action, but nothing flags "same principal both creates and approves". | High | **In-lane (pure)** |
| **S4** | **No fine-grained per-action × per-resource human permissions** (`issue:delete` vs `issue:read` as grantable). Partly mitigated by per-collection edit floors + capability governance. | Medium-High | **In-lane** |
| **S5** | **No human-to-human delegation** ("act as my delegate while I'm on leave", time-boxed). | Medium | **In-lane** |
| **S6** | **Authz is imperative per-route** (coverage by test, not by construction) — no declarative route→required-grant manifest + verifier. | Medium | **In-lane (guard)** |
| **S7** | **No app-native TOTP / SMS second factor** — MFA is IdP-`amr`/passkey only (fine for strong-IdP orgs; a gap for local-auth deployments). | Medium | Out-of-lane (IdP) |
| **S8** | **No device/session inventory surface** ("manage my devices" + revoke). Sessions are tracked by salt but not surfaced. | Medium | Out-of-lane (SPA + route) |
| **S9** | **No in-CI container-image CVE scan** (Trivy/Grype); gitleaks binary unpinned; mutation testing not extended to crypto/auth. SBOM is generated but not scanned in-pipeline. | Medium | Out-of-lane (CI) |
| **S10** | **SAML coded but the runtime library is not installed** (inert by default) — a packaging/docs decision, not a design gap. | Low | Out-of-lane (packaging) |

## Proposed programme — "Security & IAM" wave

Same discipline as the P3M catalogue-engine lane: **one PR per slice**, pure functional-core below the
broker seam, deterministic tests (no `Math.random`/`Date`), guarded divides / fail-closed decisions,
reuse-over-duplicate, auto-merge per slice. The in-lane slices, sequenced by leverage:

- **Slice 1 — Authorization-policy (ABAC) engine (S1).** A pure evaluator
  `(principal, action, resource, context) → { decision, reason }`, **reusing `predicate.ts`** for the
  condition matrix; deny-by-default, deterministic, empty ⇒ deny. The substrate the later slices lean on.
- **Slice 2 — Access-review / recertification engine (S2).** Pure: a grant snapshot + last-reviewed
  timestamps → a recertification worklist, stale-privilege flags, per-reviewer batches; guarded, empty ⇒ empty.
- **Slice 3 — Separation-of-duties conflict engine (S3).** Pure: role/grant assignments + an SoD policy
  set → ranked conflict findings (mirrors the stage-gate / health-score result shape).
- **Slice 4 — Human delegation grant (S5).** A governed, time-boxed, scoped, audited, capped delegation
  record + resolver, mirroring `autonomous-grant.ts` (humans still pass normal RBAC; this only *adds* a
  bounded temporary grant).
- **Slice 5 — Declarative route→grant manifest + verifier guard (S6).** Turns coverage-by-test into
  coverage-by-construction, in the isolation-guard family — fits the repo's "statically verifiable" ethos.
- **Slice 6 (larger, optional) — fine-grained human permission matrix (S4).** Only if the buyer bar
  demands per-verb human grants; templated on capability-governance.

**Out-of-lane (hand to a CI/infra + SPA lane):** S7 (TOTP/SMS), S8 (device inventory), S9 (Trivy +
gitleaks pin + mutation scope — a half-day of workflow edits with outsized audit value), S10 (install the
SAML lib). These are tracked here but are not part of the pure-functional-core wave.

## Status

**Wave complete — all in-lane engines delivered and merged as pure functional cores.**

> **Enforcement status — read this before citing the table as "controls in force."** Slices 1–4 shipped
> as **pure catalogue engines with unit tests but no runtime consumer**: `authz-policy.ts`,
> `access-review.ts`, `separation-of-duties.ts` and `human-delegation.ts` are **not imported by any route
> or `app.ts`** (verified: zero non-test importers outside the catalogue). Runtime authorization is still
> the imperative `requireRole` / `requireAnyRole` ladder (`lib/rbac.ts`, used across ~90 route files), and
> no request-time decision consults the ABAC/SoD/access-review/delegation engines yet. **Only Slice 5**
> (the route→grant manifest + fail-closed CI guard) is a **live, enforced** control. So these engines are
> "built and ready to wire," not "in force" — a SoD conflict or a failed recertification detects/decides
> nothing at request time today. Wiring each engine to an enforcement path is the follow-on work.

| Slice | Gap | Deliverable | Wiring | PR |
| --- | --- | --- | --- | --- |
| **1 ✅** | S1 | ABAC authorization-policy engine (`authz-policy.ts`, reuses `predicate.ts`) | engine only — no runtime consumer | #913 |
| **2 ✅** | S2 | Access-review / recertification engine (`access-review.ts`) | engine only — no runtime consumer | #914 |
| **3 ✅** | S3 | Separation-of-duties conflict engine (`separation-of-duties.ts`, reuses the severity vocabulary) | engine only — no runtime consumer | #915 |
| **4 ✅** | S5 | Human delegation grant (`human-delegation.ts`, the human analogue of `autonomous-grant.ts`) | engine only — no runtime consumer | #916 |
| **5 ✅** | S6 | Declarative route→grant manifest (`route-auth-manifest.ts`) + fail-closed verifier guard (`guard-route-grants.ts`, wired into CI) | **live / enforced in CI** | #917 |

**S4 (fine-grained per-action × per-resource human permission matrix) — deferred (optional).** It is
already partly mitigated by per-collection edit floors + capability governance, and the ABAC engine (S1)
now covers the high-value "allow if resource/scope/time predicate" cases declaratively. A full grantable
`verb:resource` matrix is a larger surface (schema + admin UI + migration) whose buyer value did not clear
the bar for this pure-core wave; revisit only if a concrete buyer requirement lands.

**Out-of-lane (S7–S10) — NOT part of this lane.** S7 (app-native TOTP/SMS second factor), S8 (device/
session inventory SPA surface), S9 (in-CI Trivy/Grype CVE scan + gitleaks pin + mutation scope), S10 (install
the SAML runtime library) require CI/infra, SPA, or packaging changes outside this backend pure-core lane
and are handed off with the assessment above as their brief.
