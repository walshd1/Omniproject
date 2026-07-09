# OmniProject 0.7.0 — release notes (DRAFT)

> **DRAFT for maintainer review.** This file is the proposed GitHub Release body for `0.7.0`. It is
> **not** a tag and **not** a published release — see *Publishing* at the bottom for the commands to
> run when you're ready. Nothing here tags or publishes anything on its own.
>
> Fill in the final version/date when cutting the release. The exhaustive, itemised list lives in
> [`CHANGELOG.md`](../../../CHANGELOG.md) under *Unreleased* — this is the curated, themed summary.

OmniProject is a stateless, zero-at-rest PM/PgM overlay gateway: an Express API + React SPA that puts
one consistent, governed, broker-agnostic surface over whatever project/work backends a customer
already runs. 0.7.0 is a large feature release that completes the **UX-parity** and **Phase 2 UX
polish** programmes, adds **real-time collaboration**, and hardens deployment, security and
observability — all without a hard breaking change for existing deployments.

## Highlights

- **Real-time collaboration (advisory).** See who else is on a work item and which field they're
  editing, live over Server-Sent Events — presence avatars and soft, TTL'd "X editing…" hints in the
  side-panel. It's ephemeral (nothing at rest) and **advisory only**: the hard guarantee stays
  optimistic concurrency (`Issue.version` → 409 → refresh), so there's no CRDT and no silent
  overwrite. Opt-out via the `presence` feature module.
- **UX parity with first-class PM tools.** A spreadsheet-style **editable grid** (bulk inline edit),
  **saved views**, **My Work / Inbox**, **custom dashboards**, a rich **side-panel**, and **global
  search** — each a toggleable feature module gated client- and server-side.
- **Phase 2 UX polish.** Optimistic edits with one-click **Undo**; a single **keyboard-shortcut
  registry** with a discoverable help overlay; consistent **skeleton loaders** that respect reduced
  motion; user-selectable **UI density** via design tokens; **recently-visited** items in search;
  and **swipe-to-dismiss** on touch — every affordance operable by both keyboard and mouse.
- **Accessibility, first-class.** Switch-access scanning, screen-reader narration and voice
  dictation, plus a per-user overlay (text size, colour, contrast, motion, density) that persists
  across sessions and devices on top of company branding.
- **Acceptance testing + CI guardrails.** A Playwright acceptance harness drives the real app in a
  browser; new drift guards enforce **keyboard/mouse parity**, **route coverage**, and
  **docker-compose deployment-safety** — on top of the existing broker-isolation and superset guards.

## What's new, by theme

### Collaboration & UX
- Live collaboration presence (avatars + advisory field locks) over SSE.
- Editable data grid, saved views, My Work / Inbox, custom dashboards, rich side-panel, global search.
- Optimistic edit + Undo; keyboard-first shortcuts + help; skeleton loaders; UI density tokens;
  recently-visited quick-find; mobile swipe gestures.

### Identity & access
- Multi-provider OIDC sign-in (branded per provider), generic OAuth 2.0 + PKCE, **SAML 2.0** SSO,
  passwordless **magic-link / email-OTP**, and a workspace-login wizard for charities/SMEs.
- Frontend RBAC aligned to the gateway's orthogonal role model; `pmo` authority throughout.

### Governance, AI safety & capability control
- Capability governance end-to-end: tri-state (off / user-defined / public) per AI capability,
  call-time enforcement, MCP + vendor enforcement, and an admin dashboard.
- AI governance + prompt DLP (opt-in, lean by default); portfolio copilot with methodology RAG
  personas; per-surface / per-role / per-backend approved-actions matrix.

### Security & non-repudiation
- Crypto hardening (`jose` for OIDC verification, HKDF key derivation), optional **Ed25519** signing
  of audit + provenance anchors, gateway↔broker request **HMAC** with replay protection, session
  idle + absolute timeouts, and the pentest-pass auth/abuse hardening.
- Zero-trust boundary validation; stricter TypeScript (`exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`).

### Platform, performance & ops
- Platform/capability detection, **mobile mode**, **PWA**, native-ready seam.
- HTTP compression (gzip/brotli), immutable static-asset caching, lighter first paint, a dev-mode
  performance overlay + Server-Timing.
- Optional **Redis-backed shared-state seam** for fleet-wide scale; data-residency / region routing
  (opt-in, fail-closed); a **docker-compose correctness guard** + audit (`docs/COMPOSE-AUDIT.md`).

### Architecture & quality
- Broker-neutral product surface — concrete vendor names purged from code, copy, routes and the API;
  one guard-enforced home per concrete broker.
- Whole-repo test-coverage iteration and dev-mode breadth so the entire codebase is observable.

## Upgrade notes

- **No hard breaking changes.** Existing deployments continue to work.
- **Broker endpoint env:** `BROKER_URL` is the current name; the legacy `N8N_WEBHOOK_URL` is still
  honoured as an alias (resolved in `lib/broker-url`), so no action is required — but prefer
  `BROKER_URL` (and `BROKER_URLS` / `BROKER_ENDPOINTS` for pools / per-kind routing) going forward.
- **New feature module `presence`** is **on by default**. To disable real-time presence, add it to
  `DISABLED_FEATURES` (env) or `settings.disabledFeatures` (admin panel), like any other module.
- **Stateless posture is unchanged:** the gateway still persists nothing locally; AI keys stay in the
  encrypted vault (or an external Vault/KMS), and presence is in-memory connection state only.

## Verification

Cut from a tree that is green on the full CI matrix: `verify` (typecheck + unit/integration tests +
coverage gates + drift guards), `e2e` (Playwright acceptance), `docker-image` (build + smoke-boot),
`accessibility` (axe-core WCAG 2.1 A/AA), `deploy-lint` (compose + k8s manifest) and
`dependency-scan`.

---

## Publishing (maintainer — do this yourself)

This draft does **not** tag or publish. When you're ready to cut the release:

1. Finalise the date and move the *Unreleased* block to a `## [0.7.0] — <date>` section in
   `CHANGELOG.md` (and add a fresh empty *Unreleased*).
2. Tag and push:
   ```sh
   git tag -a 0.7.0 -m "OmniProject 0.7.0"
   git push origin 0.7.0
   ```
3. Create the GitHub Release for tag `0.7.0`, pasting this file's body (minus this *Publishing*
   section) as the description.
