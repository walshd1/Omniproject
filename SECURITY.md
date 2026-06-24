# Security Overview & Review

OmniProject is a **stateless program-management overlay**. It owns no system of
record: every project/issue read and write is brokered through n8n to the
backends (OpenProject, Plane, Jira, …), and identity is delegated to your OIDC
provider. That architecture keeps the attack surface small — but the gateway is
still the front door, so this document records the controls in place and the
review that backs them.

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
| AuthZ (coarse) | RBAC: viewer / contributor / manager / admin, mapped from IdP role/group claims; mutations require ≥ contributor, settings require admin | `lib/rbac.ts`, `routes/projects.ts` |
| AuthZ (authoritative) | Backends re-check every brokered write using the forwarded user token | n8n workflow |
| API tokens | Bearer/X-API-Key are **read-only** (GET only → mutations 403); a leaked BI token can't write | `routes/index.ts`, `lib/api-token.ts` |
| Identity spoofing | Client-supplied `userContext`/`origin` are stripped; identity is injected from the validated session | `routes/n8n-proxy.ts` |
| Concurrency | Optimistic concurrency (`expectedVersion`) → 409 instead of silent overwrite | `lib/concurrency.ts`, `routes/projects.ts` |
| Loop / replay | Deterministic idempotency key + `origin` loop-guard so webhook storms collapse | `lib/n8n.ts` |
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

## Reporting a vulnerability

Please open a private security advisory on the repository (or email the
maintainers) rather than a public issue. Include reproduction steps and the
affected component from the table above.
