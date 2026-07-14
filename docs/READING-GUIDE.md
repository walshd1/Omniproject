# OmniProject — Reading guide ("where do I look to understand X")

> A map from **subsystem → entry-point files**, so a new engineer or auditor can
> jump straight to the code that matters. For the exhaustive per-function index see
> [FUNCTION-MAP.md](FUNCTION-MAP.md) (generated from source comments, CI-drift-guarded).
> For the system overview read [ARCHITECTURE.md](ARCHITECTURE.md); for traced request
> paths read [SEQUENCES.md](SEQUENCES.md). Paths below are clickable.

All gateway paths are under `artifacts/api-server/src/`, except a few shared-package
references shown with their repo-root path (e.g. `lib/api-spec/`, `lib/backend-catalogue/`).

---

## The 60-second orientation

| To understand… | Start here |
| -------------- | ---------- |
| **How the app boots + the middleware chain** | [`app.ts`](../artifacts/api-server/src/app.ts) → [`routes/index.ts`](../artifacts/api-server/src/routes/index.ts) |
| **The broker seam** (the whole point) | [`broker/index.ts`](../artifacts/api-server/src/broker/index.ts) + [`broker/types.ts`](../artifacts/api-server/src/broker/types.ts) + [BROKER.md](BROKER.md) |
| **What "no database" means in code** | there is no ORM/DB package or first-party datastore in the gateway; `broker/cache.ts` is the only RAM-hold and it is opt-in |
| **The published contract a broker must meet** | [CONTRACT.md](CONTRACT.md) + [`broker/contract.ts`](../artifacts/api-server/src/broker/contract.ts) + `docs/contract/broker.v1.schema.json` |
| **The domain data shapes** | [`broker/types.ts`](../artifacts/api-server/src/broker/types.ts) + `lib/api-spec/openapi.yaml` |

---

## Subsystem → entry-point map

### Broker seam & adapters
- **Selection + decorator composition:** [`broker/index.ts`](../artifacts/api-server/src/broker/index.ts) (`getBroker`, `contextFromReq`, `respondBrokerError`).
- **Interface + domain types:** [`broker/types.ts`](../artifacts/api-server/src/broker/types.ts) (`Broker`, `ActorContext`, `IssueWrite`, `CapabilityFlags`, `BrokerError`).
- **Reference broker (only n8n-aware code):** [`broker/reference-broker/`](../artifacts/api-server/src/broker/reference-broker/) (`ReferenceBroker`, `writeIssue`, `idempotencyKey`).
- **Demo broker (canned, no network):** [`broker/demo.ts`](../artifacts/api-server/src/broker/demo.ts) + [`broker/demo-data.ts`](../artifacts/api-server/src/broker/demo-data.ts).
- **Decorators:** [`single-flight.ts`](../artifacts/api-server/src/broker/single-flight.ts) · [`cache.ts`](../artifacts/api-server/src/broker/cache.ts) + [`adaptive-ttl.ts`](../artifacts/api-server/src/broker/adaptive-ttl.ts) · [`provenance.ts`](../artifacts/api-server/src/broker/provenance.ts) · [`sanitizer.ts`](../artifacts/api-server/src/broker/sanitizer.ts) (always on) · [`messy-broker.ts`](../artifacts/api-server/src/broker/messy-broker.ts) · [`trace.ts`](../artifacts/api-server/src/broker/trace.ts) · [`key-guard.ts`](../artifacts/api-server/src/broker/key-guard.ts) · [`autonomous-guard.ts`](../artifacts/api-server/src/broker/autonomous-guard.ts) (always on) · [`scope-guard.ts`](../artifacts/api-server/src/broker/scope-guard.ts).
- **The seam is enforced:** [`__tests__/broker-guard.test.ts`](../artifacts/api-server/src/__tests__/broker-guard.test.ts).
- **Out-of-process brokers / HTTP binding:** [BROKER-HTTP-BINDING.md](BROKER-HTTP-BINDING.md) + [`broker/conformance.ts`](../artifacts/api-server/src/broker/conformance.ts) + [`broker/reference-sidecar.ts`](../artifacts/api-server/src/broker/reference-sidecar.ts).

### Identity, session & access
- **OIDC / SAML / OAuth2 routes + session:** [`routes/auth.ts`](../artifacts/api-server/src/routes/auth.ts) (`setSession`, `getSession`, login/callback/step-up).
- **OIDC primitives:** [`lib/oidc.ts`](../artifacts/api-server/src/lib/oidc.ts) (`discover`, `authorizeUrl`, `exchangeCode`, `verifyIdToken`); JWKS in [`lib/jwks.ts`](../artifacts/api-server/src/lib/jwks.ts).
- **Session crypto & keys:** [`lib/session-crypto.ts`](../artifacts/api-server/src/lib/session-crypto.ts) (`seal`/`open`) · [`lib/session-key.ts`](../artifacts/api-server/src/lib/session-key.ts) (per-session broker key) · [`lib/session-registry.ts`](../artifacts/api-server/src/lib/session-registry.ts) · [`lib/session-timeout.ts`](../artifacts/api-server/src/lib/session-timeout.ts).
- **RBAC:** [`lib/rbac.ts`](../artifacts/api-server/src/lib/rbac.ts) (`grantsForReq`, `roleForReq`, `requireRole`); role-map editor [`routes/role-map.ts`](../artifacts/api-server/src/routes/role-map.ts); see [ops/ROLES.md](ops/ROLES.md).
- **CSRF / step-up / API tokens:** [`lib/csrf.ts`](../artifacts/api-server/src/lib/csrf.ts) · [`lib/step-up.ts`](../artifacts/api-server/src/lib/step-up.ts) · [`lib/api-token.ts`](../artifacts/api-server/src/lib/api-token.ts).
- **SAML SP:** [`lib/saml.ts`](../artifacts/api-server/src/lib/saml.ts) (install-on-demand). **Non-OIDC OAuth2:** [`lib/oauth2.ts`](../artifacts/api-server/src/lib/oauth2.ts). **SCIM provisioning:** [`routes/scim.ts`](../artifacts/api-server/src/routes/scim.ts) + [`lib/scim.ts`](../artifacts/api-server/src/lib/scim.ts).

### Capabilities & fields
- **Capability resolution:** [`lib/capabilities.ts`](../artifacts/api-server/src/lib/capabilities.ts) (`resolveCapabilities`, `resolveSupport`, `deriveFieldMap`, `CAPABILITY_DOMAINS`).
- **Superset ∩ manifest intersection + curation:** [`lib/availability.ts`](../artifacts/api-server/src/lib/availability.ts).
- **Field registry + reconcile:** [`lib/field-registry.ts`](../artifacts/api-server/src/lib/field-registry.ts); catalogue design in [FIELD-CATALOGUE.md](FIELD-CATALOGUE.md); source JSON `lib/backend-catalogue/assets/fields.json`.
- **Routes:** [`routes/capabilities.ts`](../artifacts/api-server/src/routes/capabilities.ts).

### Data flows (reads, writes, exports)
- **Broker facade:** [`lib/data.ts`](../artifacts/api-server/src/lib/data.ts).
- **Issue CRUD + concurrency:** [`routes/projects.ts`](../artifacts/api-server/src/routes/projects.ts) + [`lib/concurrency.ts`](../artifacts/api-server/src/lib/concurrency.ts).
- **Portfolio / programmes / financials:** [`routes/portfolio.ts`](../artifacts/api-server/src/routes/portfolio.ts) · [`routes/programmes.ts`](../artifacts/api-server/src/routes/programmes.ts) · [`lib/currency.ts`](../artifacts/api-server/src/lib/currency.ts).
- **Export & BI:** [`routes/export.ts`](../artifacts/api-server/src/routes/export.ts) + [`lib/csv.ts`](../artifacts/api-server/src/lib/csv.ts)/[`xlsx.ts`](../artifacts/api-server/src/lib/xlsx.ts)/[`pdf.ts`](../artifacts/api-server/src/lib/pdf.ts)/[`md.ts`](../artifacts/api-server/src/lib/md.ts); OData [`routes/odata.ts`](../artifacts/api-server/src/routes/odata.ts); Prometheus [`lib/metrics.ts`](../artifacts/api-server/src/lib/metrics.ts).
- **Import (Excel/CSV + mapper):** [`routes/import.ts`](../artifacts/api-server/src/routes/import.ts) + [`lib/column-mapper.ts`](../artifacts/api-server/src/lib/column-mapper.ts); see [ops/IMPORT.md](ops/IMPORT.md).
- **MCP server (read-through for AI):** [`routes/mcp.ts`](../artifacts/api-server/src/routes/mcp.ts) + [`lib/mcp.ts`](../artifacts/api-server/src/lib/mcp.ts); see [MCP.md](MCP.md).

### Notifications & real-time
- **Ingest + SSE stream:** [`routes/notifications-stream.ts`](../artifacts/api-server/src/routes/notifications-stream.ts).
- **Bus / hub / transport:** [`lib/notify-bus.ts`](../artifacts/api-server/src/lib/notify-bus.ts) · [`lib/notify-hub.ts`](../artifacts/api-server/src/lib/notify-hub.ts) · [`lib/sse.ts`](../artifacts/api-server/src/lib/sse.ts) · multi-replica [`lib/redis-bus.ts`](../artifacts/api-server/src/lib/redis-bus.ts).
- **Outbound webhooks (HMAC):** [`lib/webhooks.ts`](../artifacts/api-server/src/lib/webhooks.ts) + [`routes/webhooks.ts`](../artifacts/api-server/src/routes/webhooks.ts).
- **Presence:** [`lib/presence-hub.ts`](../artifacts/api-server/src/lib/presence-hub.ts) + [`routes/presence.ts`](../artifacts/api-server/src/routes/presence.ts).

### Cryptography, provenance & audit
- **Provenance chain:** [`lib/provenance.ts`](../artifacts/api-server/src/lib/provenance.ts) (`record`, `verifyChain`, `verifyContent`, `provenanceAnchor`).
- **Audit chain (durable):** [`lib/audit-chain.ts`](../artifacts/api-server/src/lib/audit-chain.ts) + [`lib/audit.ts`](../artifacts/api-server/src/lib/audit.ts); middleware [`routes/audit-middleware.ts`](../artifacts/api-server/src/routes/audit-middleware.ts).
- **Snapshots (sign/verify):** [`lib/snapshot.ts`](../artifacts/api-server/src/lib/snapshot.ts) + [`routes/snapshots.ts`](../artifacts/api-server/src/routes/snapshots.ts).
- **Signing + keys:** [`lib/signing.ts`](../artifacts/api-server/src/lib/signing.ts) (Ed25519) · [`lib/crypto-keys.ts`](../artifacts/api-server/src/lib/crypto-keys.ts) · [`lib/key-registry.ts`](../artifacts/api-server/src/lib/key-registry.ts) (versioning/revocation).
- **AES-GCM at rest:** [`lib/crypto-aes-gcm.ts`](../artifacts/api-server/src/lib/crypto-aes-gcm.ts) (primitive) · [`lib/config-crypto.ts`](../artifacts/api-server/src/lib/config-crypto.ts) · [`lib/sealed-file.ts`](../artifacts/api-server/src/lib/sealed-file.ts) · AI-key vault [`lib/vault.ts`](../artifacts/api-server/src/lib/vault.ts).
- **Gateway↔broker HMAC + PSK:** [`lib/broker-hmac.ts`](../artifacts/api-server/src/lib/broker-hmac.ts) · [`lib/broker-psk.ts`](../artifacts/api-server/src/lib/broker-psk.ts).
- **Offline verifiers (for auditors):** `artifacts/api-server/tools/verify-audit-chain.mjs` · `tools/decrypt-config-bundle.mjs`.

### Config, settings & environments
- **Runtime settings:** [`lib/settings.ts`](../artifacts/api-server/src/lib/settings.ts) + [`routes/settings.ts`](../artifacts/api-server/src/routes/settings.ts).
- **Environments + versioned rollback:** [`lib/config-store.ts`](../artifacts/api-server/src/lib/config-store.ts) + [`routes/setup.ts`](../artifacts/api-server/src/routes/setup.ts).
- **Config snapshot / bundle:** [`lib/config-snapshot.ts`](../artifacts/api-server/src/lib/config-snapshot.ts) · [`lib/config-bundle.ts`](../artifacts/api-server/src/lib/config-bundle.ts) · [`lib/config-export.ts`](../artifacts/api-server/src/lib/config-export.ts).

### Integration planes (the shared catalogue)
- **The seven registries** (backends, brokers, outputs, notifications, methodologies, reports, screens): [`lib/backend-catalogue/`](../lib/backend-catalogue/); overview in [INTEGRATION-PLANES.md](INTEGRATION-PLANES.md); per-plane dev guides under [`docs/dev/`](dev/).

### Dev-mode & testing
- **Dev-mode gates:** [`lib/dev-mode.ts`](../artifacts/api-server/src/lib/dev-mode.ts) · [`lib/dev-mode-guard.ts`](../artifacts/api-server/src/lib/dev-mode-guard.ts) · [`lib/dev-persist.ts`](../artifacts/api-server/src/lib/dev-persist.ts) · [`lib/messy-data.ts`](../artifacts/api-server/src/lib/messy-data.ts) · [`broker/dev-broker.ts`](../artifacts/api-server/src/broker/dev-broker.ts) · routes [`routes/dev-mode.ts`](../artifacts/api-server/src/routes/dev-mode.ts).
- **Test pillars + CI gates:** [TESTING.md](TESTING.md); contract harness `scripts/src/verify-broker-contract.ts`.

### Premium / licensing
- **Licence resolve + mint:** [`lib/license.ts`](../artifacts/api-server/src/lib/license.ts) + `scripts/src/mint-license.ts`; model in [LICENSING.md](../LICENSING.md).

---

## Glossary (the domain vocabulary)

- **Broker** — the single integration point between OmniProject and the real
  backends. An interface ([`broker/types.ts`](../artifacts/api-server/src/broker/types.ts))
  expressed in OmniProject's own vocabulary; n8n is the reference implementation.
- **Seam** — the boundary at the `Broker` interface. Above it, no code knows the
  broker is n8n; a CI guard enforces this. See [BROKER.md](BROKER.md).
- **Overlay** — OmniProject itself: a *view* over your backends that stores nothing.
  Every read/write is brokered live; the backend is the single source of truth.
- **Stateless / zero-at-rest** — the gateway keeps no project data at rest; only a
  signed+sealed session cookie (and, if opted in, a bounded RAM read cache and a
  content-free provenance ring). Scaling needs only a shared `SESSION_SECRET`.
- **Provenance** — a hash-chained, keyed-MAC record of every broker call holding
  only *fingerprints* (never content). Proves ordering + "nothing changed" by
  re-presenting content and recomputing the MAC. Tip signed as an Ed25519 anchor.
- **ActorContext** — the forwarded identity (`sub`/`email`/`role`/`token` +
  `sessionBind` + `actorKind`) built by `contextFromReq(req)`. A write runs *as*
  this principal against the backend. Autonomous actors (jobs, AI agents) are
  first-class principals, keyed and provenance-bound like a human.
- **Composite `source:id`** — a normalised entity id namespaced by the backend it
  came from, so two federated backends never collide. The broker returns a
  `source` on each row (see the data schemas in [TECHNICAL.md](TECHNICAL.md#6-data-schemas));
  cross-system links are stored as SHA-256 fingerprints only (Exploration mode).
- **Capability domain** — one of the 14 coarse data domains
  (`issues, scheduling, resources, financials, portfolio, baseline, blockers,
  history, raid, quality, crm, service, benefits`) a backend may populate. The UI
  gates reports/fields on the resolved set. See
  [`lib/capabilities.ts`](../artifacts/api-server/src/lib/capabilities.ts).
- **Superset ∩ manifest** — the field-resolution model: the canonical field
  **superset** (`FIELD_REGISTRY`) intersected with what a given backend's
  **manifest** actually exposes/populates, then curated (minus hidden fields).
- **Field group / `FieldSupport`** — each canonical field belongs to a group that
  maps to a capability domain; `{surface, store}` says whether it can be read/written.
- **Loop-guard / idempotency key** — the write-side controls: `origin=omniproject`
  stamped so a bi-directional sync doesn't storm, and
  `sha256(action:projectId:issueId:minute)` so duplicate triggers collapse.
- **Integration plane** — one of the seven vendor-neutral registries in
  [`lib/backend-catalogue/`](../lib/backend-catalogue/) (backends, brokers, outputs,
  notifications, methodologies, reports, screens). See [INTEGRATION-PLANES.md](INTEGRATION-PLANES.md).
- **Dev mode** — the umbrella for developer/debug surfaces (trace, capture, messy
  data, stateful persistence, vendor spoof). `isDevMode()` is **false in production**,
  so all of it is prod-inert. See [SEQUENCES.md §7](SEQUENCES.md#7-dev-mode--messy-data-gating-prod-inert).

## See also

- [ARCHITECTURE.md](ARCHITECTURE.md) — the system overview and the seam.
- [SEQUENCES.md](SEQUENCES.md) — the seven traced walkthroughs.
- [FUNCTION-MAP.md](FUNCTION-MAP.md) — the generated per-function index.
- [TECHNICAL.md](TECHNICAL.md) · [BROKER.md](BROKER.md) · [CONTRACT.md](CONTRACT.md) · [AI-SECURITY.md](AI-SECURITY.md).
</content>
