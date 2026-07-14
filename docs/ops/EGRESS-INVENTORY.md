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
| E1 | **Broker hop** | gateway → `BROKER_URL`/`BROKER_URLS` → backend | Project/issue data **in transit** (never at rest) | **On** (the product) — **encrypt it**: see §3b |
| E2 | **Logging sync** (time-travel history) | `LOGGING_SYNC_URL`; `loggingSync` | Point-in-time portfolio snapshots — the **one durable** concession | **Off** (opt-in) |
| E3 | **OData / Power-BI** | `routes/odata.ts` | Read-only BI projection of portfolio data | Gated (BI token) |
| E3a | **MCP server** | `routes/mcp.ts` (`POST /api/mcp`) | Read-only portfolio reads for MCP clients/agents, through the broker + RBAC + audit | Gated (session or read-only API token) |
| E4 | **FX rates read-through** | `FX_RATE*`; `lib/currency.ts` | Outbound to an FX provider; **no** project data sent | On (read-only, falls back to indicative) |
| E5 | **AI provider** | `AI_PROVIDER`; `routes/ai.ts` | Whatever the user asks the assistant about | **Off** unless configured |
| E6 | **Notifications** | `routes/notifications-stream.ts`, `webhooks.ts` | Inbound ingest + outbound HMAC-signed events | Gated |
| E7 | **Exports** | server `routes/export.ts`; client lineage CSV/JSON | Exactly what the user exports, user-initiated | On (user action) |
| E8 | **IdP / OIDC** | `OIDC_ISSUER_*` | Authentication only; identity, not project data | On (auth) |
| E9 | **Cross-instance federation** | `lib/federation.ts` (`routes/index.ts`), `safeFetch` → configured `PeerInstance` peers | Portfolio-summary aggregate sent across the instance boundary | **Off** (only when peers configured) |
| E10 | **SMTP email** | `SMTP_URL`; `lib/email.ts`, `lib/digest-delivery.ts` | Magic-link auth mail + scheduled digest content (portfolio summaries) | **Off** unless `SMTP_URL` set |
| E11 | **OTLP telemetry** | `OTEL_EXPORTER_OTLP_ENDPOINT`; `lib/tracing.ts`, `lib/otlp-metrics.ts` (both `safeFetch`) | Trace spans + RED metrics to your collector — span/metric metadata only, **no** project data | **Off** unless `OTEL_EXPORTER_OTLP_ENDPOINT` set |
| E12 | **Audit / SIEM sink** | `AUDIT_HTTP_URL`; `lib/audit.ts` (`safeFetch` + `assertEgressAllowed`) | Batched NDJSON audit events (actor email + IP, action, status, latency) to your log server | **Off** unless `AUDIT_HTTP_URL` set |
| E13 | **Secret vault / KMS** | `VAULT_*` / `KMS_PROVIDER`; `lib/vault-{store,aws,azure}.ts`, `lib/kms.ts` (all `safeFetch`) | Secret set/get + data-key unwrap to **your own** HashiCorp / AWS / Azure endpoint | **Off** (`KMS_PROVIDER` default `none`; vault only when `VAULT_*` set) |
| E14 | **Retention connectors** | `services/retention-broker` (separate opt-in sidecar) → S3 / DynamoDB / BigQuery | Durable time-series history you explicitly opted to persist | **Off** (opt-in service; the gateway process imports no cloud SDK — pure key-layout over an injected port) |

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
| **Redis fan-out** (`REDIS_URL`, *multi-replica*) | Pub/Sub broadcasts (notifications, the **already-redacted** broker-log projection) + rate-limit counters | **Off by default**; ephemeral broadcast, not a datastore — **never** project data or credentials. See `MULTI-REPLICA.md` |
| **Delegation denylist** (*future*) | A `jti`/hash fingerprint set for instant revoke | **Not built**; design stores a one-way hash only (no identities) |

---

## 3a. Egress hardening controls

| Control | What it does | Knob |
| --- | --- | --- |
| **SSRF guard** (`lib/egress.ts`) | Every gateway outbound request is validated first. Link-local / cloud-metadata targets (169.254.0.0/16, IPv6 link-local, `metadata.google.internal`, `fd00:ec2::254`) and non-http(s) schemes are **always blocked** — the Capital-One pattern can't happen through the app. Internal/localhost hosts stay allowed (the broker lives there). | `EGRESS_ALLOWLIST` (optional) pins outbound to an exact host list |
| **CSV-injection guard** | Exported CSV cells beginning with a formula trigger (`= + - @` / tab / CR) are apostrophe-prefixed, so attacker-influenced backend values can't execute when the file opens in Excel/Sheets (`lib/csv.ts`, SPA `lib/data-lineage.ts`). | — |
| **Startup security self-check** (`lib/security-check.ts`) | At boot, dangerous *production* config combinations are logged at severity (e.g. prod with no OIDC = demo auth = everyone admin). | `SECURITY_STRICT=on` refuses to boot on a CRITICAL finding |

## 3b. Encrypting the broker hop (gateway ↔ broker ↔ backend)

The broker hop carries project data, so encrypt it in transit:

1. **TLS (do this):** set `BROKER_URL` to **`https://`**. Node's fetch then does
   TLS and verifies the broker's certificate; for a **private CA**, point Node at
   the bundle with `NODE_EXTRA_CA_CERTS=/path/ca.pem` (no app code needed). The
   startup self-check **warns** (`broker-plaintext`) if the broker URL is plain
   `http://` to a non-loopback host.
2. **mTLS (zero-trust):** for mutual authentication + encryption, front the broker
   with a **TLS-terminating sidecar** or run both in a **service mesh**
   (Istio/Linkerd auto-mTLS). This keeps certificate *lifecycle* (issuance,
   rotation) out of the app — deliberately not done in-process to avoid the
   dependency + cert-management surface.
3. **PSK app-layer encryption (`BROKER_PSK`) — a fallback _below_ TLS, opt-in.**
   When you genuinely cannot run TLS on the hop but still must keep a packet
   capture from seeing the bearer token in cleartext, set `BROKER_PSK` to a shared
   high-entropy key. The gateway then AES-256-GCM-encrypts the **entire** request
   envelope — action, payload **and the forwarded Authorization token** — and
   sends only opaque ciphertext + an `X-OmniProject-Enc` marker; the broker
   decrypts, dispatches, and re-encrypts its reply (the reference sidecar
   implements both ends — `lib/broker-psk.ts`, proven by `psk-wire.test.ts`). Be
   honest about the limits vs TLS: **no forward secrecy** (one static key — a leak
   decrypts past captures), **no peer authentication** (no certificate; anyone
   with the key is "the broker"), and **metadata still leaks** (destination IP,
   port, sizes, timing). The broker MUST implement the matching crypto. Prefer
   TLS; reach for PSK only when TLS is genuinely unavailable on the segment.
4. Loopback (`localhost`) plaintext is fine — same host, no wire.

## 3c. Shutdown: clearing in-memory working sets

Graceful shutdown (§ lifecycle) calls `wipeInMemoryState()` — it **clears the
bounded in-memory sets** (broker-log ring, read cache) so references drop for GC
and the shutdown is tidy. Note this is reference-clearing, **not** secure
byte-zeroisation: JS strings are immutable and the OS reclaims process memory on
exit. The real protection is that **no long-lived secret sits server-side** —
sessions are in the client cookie (sealed), access tokens are per-request and
GC'd, and the broker log holds only a redacted projection.

## 3d. Does OmniProject lower the backend's security bar?

**Short answer: no — by default. The bar only drops at the specific opt-in egress
points below, each off until an operator deliberately enables it.**

The model that makes this checkable: **OmniProject is just another authorised API
client of the backend.** It sees exactly what that user's own backend UI sees, so
the real question is whether it is a *worse custodian* of that data than the
backend itself. For the default configuration it is not:

| Dimension | Does OmniProject lower the bar? | Why |
| --- | --- | --- |
| **Data at rest** | **No** | Stateless: persists **no project data, no credentials**. It can't weaken at-rest encryption it never writes. The only durable store is gateway **config** (settings), not project data. |
| **Credentials / authorisation** | **No** | Forwards the **user's own token**, never a stored shared admin key; the **backend still authorises every write**. It cannot grant access the backend would refuse. |
| **In transit** | **Only if you misconfigure it** | Broker hop is TLS (or the PSK fallback, §3b); browser hop is your HTTPS + a sealed cookie. Running the broker on plain `http://` to a remote host lowers it — and the startup self-check **warns** exactly there (`broker-plaintext`). |

**Where it *can* lower the bar — all opt-in, off by default, operator-gated.**
These are the only places data lands somewhere the backend's own encryption no
longer covers it; each maps to an egress in §2:

- **E2 — Logging-sync (time-travel snapshots):** the one durable concession. If
  enabled, point-in-time portfolio data lands in **your** snapshot store, under
  *that* store's encryption/retention — not the backend's. The single biggest
  "new place data sits."
- **E5 — AI provider:** if configured, whatever the user asks about goes to a
  third party.
- **E3 — OData / BI** and **E7 — exports (CSV/JSON):** data leaves the boundary to
  a BI tool or the user's disk (exports carry the formula-injection guard, but
  once on disk it is the user's to protect).

**Two inherent caveats — true of any overlay, not fixable.**

- During a request, decrypted data is **plaintext in gateway memory and in the
  browser** — exactly as it is in the backend's own SPA. Shutdown clears the
  in-memory working sets (§3c), but that is reference-clearing, not magic.
- OmniProject cannot make data *more* secure than the backend's API hands it over.
  If the backend returns a field as ciphertext, OmniProject passes that ciphertext
  through untouched; if the API returns plaintext (the normal case), OmniProject is
  no better or worse than any other authorised client.

**One-line answer for a CISO:** the read-through core inherits the backend's
posture and adds **no at-rest scope and no stored credentials**; the bar drops
only at the named opt-in egress points (E2/E3/E5/E7), each off until an operator
turns it on and owns the resulting data flow.

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
- **Broker read-seam sanitizer + data-quality signal** (`broker/sanitizer.ts`) —
  normalises every backend read to the contract shape and tallies repairs; `app.ts`
  emits the count as `X-OmniProject-Data-Repaired`, so backend-shape drift is
  observable per response.

---

## 5. Notes for an eventual SOC 2 / pen-test

- The smallest possible **data-at-rest scope** (essentially: gateway config) is
  the single biggest scope-reducer — keep it that way.
- Each egress above maps to a **data-flow diagram** entry; E2/E3/E5 are the ones
  to classify and get DPA coverage for, since they can carry portfolio data.
- The RFC security checklists (RFC-004 §15 / RFC-005 §17) are pre-written control
  statements for the delegation feature *if/when* it's built.
- **Uniform IP-pinning across every HTTP hop.** All HTTP egress with an operator- or
  request-influenceable URL routes through `safeFetch` (SSRF literal + **post-DNS IP pinning** +
  per-hop redirect re-validation + allowlist + residency). The first broker hop
  (`lib/broker-transport.ts`) keeps its own pooled keep-alive + mTLS dispatcher but now **pins the
  connection to a validated IP at connect time** via `guardedLookup` (refuses a host that resolves to
  the link-local/metadata range), closing the earlier first-hop DNS-rebinding TOCTOU; redirects are
  still force-blocked (`redirect: "manual"`, not caller-overridable) and the caller's
  `assertEgressAllowed` still applies the allowlist/residency against the fixed `BROKER_URL`.
- **Non-HTTP egress (SMTP, Redis).** `SMTP_URL` / `REDIS_URL` reach a fixed operator host outside the
  HTTP guard by nature (nodemailer / ioredis, not `fetch`); neither is request-influenced and both are
  off unless the env var is set. The startup self-check (`lib/security-check.ts`) additionally
  **refuses to boot** (critical finding) if either is pointed at a link-local/metadata literal — never
  a legitimate mail/cache host.

*Keep this current: a new egress or durable store is a change to this file.*
