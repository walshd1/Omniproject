# RFC-005 — Secure delegation: the hardened design + full "X on behalf of Y" logging

**Status:** Design — the concrete, build-ready blueprint. **Still gated:** no code
until RFC-004 §14 is decided and the §15 + §17-here checklists are owned by a named
security reviewer. This is the *most secure version we can build* within
OmniProject's stateless, zero-data-at-rest, backend-owns-authorisation architecture.

**Relationship to RFC-004.** [RFC-004](RFC-004-delegation.md) is the *threat model
and the limits of what is safe* — why delegation is hard here and the dangerous
versions we refuse. **This** RFC is the *concrete design that satisfies it*: the
grant lifecycle, the identity/token model, the hashed store, layered revocation,
and — the centrepiece of this document — a complete, tamper-evident **"X on behalf
of Y"** logging design. Where the two could drift, RFC-004's anti-goals (§4) win.

---

## 0. One line

> A delegate **X** may exercise a delegator **Y**'s access only when it is
> *IdP-granted, time-boxed, least-privilege, consented, non-re-delegatable,
> revocable, and provably logged as "X on behalf of Y" — or it does not happen at
> all.* X always acts as themselves; Y's credential is never held, relayed, or
> reconstructable.

---

## 1. Security properties we guarantee (the contract)

Each is a *property a reviewer can test*, not a feature.

| # | Property | How it's guaranteed |
| --- | --- | --- |
| P1 | **No credential of Y is ever stored, logged, relayed or reconstructable.** | X uses X's own token; backend on-behalf uses an IdP-*minted* exchanged token (§5). The store holds only one-way hashes (§6). |
| P2 | **No impersonation.** The audit actor is *always* X; Y appears only as `onBehalfOf`. | Logging model §8; actor is `contextFromReq`'s real principal. |
| P3 | **Least privilege.** A grant conveys ≤ Y's own rights, scoped to nominated projects (and optionally actions). | Scope model §10; checked at grant *and* use time. |
| P4 | **Time-boxed.** Every grant has a hard `exp`; no unbounded grants. | Lifecycle §4; default TTL ≤ 4h. |
| P5 | **Consented.** Y initiates or explicitly approves; admin-broker is itself consented-to and audited; no self-grant. | Lifecycle §4; consent §4.2. |
| P6 | **Non-re-delegatable.** A delegate cannot become a delegator; chains capped at depth 1. | Enforcement §11. |
| P7 | **Revocable, fast.** TTL by default; explicit revoke via status list; continuous evaluation where the IdP supports it. | Revocation §7. |
| P8 | **Fail-closed, fully logged.** Any action under borrowed rights that cannot be attributed "X on behalf of Y" is **refused**, not silently performed. | Logging §8 — the precondition. |
| P9 | **Tamper-evident audit.** The on-behalf trail is append-only and integrity-verifiable. | Logging §8.4 — hash-chained records. |

If any property cannot be met for a given request, the safe outcome is **no
elevation / refuse the action**, audited as a denial.

---

## 2. The actors and authorities

| Authority | Owns | In OmniProject |
| --- | --- | --- |
| **The IdP** (Authentik / enterprise SSO) | Identity, role assignment, the grant itself (time-bounded group/PIM), the `act` claim, token exchange | `roleForReq` reads role from claims; gateway reads `act` → `onBehalfOf` |
| **The backend** (Jira/SAP/…) | Authorisation of every write at the system of record | Gateway forwards X's own token, or an IdP-minted delegated token |
| **OmniProject gateway** | Its *own* RBAC gates (RAID/portfolio/settings), project-scope visibility, the acting banner, and the **audit** | The *delegating broker* — must be provably honest about who did what |

The gateway never becomes an authority it isn't: it brokers and records, it does
not mint identity or override the backend.

---

## 3. Architecture at a glance

```
   Y (delegator)                         X (delegate)
      │ initiates grant (consent)            │ logs in as themselves
      ▼                                       ▼
 ┌──────────────────────── IdP (the authority) ────────────────────────┐
 │  time-bounded group / PIM activation  →  X's token gains role R       │
 │  RFC 8693 token exchange              →  token carries act={sub:Y}    │
 └──────────────────────────────────────────────────────────────────────┘
      │ token (role R, act=Y)                 │
      ▼                                        ▼
 ┌──────────────────── OmniProject gateway (broker) ─────────────────────┐
 │  contextFromReq → effective ctx { actor:X, role:R, onBehalfOf:Y,       │
 │                                   grantId, scope }                     │
 │  requireRole(effective) · project-scope gate · NO-CHAIN check         │
 │  ┌── precondition ──┐  if borrowed rights & cannot attribute → REFUSE  │
 │  audit (hash-chained, "X on behalf of Y")  ──► loggingSync egress      │
 └────────────────────────────────────────────────────────────────────────┘
      │ X's own token  (default)               │ IdP-minted delegated token (§5b)
      ▼                                         ▼
 ┌──────────────────── Backend system of record (authz) ─────────────────┐
 │  authorises X (default) — or the delegated token carrying act=Y        │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Grant lifecycle (state machine)

```
 (none) ──request/consent──▶ PENDING ──approve──▶ ACTIVE ──use──▶ ACTIVE
                               │                    │  │
                          (admin broker)            │  └─exp────▶ EXPIRED
                               │                    └─revoke──▶ REVOKED
                               └─deny──▶ DENIED
```

### 4.1 Initiation & consent
- **Y initiates** (or explicitly approves) every grant: picks delegate X, scope
  (role ≤ own; projects; optional action set), and duration (capped).
- **Admin may broker** when Y is unreachable — `admin`-gated, audited, Y notified.
  An admin brokering *for themselves* is self-granting and is **refused**.
- **Only a non-delegate may initiate** (P6): a session already acting under a
  delegation cannot create a grant (§11).
- **Least privilege by default:** UI defaults to read-only visibility + minimum
  role; Y opts up.

### 4.2 Activation
- The **IdP** activates: time-bounded group membership / PIM activation gives X's
  *next* token role R; a token-exchange step stamps `act={sub:Y}` (§5).
- The gateway's only durable artefact is the **hashed grant record** (§6) +, where
  used, the project-scope nomination (config).

### 4.3 Use → 4.4 Expiry/Revoke
- Each request re-derives the effective context from the *current* token (§5);
  nothing is cached across the TTL boundary.
- Expiry is the IdP token's `exp`; revoke is §7. Both are fail-closed: after
  either, X reverts to their plain session role with no further action needed.

---

## 5. Identity & token model

### 5a. Default — X writes as X (always available, safest)
The backend authorises X with X's *own* token. Delegation governs OmniProject's
own gates, project visibility and the *audit framing* ("X for Y"). If X lacks a
backend right, the write fails at the backend — correctly. **No new credential
handling.** This mode is built first and is always the fallback.

### 5b. Backend on-behalf-of — IdP-minted delegated token (preferred where supported)
Because we run the IdP, this is first-class: when the IdP supports **OAuth 2.0
Token Exchange (RFC 8693)**, the gateway exchanges X's token for a **short-lived,
scoped delegated token the IdP mints**, carrying `act={sub:Y}`, and forwards *that*
to the backend. OmniProject **requests** the exchange and relays the result; it
never sees or stores Y's raw token (P1). This is the only honest way a delegated
*backend* write happens.

### 5c. Effective context derivation (the heart of enforcement)
`contextFromReq` produces, per request, an **effective context**:

```ts
interface EffectiveContext {
  actor: { sub; email; role };       // X and X's OWN baseline role
  effectiveRole: Role;               // may be elevated by a grant (≤ Y's role)
  onBehalfOf: { sub; email } | null; // Y, iff a grant is in force
  grantId: string | null;            // ties every borrowed-rights action to its grant
  scopeProjects: string[] | null;    // project visibility the grant conveys
  scopeActions: string[] | null;     // optional per-action narrowing
  borrowed: boolean;                 // effectiveRole/scope exceeded actor's own → true
}
```

`borrowed` is the linchpin: an action is **delegated** exactly when `borrowed` is
true for *that* call (effective rights exceeded X's own rights). Own-rights actions
are logged normally; only borrowed-rights actions carry the on-behalf stamp (§8).

---

## 6. The delegation record — a one-way hash of person + access

Any record the gateway keeps (revocation/denylist, replay-dedup, "is this grant
known") holds a **one-way, non-reversible keyed fingerprint** over the **person and
their access**, never the readable contents:

```
fp = HMAC-SHA-256(                          // one-way: cannot be reversed to recover
       canonicalise({ delegator,            //   who, to whom, or what access
                      delegate, scope,
                      iat, jti }),
       gatewaySigningKey)
record = { fp, exp }                        // exp is the ONLY plaintext — a timestamp
```

- **Match, never read.** Revocation/replay checks recompute `fp` from the
  *presented, signature-verified* grant and match — the store never holds
  `delegator`/`delegate`/`scope` in any recoverable form.
- **Keyed (HMAC), not a bare digest** — without the gateway key, a reader cannot
  brute-force the small identity space to confirm "is X delegated to Y at role R".
- **Net effect:** the one stateful concession leaks no identities or access if read.
- **Exempt:** the project-scope *nomination* (§10) must stay readable because the
  gateway gates *by* it — it is config, not a grant record.

---

## 7. Revocation — layered, fastest-available wins

1. **Primary — short TTL.** The simplest revoke is expiry. Default TTL ≤ 4h,
   renewable. This bounds *all* exposure even if every other tier fails.
2. **Explicit revoke — status list.** Y or an admin revokes immediately. The list
   of revoked grants is the hashed `fp` set (§6); checked fail-closed at use time.
   Where built as the signed-grant fallback, prefer the IETF **OAuth Token Status
   List** shape (a compressed status bitstring) over an ad-hoc denylist — same
   privacy posture, standard form.
3. **Frontier — continuous access evaluation.** Where the IdP speaks **CAEP /
   OpenID Shared Signals Framework**, a revoke is *pushed* and kills an in-flight
   session mid-stream, not at next token refresh. Optional; short-TTL is the
   pragmatic floor when it's absent.

Revocation is **fail-closed**: a grant that is absent, expired, forged, or on the
status list confers nothing, and the attempted use is audited as a denial.

---

## 8. Full logging — "X on behalf of Y" (the centrepiece)

The logging model is not a side-effect of delegation; in this design it is a
**precondition for it**. The rule, the schema, the per-event coverage, and the
tamper-evidence follow.

### 8.1 The precondition (fail-closed)
> **Any action taken under someone else's permissions MUST be recorded as
> "X on behalf of Y" — or it does not happen.** Before performing a borrowed-rights
> mutation the gateway constructs the audit record; if it cannot populate
> `actor=X`, `onBehalfOf=Y` and `grantId`, it **refuses** the action (HTTP 403,
> audited as a denial). Never performed-then-logged-vaguely.

An action is "borrowed-rights" precisely when `EffectiveContext.borrowed === true`
(§5c). Own-rights actions are logged as normal `actor`-only events.

### 8.2 The audit event (extends `lib/audit.ts`)
```ts
interface AuditEvent {
  // existing: ts, category, action, actor{sub,email,role}, projectId, origin,
  //           write, result, status, ms, meta
  onBehalfOf?: { sub?: string; email?: string } | null; // Y, when borrowed
  grantId?: string | null;        // jti — ties the action to the grant
  borrowed?: boolean;             // true ⇒ this specific call used delegated rights
  borrowedRight?: string | null;  // the SPECIFIC right exercised under delegation
                                  //   e.g. "role:manager", "raid:approve", "project:p7:read"
  effectiveRole?: Role;           // the role used (may exceed actor.role)
  prevHash?: string;              // §8.4 tamper-evidence chain link
  hash?: string;                  // HMAC of this record incl. prevHash
}
```
- `actor` is **always X**, the real principal — never Y. `onBehalfOf` is **Y**.
  The pair, never a swap, is the whole point.
- `borrowedRight` records *which* permission was borrowed, so the trail
  distinguishes "X did this themselves" from "X did this for Y, using Y's manager
  rights to approve a RAID item". Granularity at the *permission*, not just the role.

### 8.3 What is logged (complete coverage — every lifecycle + every use)
| Event | Logged as |
| --- | --- |
| Grant requested / consented | `category:delegation action:grant.request` actor=Y |
| Grant approved / activated | `delegation grant.activate` actor=Y (or admin), meta: delegate, scope, exp |
| Admin-brokered grant | `delegation grant.broker` actor=admin, onBehalfOf=Y, meta: justification |
| Grant renewed | `delegation grant.renew` |
| Grant revoked / expired | `delegation grant.revoke` / `grant.expire` |
| **Borrowed-rights action (any write)** | the normal action event **+** `onBehalfOf`, `grantId`, `borrowed:true`, `borrowedRight`, `effectiveRole` |
| **Refused for un-attributable delegation** | `delegation denied.unattributable` (the §8.1 fail-closed branch) |
| Refused for scope / expiry / revoke / no-chain | `delegation denied.*` with the reason |
| Delegated *read* of scoped projects (optional, config) | `delegation read` with `onBehalfOf` — for high-assurance deployments that log visibility too |

No borrowed-rights mutation exists that is *not* in this table; that is what
"full logging" means here.

### 8.4 Tamper-evidence (append-only, verifiable)
Each audit record links to the previous by hash, forming a per-stream chain:

```
record.prevHash = previous.hash
record.hash     = HMAC-SHA-256(canonicalise(record \ {hash}), gatewaySigningKey)
```

- Any insertion, deletion or edit downstream breaks the chain and is detectable on
  verification — the delegation trail cannot be quietly rewritten.
- The chain is computed **at emit time**, before the record leaves the gateway via
  the `loggingSync` egress (the one sanctioned durable sink — same trust class as
  today's logging concession). OmniProject itself stays zero-data-at-rest; integrity
  travels *with* the record to wherever the operator collects it.
- Optional hardening for the highest assurance: periodically anchor the latest
  `hash` to an external transparency log / WORM store. Out of scope for v1, noted.

### 8.5 Rendering & access
- Reports, exports and the activity feed render **"X acting for Y"** with the
  `borrowedRight` and grant window. Never "Y did X".
- The acting banner (UX, §below) mirrors what the log will say, so X always sees
  the framing under which their actions are being recorded.

---

## 9. Enforcement points & fail-closed matrix

| Check | Where | Fail-closed outcome |
| --- | --- | --- |
| Resolve grant → effective ctx | `contextFromReq` | absent/expired/forged/revoked → plain session role |
| Role gate | `requireRole(effectiveRole)` | insufficient → 403, audited |
| Project-scope gate | data-reading routes | out of scope → 403, audited |
| **No-chaining** | grant-creation route | initiator is a delegate → 403, audited (§11) |
| **Attributability** | before any borrowed-rights write | cannot stamp X-for-Y → 403, audited (§8.1) |
| Backend authority | backend, via X's or IdP-minted token | backend refuses → surfaced, audited |
| Forwarded token | always X's own / IdP-minted | never Y's raw token (P1) |

Default everywhere is **no elevation**; elevation is the explicit, attributable,
in-scope exception.

---

## 10. Scope model (least privilege)
- **Role:** X's effective role ≤ Y's own role, capped at grant and use time.
- **Projects:** the specific projects/programmes Y nominates (the one readable
  config artefact, §6 exempt).
- **Actions (optional):** a narrowing set (e.g. `raid:approve` only) — the
  OmniProject-owned half regardless of IdP; recommended for sensitive grants.
- Scope is re-checked at **use** time, not just issuance — a grant narrowed or a
  project removed takes effect on the next request.

---

## 11. No re-delegation (depth-1, enforced at creation)
A delegate cannot become a delegator. The grant-creation route refuses if the
initiating session is itself acting under a delegation (`onBehalfOf` set, or its
token carries an `act` claim) → 403, audited. In the IdP path this also rejects
minting a grant from a token already carrying `act`, so nested `act` chains (which
RFC 8693 permits) never arise through OmniProject. Depth is capped at 1 by
construction; borrowed authority can never be re-lent (P6).

---

## 12. Threats → controls

| Threat | Control(s) |
| --- | --- |
| Privilege escalation above Y | Scope ≤ Y at grant+use (P3, §10); effective-role cap |
| Credential theft / replay of Y's token | Never stored/relayed; IdP-minted exchange only (P1, §5) |
| Confused deputy | Consent (P5); attributability precondition (P8, §8.1) |
| Lingering access | Hard `exp` (P4); layered revoke (P7, §7) |
| Non-consensual / self-grant | Y-initiated; no admin self-broker (§4.1) |
| Re-delegation fan-out | Depth-1 at creation (P6, §11) |
| Audit gap / impersonation in the log | actor=X always; precondition + hash-chain (P2/P8/P9, §8) |
| Store compromise reveals who-delegated-whom | One-way keyed hash record (§6) |
| Quiet rewrite of the trail | Tamper-evident chain (§8.4) |
| Forged / replayed grant | Signature + exp + delegate-binding + status list (§7) |

---

## 13. Phased build (each phase ships only after §17 passes)
- **Phase 1 — IdP-driven role elevation + full logging (the safe core).** IdP grants
  time-bounded membership → `roleForReq` (no role-path change); read `act` →
  `onBehalfOf`; project-scope nomination; **acting banner**; the complete §8 logging
  incl. precondition + hash-chain. **Writes go as X.** Flag-gated, off by default.
- **Phase 2 — backend on-behalf-of** (RFC 8693 exchange, §5b) where the IdP supports
  it: delegated *backend* writes without OmniProject touching Y's credential.
- **Phase 3 — frontier revocation** (CAEP/SSF continuous evaluation, §7.3) and the
  optional transparency-log anchor (§8.4).
- **Fallback track — OmniProject-signed grants** (RFC-004 §7b) + status list, built
  only for deployments whose IdP can't delegate.

---

## 14. Test plan (security-grade)
- Forged / expired / revoked / wrong-`sub` grant confers nothing (each tested).
- Borrowed-rights write with audit sink unavailable → **refused**, not performed
  (the precondition, P8).
- actor is X in 100% of delegated records; Y never appears as actor (property test).
- Hash-chain verification detects insert/delete/edit of any record.
- Re-delegation attempt (delegate initiates a grant) → 403, audited (P6).
- Scope narrowing / project removal takes effect on next request (use-time check).
- Store inspection yields no recoverable identity/scope (only `{fp, exp}`).
- Grant scope > Y's own rights is rejected at creation (P3).

---

## 15. Open decisions (inherited from RFC-004 §14 — decide before Phase 1)
1. **IdP primitive** — Authentik time-bounded group + `act` claim, enterprise PIM,
   and/or RFC 8693 exchange? (The keystone blocker.)
2. **Max TTL + renewability** — default/ceiling (proposed ≤ 4h) and IdP-policy vs.
   OmniProject check.
3. **Scope granularity** — role+project for Phase 1, or also per-action.
4. **Notification channel** — `/api/notifications/ingest`, email, or both.
5. **Fallback key + revocation** — reuse licence Ed25519 key or dedicated; status
   list now or short-TTL only.
6. **New here:** is the **tamper-evident hash-chain** (§8.4) in Phase 1 or Phase 3?
   (Recommended Phase 1 — it's cheap at emit time and it's the audit we're staking
   the whole feature on.)

---

## 16. UX (mirrors the log)
- **Delegate flow** (Y): delegate → scope (role ≤ own; projects; optional actions)
  → duration (capped) → confirm, with a plain-language summary.
- **Acting banner** (X): persistent, hazard-styled — "You are acting for **Y**
  (manager · 2 projects) until **17:00** — your actions are logged as *you on
  behalf of Y*" — with one-click "stop acting".
- **Manage / revoke:** Y and admins see active grants and revoke instantly.

---

## 17. Security-review sign-off (gate for every phase)
Inherits RFC-004 §15 in full, **plus**:
- [ ] `borrowed`/`borrowedRight` correctly set: own-rights actions are *not*
      stamped on-behalf; every borrowed-rights action *is*, at permission
      granularity (tested).
- [ ] The §8.1 precondition is enforced *before* the write — audit-sink failure
      blocks the action (tested), it does not degrade to unlogged.
- [ ] Audit records are hash-chained and verification detects tampering (tested).
- [ ] Backend on-behalf (§5b) uses only an IdP-minted token; Y's raw token never
      appears in any code path (reviewed).
- [ ] Revocation (TTL + status list + CAEP where present) is fail-closed and
      bounded by a short default TTL even if every higher tier is absent.

**No build until RFC-004 §14 is decided and both checklists are owned by a named
reviewer.**
