# Enterprise operations: data map, DSAR, retention, backup & DR

This document answers the compliance/operations questions enterprise procurement asks. It is
written to be handed to a security or privacy reviewer. The short version: OmniProject is a
**stateless overlay** — it holds essentially no business data at rest — so most data-lifecycle
obligations land on your **systems of record** (reached through the broker), not on OmniProject.

## Why this document exists (the buyer's actual question)

README's "Why OmniProject exists" names three problems: tool sprawl, nobody trusting a
second copy of their data, and migration risk killing the idea before it starts. For an
enterprise buyer, the middle one **is** the security review: *"if we adopt this, does our
attack surface grow, and do we now carry DSAR/retention/backup obligations for a new store
of our own data?"* The honest answer — backed by the data map below rather than asserted —
is no, because there genuinely isn't a second copy to have obligations about. That's the
same bet README's "For enterprises" pitch makes ("this can't become a new place our data
can leak from," by design, not by policy); this document is where that claim gets checked
line by line, not just taken on trust.

---

## 1. Data map — what OmniProject holds (and doesn't)

OmniProject is a gateway in front of your existing tools (Jira, ServiceNow, SAP, …) via the
broker seam. It **reads through** to those systems on demand and renders; it does not copy or
persist their data.

| Data | At rest in OmniProject? | Where it actually lives |
|---|---|---|
| Projects, issues, tasks, financials, people | **No** — fetched per request, held in RAM for the response only | Your backends (via the broker) |
| User identity / credentials | **No** — authentication is delegated to your IdP (OIDC) | Your IdP |
| Session | Client-side **sealed cookie** only (no server session store) | The user's browser |
| AI provider API keys | **Encrypted vault** (or external KMS/secrets manager) | `lib/vault*` / your secrets manager |
| Deployment config (settings, vendor maps, rulesets) | **Encrypted at rest** (AES-256-GCM) | `OMNI_CONFIG_DIR` (operator-owned) |
| SCIM directory (lifecycle overlay) | Small, **sealed** users/groups file | `SCIM_STATE_FILE` |
| Security state (revocations, grants, kill switches) | **Sealed** state file | `SECURITY_STATE_FILE` |
| Audit log | **Not retained locally** — emitted to stdout / your SIEM | Your SIEM (operator-owned) |
| Optional read cache | RAM only, per-replica, TTL-bounded (off by default) | — |
| Optional state-history (time-travel) | **Egressed to an operator logging server** if `LOGGING_SYNC` is enabled (off by default; out of warranty) | Your logging server |

**Net:** with the optional caches/logging off (the defaults), a stopped OmniProject container
contains no business data — only encrypted operator config + secrets. This is the core of the
"nothing at rest" posture.

---

## 2. DSAR — data subject access & erasure

Because OmniProject doesn't store personal or business data, a **Data Subject Access Request**
or **right-to-erasure** is satisfied at the systems of record, not here:

- **Access / portability:** export the subject's data from the backend(s) that own it (Jira,
  ServiceNow, …). OmniProject's read API can help *locate* it but is not the system of record.
- **Erasure:** delete/anonymise in the backend(s). OmniProject holds no copy to erase.
- **Identity:** a subject's identity record lives in your IdP; deprovision via SCIM
  (`active=false`) or the IdP directly — that immediately denies access here too.
- **Residual personal data in OmniProject:** only (a) the subject's *session cookie* (self-
  expires; `MAX_SESSIONS_PER_USER` / key revocation forces it), (b) their email/sub inside
  **audit events** in your SIEM (subject to your SIEM's retention), and (c) their SCIM
  directory entry (delete the user via SCIM). There is nothing else to expunge.

**Operator action for a DSAR:** (1) erase at the backend(s); (2) delete the SCIM user; (3) apply
your SIEM's erasure process to audit lines for that actor; (4) the session ages out / revoke it.

**One-click evidence report:** `GET /api/security/dsar?sub=…&email=…` (admin; the request is itself
audited) assembles, from live gateway state only, an auditor-ready picture for a subject — JSON +
a human-readable summary (`lib/dsar`). It reports: what is **not retained** (project data, session
claims, role derivation, AI content); what the gateway **does** hold referencing the subject (the
SCIM directory record if SCIM is on, a session-revocation mark, and the content-free provenance
ring entries that name them); where the data **actually lives** (the connected backends — origins
only, never a copy); and the **audit-chain anchor** so the subject's slice in your SIEM can be
verified. It copies no backend/personal data into the gateway — it reports references and
locations, consistent with zero-at-rest.

---

## 3. Retention

OmniProject itself retains **nothing on a timer** — it has no database. Retention is governed
where data actually rests:

- **Audit log:** retention is your SIEM's policy (point `AUDIT_HTTP_URL` at a sink with the
  required retention). The hash-chain (`lib/audit-chain`) makes that retained copy tamper-evident.
- **Backend data:** your systems of record's retention policy.
- **Config / secrets:** kept until you change them (operator-owned files / secrets manager).
- **Caches / state-history:** off by default; when on, TTL-bounded (read cache) or governed by
  your logging server (state-history). Turn them off to keep the zero-retention posture.

There is no "purge job" to schedule inside OmniProject because there is no retained store to
purge — a deliberate property, not a gap.

---

## 4. Backup & restore

The only durable, OmniProject-owned artefact worth backing up is the **encrypted config
directory** (`OMNI_CONFIG_DIR`) plus the secrets vault / external secrets manager.

**Back up:**
1. **Config (portable, re-keyed):** `POST /api/security/config/export` (admin + step-up) →
   an `e1.` bundle encrypted under a one-time ephemeral key + the key (carry separately). The
   internal at-rest key never leaves and is rotated. Offline-decrypt with
   `tools/decrypt-config-bundle.mjs`. Store the bundle + key in your backup vault.
2. **Config (raw files):** or snapshot the `OMNI_CONFIG_DIR` volume (files are sealed at rest);
   you also need the config key (`CONFIG_KEY_RAW` / KMS `CONFIG_KEY_ENC`) to open them elsewhere.
3. **Secrets:** if using an external secrets manager (`VAULT_BACKEND=hashicorp|aws|azure`), the
   keys are already backed up by that manager. With the local vault, back up `vault.json` +
   the vault root key (`VAULT_KEY` / KMS `VAULT_KEY_ENC`).
4. **SCIM / security state:** back up `SCIM_STATE_FILE` and `SECURITY_STATE_FILE` (both sealed)
   if you rely on their durability; otherwise they rebuild (SCIM re-syncs from the IdP).

**Restore:** decrypt the bundle (or mount the volume), drop the JSON into the target's
`OMNI_CONFIG_DIR`, supply the keys, and boot — the target re-seals under its own key. No HTTP
import endpoint exists by design (decrypt → folder-drop → rekey).

---

## 5. Disaster recovery runbook

Because OmniProject is stateless and the backends are the source of truth, recovery is a
**redeploy**, not a data restore.

1. **Provision** a fresh container/cluster from the image (the repo is cloned fresh; nothing
   container-local is load-bearing).
2. **Supply secrets/env:** `SESSION_SECRET`, `BROKER_PSK`, OIDC config, the config key
   (`CONFIG_KEY_RAW` or `KMS_PROVIDER` + `CONFIG_KEY_ENC`), the vault root / `VAULT_BACKEND`.
3. **Restore config:** mount the backed-up `OMNI_CONFIG_DIR` (or decrypt the export bundle into
   it). Vendors, settings and rulesets come back from those files.
4. **Boot:** `bootstrap()` resolves KMS-wrapped keys → restores security state → hydrates the
   vault → reads the config dir → serves. Health at `/readyz` (checks broker reachability).
5. **Verify:** `/api/security/config-key` fingerprint matches the source; `/api/security/audit/anchor`
   continues the chain; broker connectivity green.

**RPO/RTO:** RPO ≈ your config backup cadence (business data RPO is owned by the backends).
RTO ≈ container start + config mount (seconds–minutes); no data rehydration step.

**Multi-region / HA:** run N replicas behind a load balancer (sessions are sealed cookies, no
shared session store; set `REDIS_URL` to share rate-limit counters + the broker-log bus). See
`docs/ops/MULTI-REPLICA.md`. Data residency is determined by where your **backends** live, not
OmniProject — it processes in-region and persists nothing cross-region.

---

## 6. Quick reference — relevant controls

| Need | Control |
|---|---|
| Tamper-evident audit | hash-chained audit + `tools/verify-audit-chain.mjs` (`docs/AI-SECURITY.md` §4) |
| Deprovision a user | SCIM `active=false` / IdP (denies login immediately) |
| Freeze the system | maintenance lockdown (`PUT /api/admin/maintenance`) |
| Move/restore config | secure export bundle + offline decrypt |
| Keys in HSM/KMS | `KMS_PROVIDER` + `*_KEY_ENC` (BYOK envelope) |
| Restrict networks | `IP_ALLOWLIST` |
