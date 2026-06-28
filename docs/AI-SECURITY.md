# AI security & control model

How OmniProject lets a customer use AI with the fewest risks: what's gated, what's
contained, and what the residual boundaries are. Written for an admin or a security
reviewer. British English; the product is a stateless, zero-data-at-rest PM overlay.

## TL;DR — the posture

- **AI is OFF by default.** Nothing — no provider, tool, MCP, vendor or broker — runs
  until an admin turns it on, per surface (per screen).
- **Autonomous AI is keyed and contained.** Anything acting without a live human is a
  short-lived, allowlist-minted, RBAC-capped principal that can only write inside a
  default-deny, tightly-scoped, time-bounded, rate-capped, fully-logged grant.
- **One switch stops everything.** The break-glass kill switch halts all model calls and
  suspends all autonomous writes.
- **AI can only do what's approved.** A customer-curated action allowlist is the ceiling;
  per-surface, role and grant rules restrict further below it.

## 1. The control layers (defence in depth)

A request from an AI tool passes, in order:

1. **Governance state** (per capability, per surface): off / user-defined / public.
   Default **off**. An AI provider, tool, MCP, vendor or broker that's off on a screen is
   unreachable there. `lib/tools.ts`, admin UI `GovernanceAdmin`.
2. **Containment level** (scales with AI exposure): the more exposed the AI (local →
   remote → public), the tighter every autonomous write grant must be. **Full by default
   for all sources**; an admin can relax, never below the source floor. `lib/ai-containment.ts`.
3. **Approved-actions allowlist** (the catalogue ceiling): only approved canonical actions
   can be planned or executed. **Reads approved by default; writes blocked** until an admin
   approves them. Hard-enforced in the NL→action planner and the MCP executor.
   `lib/approved-actions.ts`, admin UI `ActionCatalogue`.
4. **RBAC**: the caller's role gates the action (viewer / contributor / manager / pmo / admin).
5. **Autonomous write-scope grant** (for non-human actors): default-deny, scoped by
   *what / where / which fields / how long*, rate-capped, fail-closed-logged.
   `lib/autonomous-grant.ts`.
6. **Egress guard**: control characters and URL-structural id characters are rejected
   before anything leaves the gateway (CRLF/path injection). `lib/payload-guard.ts`.
7. **Keyed broker hop**: every broker/vendor call is signed with a per-session derived key
   and bound into the provenance chain. `lib/session-key.ts`, `lib/broker-hmac.ts`.

The **kill switch** (`lib/ai-kill.ts`) short-circuits 1–7: model calls throw, autonomous
writes are denied. Grants are suspended, not edited, so release restores the prior posture.

## 2. Autonomous actors (agents, scheduled jobs, the health watch)

Anything acting without a live human request is a **first-class keyed principal**, not an
anonymous system call:

- **Identity**: `automation:<id>` or `agent:<id>:<onBehalfOf>` — attributable in audit +
  provenance.
- **Keyed**: a fresh per-session binding (monotonic start + CSPRNG salt), so its broker
  calls are signed with a derived key and its provenance entries carry a session
  fingerprint — exactly like a human login.
- **Allowlist-minted + time-bound**: the minter (`lib/autonomous.ts`) refuses unknown ids,
  caps the role to a registered maximum, requires the caller's clock, and stamps an
  `issuedAt`/`expiresAt`. Sessions are **~30s** (re-keying is free), so a leaked key is
  near-worthless.
- **Write-scoped**: `authorizeAutonomousWrite` enforces a fresh session → RBAC →
  default-deny grant → action/project/surface/field scope → time bound → rate cap →
  **mandatory fail-closed audit**. A stolen, stale or over-reaching autonomous session is
  inert without a matching admin grant — the "no backdoor" property.

## 3. Data egress

- **Containment governs actions; the prompt governs egress.** A public/remote AI sees
  whatever is sent to it.
- The **portfolio copilot** is read-only, **egress-scoped** (only an aggregated snapshot
  — project name, RAG, variances, blocker count — leaves; never descriptions, ids or
  tokens) and **prompt-injection-hardened** (data framed as untrusted content, never
  instructions; no action surface exposed to the model). `lib/copilot.ts`.
- **Dictation is local-first** — the device's own speech engine; audio never leaves the
  machine. `components/DictateButton.tsx`.
- Vendor API keys/secrets are **never stored** by OmniProject (scaffolding only).

## 4. Provenance & keys

- Every broker call is fingerprinted into a keyed, hash-chained, content-free provenance
  ring, bound to the initiating **session** (not just an actor string). Forging history
  needs both the provenance key and the broker master. `lib/provenance.ts`.
- Keys are versioned and **admin-revocable** (session / provenance / broker); a revocation
  rolls forward and rejects anything signed under the old version.
- Sensitive actions require **step-up re-auth** (recent re-authentication on top of the
  admin role): key revocation, governance/egress changes, the raw escape hatch, config
  export, the kill switch, containment relax, action approval. `lib/step-up.ts`.
- **CSRF**: cookie-authenticated mutations need a same-origin Origin/Referer and a
  double-submit token. `lib/csrf.ts`.

## 5. Config at rest & portability

- Config snapshots are **encrypted at rest** (AES-256-GCM): the runtime store and the
  sensitive lock-config files (`config.json`, rulesets). `lib/config-crypto.ts`.
- **Secure export** never exports the internal key: it re-encrypts a bundle under a
  one-time ephemeral key, then **rotates the internal key**. Move the bundle, carry the
  ephemeral key separately, decrypt offline (`tools/decrypt-config-bundle.mjs`), drop in
  place — the target re-seals under its own key. `POST /api/security/config/export`.
- **Durable security state** (`SECURITY_STATE_FILE`): key revocations, grants, containment,
  approvals and the kill switch are sealed to disk and restored at boot, so a revocation
  survives a restart. `lib/security-state.ts`.

## 5a. AI providers & the key vault

- **Providers are first-class entities** (`id`, `kind`, `label`, `endpoint?`, `model?`) —
  `lib/ai-providers.ts`. You can have several of a kind (e.g. two OpenAI accounts).
- **Capabilities map to an ordered provider list** (chat, nl-action, copilot, health-watch,
  stt). The first **ready** provider wins (primary + fallbacks). An unmapped capability falls
  back to the Settings default. Set in **Settings → AI providers** (admin + step-up).
- **Where the keys live is pluggable** (`lib/vault-store.ts`, selected by `VAULT_BACKEND`):
  - `local` (default) — an OmniProject-owned, doubly-encrypted file (below);
  - `hashicorp` / `hcp` — HashiCorp Vault or HCP Vault (KV v2; `VAULT_ADDR` + `VAULT_TOKEN`);
  - `aws` — AWS Secrets Manager, **native** (SigV4-signed; `lib/vault-aws.ts`);
  - `azure` — Azure Key Vault, **native** (AAD client-credentials; `lib/vault-azure.ts`);
  - `http` — a generic REST secrets store (BYO / external-secrets sidecar) for any other manager.
  For external stores the **manager is the encryption boundary** (OmniProject doesn't
  double-encrypt); reads are served from an in-memory cache hydrated at boot, writes are
  awaited so a backend failure surfaces.
- **API keys are out of docker/env entirely** (hard cut-over). They are entered in the admin
  UI and held in the **encrypted vault** (`lib/vault.ts`); with the default `local` backend:
  - each secret is **separately encrypted** under its own derived subkey
    (`HKDF-SHA256(root, ref)` → AES-256-GCM envelope), so envelopes don't share key material;
  - the **whole vault file is itself sealed** at rest with the config-store crypto — a second,
    independent layer ("super-encrypted");
  - keys are **write-only across the API**: no route ever returns a plaintext key, only
    presence + a short fingerprint; the internal `getSecret` is used solely to sign the
    upstream call;
  - the root key is `VAULT_KEY` (else derived from the env master, domain-separated from the
    config key) — **one root protects many secrets**, and the secrets never sit in the
    environment. The vault file lives company-wide (`VAULT_FILE` / `<OMNI_CONFIG_DIR>/vault.json`).
- All provider/key/mapping writes are **admin + step-up + audited** (`ai-provider.*`).

## 6. Residual boundaries (honest)

These are deliberate, documented limits — not defects:

- **Shared-secret MACs, not third-party signatures.** Broker/provenance integrity
  authenticates to a holder of the master (the broker), proving origin + session binding;
  it is not non-repudiation against the gateway itself. Asymmetric signing would be needed
  for that.
- **Internal-consistency provenance.** Ordering and non-alteration are verified internally
  (monotonic counter + hash links), with no external timestamp anchor. A holder of *both*
  the provenance and broker keys could forge a self-consistent history.
- **Prompt injection** is mitigated (closed vocabulary, schema-bound args, default-deny
  writes, human confirm, copilot hardening) but, as with any LLM, not eliminated — the
  containment ensures the worst case is a refused/clarifying response, not a silent action.
- **Config encryption protects data at rest**, not against an attacker holding the
  env master or the running process.

## 7. Key environment switches

| Variable | Effect |
|---|---|
| `SESSION_SECRET` | Master for session/derived keys (required, non-default, in production). |
| `BROKER_PSK` | Gateway↔broker pre-shared key (keyless live calls are hard-rejected outside dev). |
| `CONFIG_KEY_RAW` / `CONFIG_KEY` | Config-at-rest key (raw, or derived from the master). |
| `VAULT_BACKEND` | Secrets store for AI keys: `local` (default) \| `hashicorp` \| `hcp` \| `http` \| `aws` \| `azure`. |
| `VAULT_KEY` | Root secret for the **local** vault (base64 32 bytes; derived from the master if unset). Provider API keys live in the vault, **not** in env. |
| `VAULT_FILE` / `AI_PROVIDERS_FILE` | Where the sealed local vault + provider registry persist (default under `OMNI_CONFIG_DIR`). |
| `VAULT_ADDR` / `VAULT_TOKEN` / `VAULT_KV_MOUNT` / `VAULT_KV_PATH` | HashiCorp/HCP Vault connection (KV v2). |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` / `VAULT_AWS_SECRET_ID` | AWS Secrets Manager (native). |
| `VAULT_AZURE_VAULT_URL` / `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `VAULT_AZURE_SECRET_NAME` | Azure Key Vault (native). |
| `VAULT_HTTP_URL` / `VAULT_HTTP_TOKEN` | Generic REST secrets store (`http`). |
| `SECURITY_STATE_FILE` | Enables durable security state (revocations etc. survive restart). |
| `STEP_UP_MINUTES` | Step-up freshness window (default 5). |
| `AUTONOMOUS_SESSION_SECONDS` | Autonomous session TTL (default 30, clamped ≤ 5 min). |
| `OMNI_DEV_MODE` | Dev mode (hard-gated inert in production). |
