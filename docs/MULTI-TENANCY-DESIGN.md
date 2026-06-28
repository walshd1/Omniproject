# Multi-tenancy — design proposal (for review before implementation)

Status: **PROPOSAL.** No code yet. This scopes the approach, the blast radius, and the cost so
we can decide *whether* and *how* to build it before touching the runtime.

---

## 1. Why / when you need it (and when you don't)

OmniProject is single-tenant today: one `OMNI_CONFIG_DIR`, one vault, one SCIM directory, one
broker config. That is the right model when **one deployment serves one customer** (separate
containers/namespaces per customer — "silo"). Multi-tenancy only earns its complexity when a
**single deployment must serve several isolated customers/orgs** (a SaaS or MSP model — "pool").

Decision driver: *do you run one shared instance for many orgs?* If no, **don't build this** —
silo isolation (one container each) is stronger and simpler than any in-process tenancy.

This proposal assumes the answer is yes (pooled) and designs for **hard logical isolation**.

---

## 2. Tenancy model: pooled with per-tenant config + keys

Two sub-models exist; we recommend a hybrid:

| Concern | Model | Rationale |
|---|---|---|
| Config (settings, vendors, rulesets) | **Silo per tenant** (own folder) | Already a folder-of-JSON; per-tenant folders are a natural extension |
| Secrets / vault / keys | **Silo per tenant** (own namespace + key) | Isolation must hold even if one tenant's key leaks |
| Identity (SCIM, RBAC) | **Silo per tenant** | A tenant's IdP must not see another's users |
| Runtime process / RAM | **Pooled** (shared replicas) | The whole point — one fleet serves all |
| Backend data | **Pooled seam, per-tenant routing** | The broker already routes; add a tenant dimension |

So: shared processes, **per-tenant config + secrets + identity**, with a tenant id threaded
through every request and the broker seam.

---

## 3. Tenant identity resolution

A `resolveTenant(req)` step (new middleware, very early — alongside `tracingMiddleware`)
derives the tenant id from, in priority order:

1. **Host** — `acme.app.example.com` → `acme` (the default for SaaS; map via `TENANT_HOST_MAP`
   or a subdomain rule).
2. **OIDC claim** — a configured claim (e.g. `org`, `tid`) on the verified token. Authoritative
   for identity-bound tenancy; cross-checked against the host to prevent a user on tenant A's
   host presenting tenant B's token.
3. **Explicit header/path** — `/t/<id>/...` or `X-Tenant` for machine/API-token callers (only
   honoured for trusted principals).

Unknown/unmapped tenant ⇒ **fail closed** (404/400), never a silent fallback to a default.

The resolved `TenantContext { id, ... }` is stored in an **AsyncLocalStorage** (the exact
pattern already used by `lib/tracing.ts` for trace context) so it propagates through async work
— including the broker egress — without threading it through every function signature.

---

## 4. Per-tenant config

Today `loadConfigDir()` reads one `OMNI_CONFIG_DIR`. Extend to a **registry of tenant configs**:

```
OMNI_TENANTS_DIR/
  acme/        config.json, vendors/, rulesets/, artifacts/   (today's single-tenant layout)
  globex/      config.json, vendors/, rulesets/, ...
```

- `getSettings()`, the vendor catalogue, rulesets, screens, branding become **tenant-scoped
  lookups** keyed by the ALS tenant id (a `tenantConfig(id)` accessor replacing the global).
- Loaded lazily + cached per tenant; hot-reload per tenant on change.
- This is the single biggest refactor: every place that reads global `getSettings()` /
  registries must read the tenant-scoped view. We'd introduce a `currentTenant()` accessor and
  migrate call sites incrementally behind it (global = a "default" tenant during migration).

---

## 5. Per-tenant secrets, vault & keys

The vault + KMS work we just shipped is tenant-ready by construction — it only needs a
**namespace dimension**:

- **Vault refs** become `tenant:<id>:aiprovider:<provider>` (today `aiprovider:<provider>`).
  `lib/vault.ts` getSecret/setSecret take the tenant from ALS; the external stores
  (HashiCorp/AWS/Azure) get a per-tenant path/secret-id prefix.
- **Config-at-rest + vault root keys** are derived **per tenant** (domain-separate the existing
  derivation by tenant id), or wrapped per tenant via KMS (`<TENANT>_CONFIG_KEY_ENC`). A leaked
  tenant key never opens another tenant's data.
- **Broker PSK / session / provenance / audit keys** gain a tenant dimension in
  `lib/key-registry` (the `derivedKey(name, version)` already domain-separates by name — add
  tenant to the derivation input).

---

## 6. Request scoping through the broker seam

The broker is where cross-tenant leakage would be catastrophic, so it gets the strongest guard:

- The broker `Context` (already carries `authHeader`, `sessionBind`) gains a **required
  `tenantId`**. The n8n adapter adds `X-Omni-Tenant` to egress and includes it in the signed
  request (the HMAC already covers headers/body — bind the tenant in so it can't be swapped).
- **Backend routing** becomes per-tenant: each tenant's `backendSource` + broker URL come from
  that tenant's config, so tenant A physically cannot reach tenant B's n8n/backends.
- A **fail-closed assertion**: any broker call with no tenant in context throws (no "default"
  egress). This is the linchpin invariant.

---

## 7. Identity, RBAC, governance per tenant

- **SCIM** (`lib/scim.ts`) becomes per-tenant: each tenant's IdP provisions into that tenant's
  directory (`SCIM_TOKEN` per tenant, or a tenant claim on the bearer). `directoryDecision`
  scopes by tenant.
- **RBAC** role-claim maps (`OIDC_*_ROLES`) move into per-tenant config so each org maps its own
  groups.
- **Governance, approved-actions, containment, grants, AI providers, dual-control queue** all
  gain the tenant dimension (per-tenant `security-state` + `ai-providers` files).
- **Audit + provenance** events carry `tenantId`; the audit hash-chain is **per tenant** (one
  chain each) so a tenant's tamper-evidence is independent.

---

## 8. Isolation guarantees + how we'd test them

The deliverable that makes this credible is an **isolation test matrix** — automated proofs that
tenant A can never observe or affect tenant B:

1. **Config:** a request in tenant A sees only A's settings/vendors/rulesets/branding.
2. **Secrets:** A's session cannot read B's vault entries; A's key cannot decrypt B's config.
3. **Broker:** a broker call from A carries A's tenant id, routes to A's backend, and is
   rejected if the tenant is absent or mismatched against the signature.
4. **Identity:** A's SCIM directory + RBAC never grant in B; deprovisioning in A doesn't touch B.
5. **Audit:** A's audit chain verifies independently; B's events never appear in A's anchor.
6. **Cross-tenant fuzz:** property tests that randomly interleave two tenants' requests and
   assert zero cross-observation.
7. **Negative/abuse:** forged `X-Tenant`, host/claim mismatch, missing tenant → all fail closed.

A "tenant isolation" CI guard (like the existing config-purity / seam guards) would assert no
code path reads a global config/secret without going through `currentTenant()`.

---

## 9. Phasing (incremental, each shippable)

1. **Tenant context plumbing** — `resolveTenant` middleware + ALS + `currentTenant()`, with a
   single implicit "default" tenant. No behaviour change; everything still works single-tenant.
2. **Per-tenant config** — tenant-scoped settings/vendors/rulesets behind `currentTenant()`;
   migrate global readers. (Largest step.)
3. **Per-tenant secrets/keys** — namespace the vault + derive keys per tenant.
4. **Broker scoping** — required tenant in the broker context + signed egress + fail-closed.
5. **Identity/governance** — per-tenant SCIM/RBAC/governance/audit-chain.
6. **Isolation test matrix + CI guard** — the proof, plus an admin "tenants" management surface.

Steps 1–2 are the bulk of the risk; 3–6 reuse seams we already have.

---

## 10. Risks & blast radius

- **Cross-tenant leakage** is the catastrophic failure mode → the fail-closed broker assertion +
  the isolation matrix are non-negotiable gates.
- **Wide refactor:** every global `getSettings()`/registry read is a call site to migrate
  (mitigated by the `currentTenant()` shim + a CI guard catching un-migrated reads).
- **Performance:** per-tenant lazy caches (config, keys) keep hot paths cheap; ALS adds
  negligible overhead (already proven by tracing).
- **Operational:** per-tenant onboarding (config folder + keys + SCIM token) needs an admin
  surface + runbook.

---

## 11. Rough effort

| Phase | Relative size |
|---|---|
| 1. Tenant context plumbing | S |
| 2. Per-tenant config (the big one) | L |
| 3. Per-tenant secrets/keys | M |
| 4. Broker scoping + fail-closed | M |
| 5. Identity/governance per tenant | M |
| 6. Isolation matrix + CI guard + admin UI | M |

Total: a multi-increment workstream (comparable to the entire enterprise batch just shipped),
with phase 2 the dominant cost. Each phase lands green and is independently reviewable.

---

## 12. Open decisions for you

1. **Tenant identity source** — host-based, OIDC-claim-based, or both (recommended: both, host
   primary, claim cross-checked)?
2. **Key isolation** — derive per-tenant keys from one master (simpler) or require a wrapped key
   **per tenant** via KMS (strongest; more onboarding)?
3. **Tenant onboarding** — config-folder drop (ops) vs an admin "create tenant" API (self-serve;
   bigger surface)?
4. **Backend topology** — one broker/n8n per tenant (strong physical isolation) or a shared
   broker that itself routes by tenant (cheaper; trust moves into the broker)?
5. **Scope** — full pooled multi-tenancy, or stop at "per-tenant config + keys on shared
   processes" without per-tenant backend routing (if all tenants share backends)?

Answer these and I'll turn the chosen phasing into the first implementation increment.
