# Security Overview & Review

OmniProject is a **stateless program-management overlay**. It owns no system of
record: every project/issue read and write is brokered through the broker (n8n by
default) to the backends (OpenProject, Plane, Jira, …), and identity is delegated
to your OIDC provider. That architecture keeps the attack surface small — but the
gateway is still the front door, so this document records the controls in place
and the review that backs them.

> **We invite independent code audit and penetration testing.** The code is
> deliberately human-readable (see [docs/FUNCTION-MAP.md](docs/FUNCTION-MAP.md) for
> a map of every file and function) precisely so it can be reviewed. Read the
> [rules of engagement](#inviting-audit--penetration-testing) below before you
> start, then report findings via a private advisory.

## Trust boundaries

```
Browser ──TLS──> omni-shell gateway ──TLS──> n8n ──> backend systems of record
  (session cookie)   (RP + broker)        (workflow)      (OpenProject, …)
```

- **Browser → gateway:** signed, httpOnly session cookie (OIDC Authorization
  Code + PKCE) or a read-only API token.
- **Gateway → n8n:** server-to-server. The user's own bearer token travels in
  the request body so n8n writes *as the user* (per-user audit in the backend),
  never a shared admin key. **This link must be TLS in production.**
- **n8n → backends:** owned by your n8n workflow; outside the gateway's trust.

## Controls in place

| Area | Control | Where |
| ---- | ------- | ----- |
| AuthN | OIDC (Auth Code + PKCE), relying-party only; **ID token signature + iss/aud/exp verified against the issuer JWKS**; signed httpOnly cookies; demo mode only when OIDC is unset | `lib/oidc.ts`, `lib/jwks.ts`, `routes/auth.ts` |
| AuthZ (coarse) | RBAC: viewer / contributor / manager / pmo / admin, mapped from IdP role/group claims; mutations require ≥ contributor, settings require admin. `pmo` (business governance) and `admin` (technical config) are ORTHOGONAL authorities — neither implies the other, and the highest-risk actions are step-up gated. See `docs/ops/ROLES.md`. | `lib/rbac.ts`, `routes/projects.ts` |
| AuthZ (authoritative) | Backends re-check every brokered write using the forwarded user token | n8n workflow |
| API tokens | Bearer/X-API-Key are **read-only** (GET only → mutations 403); a leaked BI token can't write | `routes/index.ts`, `lib/api-token.ts` |
| Identity spoofing | Client-supplied `userContext`/`origin` are stripped; identity is injected from the validated session | `routes/broker-command.ts`, `broker/reference-broker/` |
| Concurrency | Optimistic concurrency (`expectedVersion`) → 409 instead of silent overwrite | `lib/concurrency.ts`, `routes/projects.ts` |
| Loop / replay | Deterministic idempotency key + `origin` loop-guard so webhook storms collapse | `broker/reference-broker/` |
| Rate limiting | Global limiter on `/api/*`; stricter limiter on analytics; keyed by session sub else IP; health exempt | `lib/rate-limit.ts` |
| Audit | Configurable action audit (`AUDIT_LEVEL` off/writes/all): one structured, redacted line per action (actor, status, latency, write flag); optionally shipped as NDJSON to an external logging server (`AUDIT_HTTP_URL`). Stateless — no local retention. | `lib/audit.ts`, `routes/audit-middleware.ts` |
| Secret hygiene | pino redaction of `authorization`, `cookie`, `set-cookie`, `*.token`, `userContext.token` | `lib/logger.ts` |
| Provenance | Responses are labelled sourced / derived / sample so synthesised demo numbers are never shown as fact | `ProvenanceBadge`, gateway responses |
| Supply chain | pnpm `minimumReleaseAge` (1 day); platform binaries pruned; dependency-free CSV/XLSX writer | `pnpm-workspace.yaml` |

## Review notes (this change set)

- **RBAC is defence-in-depth, not the sole control.** The gateway gate improves
  UX and blocks obvious misuse, but the backend systems of record remain the
  authoritative authorization point because the user's own token is forwarded.
  Do **not** rely on the gateway role alone for sensitive backends — configure
  backend permissions too.
- **Optimistic concurrency** is enforced locally in demo mode and delegated to
  the backend (e.g. OpenProject `lockVersion`) when wired; the gateway now
  propagates a backend `409` instead of masking it as `502`.
- **History & baselines are read-through.** OmniProject persists nothing; if the
  backend exposes no journal/baseline, those domains report unavailable rather
  than fabricating a trend. Demo trends are explicitly badged `DERIVED`/`SAMPLE`.
- **No new secrets are introduced.** New env (`OIDC_*_ROLES`, `CAPABILITIES`) is
  non-sensitive configuration.

## Known limitations / hardening backlog

- ID token signatures **are** now verified against the issuer JWKS (RS/PS/ES
  256/384/512) with iss/aud/exp/nbf checks; `OIDC_SKIP_TOKEN_VERIFY=true` is an
  escape hatch only. Set `OIDC_AUDIENCE` if it differs from the client id.
- Real-time notification ingest (`/api/notifications/ingest`) is authenticated by
  `NOTIFY_INGEST_SECRET` (constant-time compared) and disabled until that secret
  is set. SSE fan-out is in-process by default; set `REDIS_URL` (+ install
  `ioredis`) to fan out across replicas via **Redis Pub/Sub** — the right tool
  for ephemeral broadcast (Kafka is overkill; if it's your backbone, bridge it
  into `/ingest` instead). See [docs/N8N-WORKFLOWS.md](docs/N8N-WORKFLOWS.md).
- Settings and the analytics capability cache are in-memory; multi-replica
  deployments should back them with a shared store and pin capabilities via the
  `CAPABILITIES` env to avoid per-replica drift.
- RBAC claim mapping trusts the IdP's role/group claims; scope those claims
  tightly in your IdP.

## Inviting audit & penetration testing

We **actively welcome** independent security review of OmniProject — both static
code audit and dynamic penetration testing — and we will credit researchers who
report in good faith. The stateless, broker-agnostic design and the
[function map](docs/FUNCTION-MAP.md) are there to make the gateway quick to reason
about; please use them.

### In scope

- The **gateway** code in this repository (`artifacts/api-server`) — authN/authZ,
  the broker seam, the admin-gated surfaces (raw API, role-map, business rules),
  webhooks, ingest, exports, and the served OpenAPI/MCP endpoints.
- The **deploy artifacts** (compose / k8s / Dockerfile) as published here.
- The **broker contract** and the reference broker/backend blueprints.

### Out of scope

- **Any instance you do not own or operate.** Stand up your own — demo mode needs
  no backend (`docker compose -f docker-compose.standalone.yml up`, or run the
  gateway with no `BROKER_URL`). Do **not** test against shared, hosted, or other
  people's deployments.
- **Third-party systems**: the n8n product, your OIDC provider, and the backend
  systems of record (Jira, OpenProject, SAP, …). Report those to their vendors.
- **Volumetric / denial-of-service** testing, and anything that degrades a service
  for others. Rate-limit and resource-exhaustion *logic* findings are welcome;
  flooding is not.
- **Social engineering**, physical attacks, and spam/automated scanner noise with
  no demonstrated impact.

### Rules of engagement

- Test only your own instance; use synthetic data, never real personal data.
- Make a good-faith effort to avoid privacy violations, data loss, and service
  disruption; stop and report once you've demonstrated a vulnerability.
- Give us reasonable time to remediate before any public disclosure
  (we target an initial response within **5 working days** and a fix or mitigation
  plan within **90 days**).

### Safe harbour

We consider security research conducted in line with this policy to be
**authorised**, in good faith, and **welcome** — we will not pursue or support
legal action against researchers for accidental, good-faith violations of this
policy. This is not a paid bug-bounty programme (there is no monetary reward), but
we will publicly credit you in the advisory and release notes unless you ask us
not to.

## Reporting a vulnerability

Report privately via a **GitHub Security Advisory** —
[*Security → Report a vulnerability*](https://github.com/walshd1/Omniproject/security/advisories/new)
on the repository — rather than opening a public issue. Include reproduction
steps, impact, and the affected component from the table above. Do not disclose
publicly until a fix is released. The machine-readable pointer to this policy is
served at `/.well-known/security.txt`.
