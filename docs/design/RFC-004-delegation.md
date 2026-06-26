# RFC-004 — Delegation / temporary access transfer

**Status:** Design — **not started, do not build without security review.** This
is the highest-risk item on the roadmap; the RFC exists so the threat model and
the *limits of what is safe* are agreed before any code. **Revised to put the IdP
first** (§2a): OmniProject ships Authentik / integrates enterprise SSO, so the IdP
owns the grant; OmniProject consumes its claims rather than inventing its own
delegation/credential mechanism.

> **This RFC is the threat model + limits.** The concrete, build-ready *hardened
> design* — grant lifecycle, identity/token model, the one-way-hash store, layered
> revocation, and the complete tamper-evident **"X on behalf of Y"** logging
> design — is **[RFC-005](RFC-005-secure-delegation-design.md)**. Read this for
> *what is safe and why we refuse the rest*; read RFC-005 for *how to build the
> most secure version*. RFC-004's anti-goals (§4) win any conflict.
**Author:** build session.
**Depends on / touches:** the security model (OIDC token forwarding via
`ActorContext`, RBAC `roleForReq`/`requireRole`), the audit pipeline
(`lib/audit.ts`), the stateless / zero-data-at-rest posture, and the broker seam.

---

## 0. One line + the warning

> Let a delegator **Y** grant a delegate **X** *temporary, scoped, revocable,
> audited* access so X can keep work moving while Y is away — **X always acting
> as themselves, never holding Y's credentials.**

Delegation is the classic **confused-deputy** generator. Done casually it becomes
silent privilege escalation, credential theft, or lingering access nobody
remembers granting. The whole point of this RFC is to define the *narrow* version
that is safe in OmniProject's architecture and to **refuse the dangerous version
outright** (§4).

---

## 1. Motivation

Real asks this serves: "approve RAID items while I'm on leave", "the PMO covers
my programme this fortnight", "hand my projects to a deputy during handover".
Today the only options are sharing a login (catastrophic) or an admin doing it
manually with no audit trail. Both are worse than a designed feature.

---

## 2. The architectural constraint (why this is genuinely hard here)

OmniProject is **stateless and zero-data-at-rest**, and **the backend system of
record owns authorisation**. Writes happen *as the real user* because the
gateway forwards that user's **own** OIDC access token to the backend
(`ActorContext.token`/`authHeader`, `contextFromReq`). The gateway's RBAC
(`viewer/contributor/manager/admin`, derived by `roleForReq` from OIDC claims)
gates *OmniProject's own* actions; it does **not** override what the backend will
allow.

Two hard consequences:

1. **OmniProject cannot grant backend access it does not control.** If X uses X's
   token, the backend authorises X — full stop. OmniProject can't make Jira/SAP
   treat X as Y.
2. **There is nowhere to safely keep Y's credential.** Statelessness means no
   credential store; relaying Y's access token on X's behalf would mean holding
   or proxying a live credential — a credential-theft surface and a flat
   contradiction of the design. **We will not do this** (§4).

So "act with the delegator's access" has a precise, limited meaning here (§5).

---

## 2a. Delegate to the IdP we already run (the primary mechanism)

OmniProject ships with **Authentik** (standalone) and integrates **enterprise SSO**
(Entra ID, Okta, Ping, Keycloak…). The IdP is *already* the authority for identity
and role assignment — `roleForReq` derives the OmniProject role straight from OIDC
group/role **claims** (`OIDC_ADMIN_ROLES`, `OIDC_MANAGER_ROLES`, …). The right
instinct, and the one a security review will demand, is therefore: **don't invent
a delegation/credential system in OmniProject — delegate to the IdP.** This is more
secure (the auth authority owns it), keeps OmniProject stateless (the grant lives
in claims/tokens, not a gateway store), and means **no new signing key to manage**.

Concretely, delegation decomposes into three parts, each owned by the system
entitled to it:

| Part | Owner | Mechanism |
| --- | --- | --- |
| **Identity & role elevation** (X temporarily acts at a higher OmniProject role) | **The IdP** | Time-bounded **group/role membership** — Authentik group assignment, or enterprise **PIM / time-bound role activation** (Entra PIM, Okta, etc.). OmniProject already consumes this via `roleForReq`; **the role half needs no new OmniProject code.** Expiry, revocation and the grant's own audit are the IdP's job. |
| **"On behalf of" provenance** (this token is X acting for Y) | **The IdP** | The standards-based **`act` / `may_act` actor claim** (OAuth 2.0 Token Exchange, RFC 8693). OmniProject reads it and sets `onBehalfOf` for the audit (§9). |
| **Backend write authority** (a delegated write at the system of record) | **The IdP + backend** | An **IdP-minted delegated/exchanged token** (RFC 8693 / on-behalf-of) the gateway carries — never Y's raw token (§6). |

What's left for **OmniProject** is only the thin part the IdP doesn't model:
**project-scoped visibility** (which of Y's projects a deputy may see is finer
than a group), and **rendering/auditing** the delegation (the banner + `onBehalfOf`).

The OmniProject-signed grant token in §7 is therefore demoted to a **fallback** for
deployments whose IdP can't express time-bounded delegation — not the default.

---

## 3. Threat model

Defending against:

- **Privilege escalation** — X ending up able to do more than Y could, or more
  than Y intended.
- **Credential theft / replay** — any path where Y's token is stored, logged, or
  relayed.
- **Confused deputy** — the gateway performing an action "for Y" that Y never
  consented to.
- **Lingering access** — a grant that outlives its need (no expiry / no revoke).
- **Non-consensual delegation** — X or an admin granting *themselves* Y's access
  without Y's consent.
- **Audit gaps** — an action that can't be traced to "X acting for Y".
- **Replay / forgery of the grant** itself.

Assume the IdP and backend are trusted to authenticate and authorise; OmniProject
is the **delegating broker** and must be provably honest about who did what.

---

## 4. Anti-goals (the dangerous version we refuse)

- **No storing or relaying the delegator's backend credential / OIDC token.** X
  never acts at the backend with Y's token. (Kills credential theft + keeps us
  stateless.)
- **No impersonation.** X is never presented to the backend or the audit log *as*
  Y. Every record is "X **on behalf of** Y".
- **No open-ended grants.** Every grant has a hard expiry; there is no "until
  revoked" without a max TTL.
- **No self-granting.** X cannot grant themselves Y's access; an admin acting as
  broker is itself consented-to and audited.
- **No escalation above the delegator.** A grant can only ever convey a subset of
  Y's own access — never more.
- **No re-delegation / no chaining.** A delegate cannot become a delegator while a
  grant to them is active: X, acting under Y's delegation, cannot delegate to a
  third party Z. Delegation chains are capped at depth 1. This holds even for X's
  *own* rights — while X is in a delegated state we refuse any grant X initiates,
  rather than try to disentangle borrowed authority from own authority mid-chain.
  (Borrowed rights are not "X's own" and so could never be passed on under the
  rule above anyway; this makes the refusal explicit and fail-closed.)
- **No silent delegation.** Y consents; X sees a banner; both are audited.

---

## 5. What CAN be delegated (the safe subset)

Delegation conveys, time-boxed and scoped:

1. **Gateway RBAC elevation** — X temporarily gains an OmniProject role **≤ Y's**
   (e.g. Y, a manager, lets X act at `manager` for RAID/baseline/portfolio
   actions in OmniProject). Enforced at `requireRole`. Capped at Y's own rank.
2. **Scoped visibility** — read access to the specific projects/programmes Y
   nominates, so a deputy can *see* Y's portfolio in OmniProject's read views.

This covers the real asks **for everything OmniProject itself gates**. It does
**not** magically grant backend write access X doesn't already have — see §6.

The elevation conveyed is **not itself delegatable**: an X acting at `manager`
under Y's grant holds that role only to *use*, not to *lend on*. Re-delegating it
(X → Z) is refused (§4, §8) so authority never fans out beyond the person Y chose.

---

## 6. Backend writes stay with the system of record

When X performs a write under a delegation, two honest modes:

- **Default — X writes as X.** The backend still authorises X with X's own token.
  Delegation governs OmniProject-side gates, visibility and the *audit framing*
  ("X for Y"). If X lacks backend rights, the write fails at the backend, as it
  should. This is safe, requires no new credential handling, and is the only mode
  we build first.
- **Backend-native on-behalf-of (preferred where the IdP supports it).** Because
  we run the IdP, this is a first-class path, not a distant maybe: when the IdP
  supports OAuth 2.0 **Token Exchange (RFC 8693)** or a backend "act-as" grant, the
  gateway exchanges X's token for a **delegated token the IdP mints** — scoped,
  short-lived, carrying the `act` claim "X for Y" — and forwards *that* to the
  backend. OmniProject **requests** the exchange and relays the result; it never
  sees or stores Y's raw token. This is the only way a delegated *backend* write
  is both possible and honest, and it falls out of the IdP we already operate.

This split is the crux: OmniProject delegates *its own* authority cleanly, and
defers *backend* authority to the only system entitled to delegate it.

---

## 7. The grant

### 7a. Primary — the IdP holds the grant

Per §2a, the grant *is* the IdP's time-bounded group/role membership (+ the `act`
claim on the issued token). OmniProject stores **nothing**: it reads the role from
claims (`roleForReq`, unchanged) and `onBehalfOf` from the actor claim. Expiry and
revocation are the IdP's — revoke = the IdP drops the membership / the short-lived
token expires. This is the default and the most secure option, and it adds **no
signing key, no grant store, and (for the role half) no new gateway code**. The
only OmniProject-side state is the optional project-scope nomination (§5.2), which
is config, not a credential.

### 7b. Fallback — an OmniProject-signed grant (only when the IdP can't)

For deployments whose IdP **cannot** express time-bounded delegation, fall back to
a **signed, self-expiring grant token**, exactly like the licence mechanism
(`lib/license.ts`, Ed25519 sign/verify):

```
grant = sign({
  v: 1,
  delegator: { sub, email },     // Y
  delegate:  { sub },            // X — bound to X's identity
  scope: { role: "manager", projects: ["proj-1","proj-7"] },  // ≤ Y's access
  iat, exp,                      // hard expiry (minutes–hours, capped)
  jti                            // unique id, for audit + revocation
}, gatewaySigningKey)
```

- **Verification** is stateless: the gateway checks the signature, that `exp`
  hasn't passed, and that the **current session's `sub` === `delegate.sub`** (a
  grant is useless to anyone but X).
- **Revocation** is primarily **short TTL** — the simplest revoke is expiry, so
  default TTLs are short (e.g. ≤ 4h) and renewable. Explicit early revoke needs a
  **denylist**, which *is* small state; that is the one deliberate,
  clearly-flagged concession (mirrors how `loggingSync` is the one egress
  concession). Keep it tiny, in the settings store, auto-pruned at `exp`.
- **Store a one-way hash of person + access, never the details.** Any record the
  gateway keeps of a grant — the denylist row, replay/dedup tracking, "is this
  grant known" — holds a **one-way, non-reversible fingerprint** computed over the
  **person *and* their access details**, not the readable contents. The hashed
  input is exactly: the identities (`delegator.sub`/email **and** `delegate.sub`)
  **plus** the access conveyed (`scope.role`, `scope.projects`) **plus** `iat`/`jti`
  to make each grant's fingerprint unique. The record is:

  ```
  fp = HMAC-SHA-256(                       // one-way: cannot be reversed to recover
        canonicalise({ delegator, delegate,//   who, to whom, or what access
                       scope, iat, jti }),
        gatewaySigningKey)
  record = { fp, exp }                     // exp is the only plaintext — a timestamp,
                                           //   not an identity — needed to auto-prune
  ```

  The hash is **non-reversible by construction**: even OmniProject cannot turn a
  stored `fp` back into the person or their access — it can only *recompute* `fp`
  from a *presented, signature-verified* grant and check for a match. So
  revocation/replay checks work without the store ever holding
  `delegator`/`delegate`/`scope` in any recoverable form. Keying the hash with the
  gateway key (HMAC, not a bare digest) additionally stops anyone who reads the
  store from confirming a guessed "is X delegated to Y at role R" by hashing
  candidates offline — without the key they cannot even brute-force the small
  identity space. **Net effect:** even the one stateful concession leaks no
  identities or access if the settings store is read; it is a set of opaque,
  irreversible fingerprints with expiry. The live grant details themselves exist
  only in the signed token the holder presents (§7b) or in the IdP (§7a), never at
  rest in OmniProject.

> Note the project-scope **nomination** (§5.2) is different: it must stay readable
> because the gateway gates *by* it (which projects the deputy may see), so it is
> config, not a credential — it is not hashed. The hash rule is for the grant
> **record** (revocation/replay), which only ever needs *match*, not *read*.

---

## 8. Consent & initiation

- **Y initiates** (or explicitly approves) every grant — picks the delegate,
  scope (role ≤ own, projects), and duration. X cannot self-serve.
- **Only a non-delegate may initiate.** Y must be granting their **own** standing
  access. A session that is *itself* acting under a delegation (its effective role
  came from an inbound grant — `onBehalfOf` is set) **cannot create a grant**: the
  delegate-turned-delegator path is refused, so a borrowed role can never be
  re-lent. This is the consent-side face of the no-chaining anti-goal (§4).
- An **admin may broker** a grant (e.g. Y is unreachable on leave) — but that act
  is itself `admin`-gated, **audited**, and Y is notified. An admin brokering for
  themselves is the same as self-granting and is refused.
- Scope is **least-privilege by default**: the UI defaults to read-only visibility
  and the minimum role, with the delegator opting up.

---

## 9. Audit — provably "X acting for Y"

> **Invariant (non-negotiable): any action taken under someone else's permissions
> MUST be recorded as "X on behalf of Y".** This is a *precondition*, not a
> side-effect — the gateway will not perform a delegated mutation it cannot so
> attribute. If, at the moment of acting, the effective role came from a
> delegation but the audit record can't carry `onBehalfOf` + `grantId`, the action
> is refused (fail-closed), not performed-then-logged-vaguely. An action is
> "delegated" precisely when X's *effective* rights exceeded X's *own* rights for
> that call.

Extend `AuditEvent` (`lib/audit.ts`) with an explicit on-behalf field; every
delegated action carries it:

```ts
interface AuditEvent {
  // … existing: ts, category, action, actor{sub,email,role}, projectId, write, result, status, ms, meta
  onBehalfOf?: { sub?: string; email?: string } | null;  // Y, when acting under a grant
  grantId?: string | null;                               // jti, ties the action to the grant
}
```

- The `actor` stays **X** (the real principal); `onBehalfOf` is **Y**. Never the
  reverse — X is never logged *as* Y.
- Actions X takes with X's **own** rights are logged normally (just `actor`); only
  rights that came from a delegation carry the on-behalf stamp — so the log
  distinguishes "X did this" from "X did this for Y".
- Reports/exports and the activity feed render "**X acting for Y**".
- Granting, brokering, renewing and revoking are themselves audited events.

---

## 10. Enforcement points

- **Where:** the per-request context builder (`contextFromReq`) resolves an
  active grant for the session and produces an *effective* role + `onBehalfOf`;
  `requireRole` checks the effective role; routes that read project data check
  the grant's project scope.
- **Fail-closed:** an absent/expired/forged/denylisted grant → no elevation,
  plain session role. A scope check that can't be satisfied → 403, audited.
- **No-chaining is enforced at grant *creation*.** The grant-creation route
  refuses if the initiating session is itself acting under a delegation
  (`onBehalfOf` set on its effective context) → 403, audited. In the IdP path this
  also means rejecting any attempt to mint a grant from a token that already
  carries an `act` claim, so nested `act` chains (RFC 8693 permits them) never
  arise through OmniProject. Depth is thereby capped at 1 by construction.
- **Never elevates the forwarded token.** The backend `Authorization` header is
  still X's own (or, in §6's optional mode, the IdP-minted delegated token) —
  never Y's.

---

## 11. UX

- **Delegate flow** (Y): choose delegate → scope (role ≤ own; projects) →
  duration (capped) → confirm. Plain-language summary: "Alex can act as manager on
  *Platform* and *SSO* until 17:00 today, on your behalf."
- **Acting banner** (X): an unmistakable, persistent banner — "You are acting for
  **Y** (manager · 2 projects) until **17:00**" — with a one-click "stop acting".
  Same hazard-styling discipline as the explore "NOT LIVE" ribbon.
- **Manage / revoke:** Y (and admins) see active grants and revoke instantly.
- **Visibility of the trail:** the activity feed shows delegated actions tagged
  "for Y".

---

## 12. Phased rollout

- **Phase 1 — IdP-driven delegation (the safe core).** The IdP grants X
  time-bounded membership of the group that maps to the elevated role; OmniProject
  consumes it via `roleForReq` (**no change to the role path**), reads the `act`
  claim → `onBehalfOf`, adds the project-scope nomination, the **acting banner**,
  and the audit framing. Expiry/revoke are the IdP's. **Writes go as X.** Behind a
  flag, **off by default**, enabled per deployment. Most of this is *consuming
  claims we already trust*, which is why it's the safest place to start.
- **Phase 2 — backend on-behalf-of** (RFC 8693 token exchange) where the IdP
  supports it, so a delegated *backend* write is possible without OmniProject ever
  touching Y's raw credential (§6). The natural next step given we run the IdP.
- **Fallback track — OmniProject-signed grants** (§7b) + a `jti` denylist, built
  **only** for deployments whose IdP can't express delegation. Strictly secondary;
  carries the extra key-management + revocation burden the IdP path avoids.

Each phase ships only after the §15 checklist passes.

---

## 13. Alternatives considered

- **Shared logins** — rejected (no audit, no scope, no expiry; the status quo we're
  replacing).
- **Store/proxy the delegator's token** — rejected (§4: credential theft surface +
  breaks statelessness).
- **Pure admin role-swap with no grant object** — rejected (no consent, no scope,
  no per-action "for Y" framing).
- **Backend-only delegation (do nothing in OmniProject)** — viable where the
  backend has native delegation, but leaves OmniProject's own gates (RAID,
  portfolio, settings) and audit framing unaddressed; Phase 3 composes with it.

---

## 14. Open questions (decide before Phase 1)

1. **IdP delegation primitive** — which mechanism per deployment: Authentik
   time-bounded group membership, enterprise PIM (Entra/Okta), and/or RFC 8693
   token exchange? Confirm Authentik can express a time-bounded group + emit the
   `act` claim (or what the closest supported equivalent is).
2. **Max TTL + renewability** — default and ceiling for the IdP grant (proposed
   ≤ 4h, renewable) — and whether that's an IdP policy or an OmniProject check.
3. **Scope granularity** — role + project list for Phase 1, or also per-action
   (e.g. "RAID only")? (This is the OmniProject-owned half regardless of IdP.)
4. **Notification channel** for "you were delegated / your access was used" — via
   `/api/notifications/ingest`, email, or both?
5. **Fallback only:** if a deployment's IdP can't delegate, reuse the licence
   Ed25519 key or a dedicated grant key, and denylist now or rely on short TTL?

---

## 15. Security-review checklist (gate for every phase)

- [ ] **Delegation is the IdP's** wherever it can express it; OmniProject only
      *consumes* the role claim + `act` claim and adds project-scope/audit/banner.
      The signed-grant fallback (§7b) is built only when the IdP can't.
- [ ] No code path stores, logs, or forwards the **delegator's** token/credential.
- [ ] `actor` is always the real principal **X**; `onBehalfOf` is **Y**; never swapped.
- [ ] A grant's scope is provably **≤ the delegator's own** access at grant time.
- [ ] X cannot self-grant; admin-brokered grants are audited and notify Y; no
      admin self-broker.
- [ ] **No re-delegation.** A session acting under a delegation (`onBehalfOf` set,
      or token carrying an `act` claim) cannot create a grant; chains are capped at
      depth 1; refusal is at grant creation, fail-closed and audited (tested).
- [ ] Every grant has a hard `exp`; no unbounded grants; default TTL short.
- [ ] Grant verification is fail-closed (signature + exp + delegate-binding) and
      bound to the current session `sub`.
- [ ] Every action under delegated rights is recorded "X on behalf of Y" as a
      **precondition** — a delegated mutation that can't be so attributed is
      refused, not silently performed. Grant/broker/renew/revoke are also audited.
- [ ] The acting banner is always shown while a grant is effective; "stop acting"
      works instantly.
- [ ] Forged / expired / denylisted grants confer nothing (tested).
- [ ] Any at-rest grant **record** stores a **one-way, non-reversible keyed hash
      (HMAC)** over the **person + their access** (delegator/delegate identity +
      role/project scope) plus `exp` only — never those details in any recoverable
      form; revocation/replay checks work by recomputing and matching the
      fingerprint, and a stored record cannot be reversed to recover who/whom/what
      (tested). (The readable project-scope nomination is config, not a grant
      record, and is exempt.)
- [ ] Off by default; enabling is an explicit, documented, admin decision.

No build until §14 is decided and this checklist is owned by a reviewer.
