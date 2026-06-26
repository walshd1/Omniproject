# RFC-004 — Delegation / temporary access transfer

**Status:** Design — **not started, do not build without security review.** This
is the highest-risk item on the roadmap; the RFC exists so the threat model and
the *limits of what is safe* are agreed before any code.
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

---

## 6. Backend writes stay with the system of record

When X performs a write under a delegation, two honest modes:

- **Default — X writes as X.** The backend still authorises X with X's own token.
  Delegation governs OmniProject-side gates, visibility and the *audit framing*
  ("X for Y"). If X lacks backend rights, the write fails at the backend, as it
  should. This is safe, requires no new credential handling, and is the only mode
  we build first.
- **Optional — backend-native on-behalf-of.** *If and only if* the IdP/backend
  supports a standard delegation flow (OAuth 2.0 **Token Exchange, RFC 8693**, or
  a backend "act-as" grant), the gateway may carry a **delegated token the IdP
  minted** — scoped, short-lived, issued *to X for Y* by the authority that owns
  authz. OmniProject **requests** the exchange and forwards the result; it never
  sees or stores Y's raw token. This is backend-specific, off by default, and a
  later phase.

This split is the crux: OmniProject delegates *its own* authority cleanly, and
defers *backend* authority to the only system entitled to delegate it.

---

## 7. The grant — stateless by construction

A grant is access state, which we keep faithful to the stateless posture by
modelling it as a **signed, self-expiring token**, exactly like the licence
mechanism (`lib/license.ts`, Ed25519 sign/verify):

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
  **`jti` denylist**, which *is* small state; that is the one deliberate,
  clearly-flagged concession (mirrors how `loggingSync` is the one egress
  concession). Keep it tiny, in the settings store, auto-pruned at `exp`.

---

## 8. Consent & initiation

- **Y initiates** (or explicitly approves) every grant — picks the delegate,
  scope (role ≤ own, projects), and duration. X cannot self-serve.
- An **admin may broker** a grant (e.g. Y is unreachable on leave) — but that act
  is itself `admin`-gated, **audited**, and Y is notified. An admin brokering for
  themselves is the same as self-granting and is refused.
- Scope is **least-privilege by default**: the UI defaults to read-only visibility
  and the minimum role, with the delegator opting up.

---

## 9. Audit — provably "X acting for Y"

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
  reverse.
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

- **Phase 1 — OmniProject-scoped delegation.** Signed short-TTL grants; gateway
  RBAC elevation (≤ delegator) + project-scoped visibility; `onBehalfOf` audit;
  consent + acting banner + revoke-by-expiry. **Writes go as X.** Behind a flag,
  **off by default**, admin-enabled per deployment. This is the whole safe core.
- **Phase 2 — explicit revocation** via a `jti` denylist (only if short TTLs
  prove insufficient operationally).
- **Phase 3 — backend on-behalf-of** (RFC 8693 token exchange) for backends/IdPs
  that support it, so a delegated *backend* write is possible without OmniProject
  ever touching Y's raw credential. Backend-specific, opt-in.

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

1. **Max TTL + renewability** — default and ceiling (proposed ≤ 4h, renewable).
2. **Denylist now or later** — accept "revoke = wait for expiry" for Phase 1, or
   build the `jti` denylist immediately?
3. **Multi-replica grant signing** — reuse the licence Ed25519 key, or a
   dedicated gateway grant key? (Affects key management.)
4. **Notification channel** for "you were delegated / your access was used" — in
   `/api/notifications/ingest`, email, or both?
5. **Scope granularity** — role + project list for Phase 1, or also per-action
   (e.g. "RAID only")?

---

## 15. Security-review checklist (gate for every phase)

- [ ] No code path stores, logs, or forwards the **delegator's** token/credential.
- [ ] `actor` is always the real principal **X**; `onBehalfOf` is **Y**; never swapped.
- [ ] A grant's scope is provably **≤ the delegator's own** access at grant time.
- [ ] X cannot self-grant; admin-brokered grants are audited and notify Y; no
      admin self-broker.
- [ ] Every grant has a hard `exp`; no unbounded grants; default TTL short.
- [ ] Grant verification is fail-closed (signature + exp + delegate-binding) and
      bound to the current session `sub`.
- [ ] Every delegated action — and every grant/broker/renew/revoke — is audited.
- [ ] The acting banner is always shown while a grant is effective; "stop acting"
      works instantly.
- [ ] Forged / expired / denylisted grants confer nothing (tested).
- [ ] Off by default; enabling is an explicit, documented, admin decision.

No build until §14 is decided and this checklist is owned by a reviewer.
