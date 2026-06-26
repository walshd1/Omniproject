# Egress & trust-boundary inventory

The "stateless asterisks" written down in one place — every point where data
leaves the stateless core, every durable-state concession, and the trust
boundaries. This is what a CISO/auditor asks for first, and what makes the
zero-data-at-rest claim *checkable* rather than aspirational.

> **Posture in one line.** OmniProject holds **no project data and no credentials
> at rest**. It reads through to the backend system of record on each request and
> renders the result. The items below are the *exceptions and the edges* — each is
> deliberate, named, and (where it's an egress) operator-gated.

---

## 1. Trust boundaries

```
Browser (SPA)
   │  session cookie (HttpOnly, signed with SESSION_SECRET) + OIDC access token
   ▼
OmniProject gateway  ── stateless; owns RBAC gates + audit, NOT authorisation ──
   │  forwards the USER's own token; never a shared admin key
   ▼
Broker (n8n reference / any binding-speaking sidecar)
   ▼
Backend system of record (Jira / OpenProject / SAP / …)  ── owns authorisation ──

   ▲
   └── IdP (Authentik / enterprise SSO) authenticates the user; the backend authorises.
```

- **The gateway is not an authority.** Its RBAC (`viewer/contributor/manager/admin`,
  via OIDC claims) gates *OmniProject's own* actions; the backend still authorises
  every write against the user's forwarded token.
- **SESSION_SECRET** signs session cookies; the gateway **fails fast** in
  production if it is unset/empty/default (deploy-guard test D).

---

## 2. Egress points (where data leaves the core)

| # | Egress | Path / control | Data class | Default |
| --- | --- | --- | --- | --- |
| E1 | **Broker hop** | gateway → `BROKER_URL`/`BROKER_URLS` → backend | Project/issue data **in transit** (never at rest) | **On** (the product) |
| E2 | **Logging sync** (time-travel history) | `LOGGING_SYNC_URL`; `loggingSync` | Point-in-time portfolio snapshots — the **one durable** concession | **Off** (opt-in) |
| E3 | **OData / Power-BI** | `routes/odata.ts` | Read-only BI projection of portfolio data | Gated (BI token) |
| E4 | **FX rates read-through** | `FX_RATE*`; `lib/currency.ts` | Outbound to an FX provider; **no** project data sent | On (read-only, falls back to indicative) |
| E5 | **AI provider** | `AI_PROVIDER`; `routes/ai.ts` | Whatever the user asks the assistant about | **Off** unless configured |
| E6 | **Notifications** | `routes/notifications-stream.ts`, `webhooks.ts` | Inbound ingest + outbound HMAC-signed events | Gated |
| E7 | **Exports** | server `routes/export.ts`; client lineage CSV/JSON | Exactly what the user exports, user-initiated | On (user action) |
| E8 | **IdP / OIDC** | `OIDC_ISSUER_*` | Authentication only; identity, not project data | On (auth) |

**Never egressed / never stored:** backend credentials, the delegator's token
(delegation is design-only and explicitly refuses this — RFC-004/005), and raw
project data at rest in the gateway.

---

## 3. Durable-state concessions (the "asterisks")

Statelessness has exactly these deliberate exceptions; everything else is
request-scoped and gone at the end of the response:

| State | What | Why it's acceptable |
| --- | --- | --- |
| **Settings store** (`lib/settings.ts`) | Gateway **config** — broker URL, backend source, capability/field overrides, time-travel toggle | Config, **not project data**; admin-gated to write |
| **Logging server** (E2) | Snapshots, *outside* the gateway | Opt-in egress; the operator owns that store and its retention |
| **Read cache** (`lib/read-cache.ts`) | Optional short-TTL read memoisation | **Off by default**; ephemeral, in-process, nothing across a restart |
| **Delegation denylist** (*future*) | A `jti`/hash fingerprint set for instant revoke | **Not built**; design stores a one-way hash only (no identities) |

---

## 3a. Egress hardening controls

| Control | What it does | Knob |
| --- | --- | --- |
| **SSRF guard** (`lib/egress.ts`) | Every gateway outbound request is validated first. Link-local / cloud-metadata targets (169.254.0.0/16, IPv6 link-local, `metadata.google.internal`, `fd00:ec2::254`) and non-http(s) schemes are **always blocked** — the Capital-One pattern can't happen through the app. Internal/localhost hosts stay allowed (the broker lives there). | `EGRESS_ALLOWLIST` (optional) pins outbound to an exact host list |
| **CSV-injection guard** | Exported CSV cells beginning with a formula trigger (`= + - @` / tab / CR) are apostrophe-prefixed, so attacker-influenced backend values can't execute when the file opens in Excel/Sheets (`lib/csv.ts`, SPA `lib/data-lineage.ts`). | — |
| **Startup security self-check** (`lib/security-check.ts`) | At boot, dangerous *production* config combinations are logged at severity (e.g. prod with no OIDC = demo auth = everyone admin). | `SECURITY_STRICT=on` refuses to boot on a CRITICAL finding |

## 4. Integrity & observability controls (audit-relevant)

- **Audit pipeline** (`lib/audit.ts`) — every broker action and privileged change
  is recorded (actor, action, projectId, write?, result, status, ms).
- **Data lineage** — per-screen provenance: source backend + native field, poll
  time, who-last-touched, and CSV/JSON export — the evidence trail for "where did
  this figure come from".
- **Broker contract + conformance** — a published v1 contract and a conformance
  suite any broker must pass; arch-guard + deploy-guard CI tests prevent drift.
- **Dependency hygiene** — CI runs `pnpm audit` (blocks on critical) and emits a
  dependency/licence SBOM inventory artefact.

---

## 5. Notes for an eventual SOC 2 / pen-test

- The smallest possible **data-at-rest scope** (essentially: gateway config) is
  the single biggest scope-reducer — keep it that way.
- Each egress above maps to a **data-flow diagram** entry; E2/E3/E5 are the ones
  to classify and get DPA coverage for, since they can carry portfolio data.
- The RFC security checklists (RFC-004 §15 / RFC-005 §17) are pre-written control
  statements for the delegation feature *if/when* it's built.

*Keep this current: a new egress or durable store is a change to this file.*
