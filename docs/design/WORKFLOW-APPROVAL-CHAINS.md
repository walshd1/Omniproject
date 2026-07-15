# Workflow creator + approval chains — design note

Status: **design, not built.** This is the written target for a large, security-critical feature designed
across conversation. It records the model, what is genuinely new vs. reused, the crypto guarantees, and the
build order — so implementation doesn't drift or duplicate existing code.

## 0. Primary threat model — the malicious insider

The design optimizes against a **legitimate insider abusing their access** (up to and including a privileged
PMO/admin, or someone with server/DB/infra access), not just an outside attacker. Where it already stands:

- **Infra / DB / server insider cannot forge an approval.** The gateway stores only PUBLIC keys; every
  approval is a live hardware signature whose private key never leaves the approver's authenticator. A
  malicious DBA, a leaked backup, or a rogue gateway operator has nothing to sign with.
- **A single malicious approver cannot self-authorize.** Separation of duties (the proposer can never
  approve) + multi-stage chains mean a high-impact action needs *other, distinct* people — one bad actor
  can't push it through alone.
- **Session hijack ≠ approval forgery.** A stolen session can *request* an approval but can't *sign* it
  (no authenticator), so it can't impersonate an approver.
- **Everything is non-repudiable + detectable.** Every approval, bypass, relaxation and revocation is
  passkey-signed (attributable to a named person) and written to the immutable, hash-chained audit log.

**Residual insider risk = the single-actor PRIVILEGED powers.** Today a lone PMO/admin can, by themselves:
bypass a chain, redirect a stage to a colluder, define a deliberately weak chain, relax the sensitive-data
no-go, or grant AI-approval authority. These are signed + audited (so never *invisible*), but not *prevented*.

**THE GOVERNING INVARIANT — ratchet security, never loosen it alone.** No lone insider — whatever their role
— may unilaterally do *anything that REDUCES the security posture*. They may *increase* it freely (single
actor, audited); any action that *reduces* it requires **≥2 distinct human passkey sign-offs** (dual-control /
its own approval chain). This asymmetry is the RULE that classifies every action:

- **Tightening** (add a sensitive-data rule, add an approval stage, make a chain stricter, revoke a key,
  narrow a scope, enable a guard) → single actor, admin-gated, audited.
- **Loosening** (relax the sensitive-data no-go, remove/weaken a stage or chain, grant AI authority, bypass,
  redirect, widen a scope, disable a guard, broaden egress/RBAC) → **dual-control**, so subversion takes
  *collusion of ≥2*, every hand attributable + hash-chain-audited.

Fail-**safe** *denying* actions (revoke) are "tightening", so single-actor is fine. Least privilege throughout.
The four items below are the first instances; the invariant is meant to extend to every security-relevant
setting (a follow-on classification pass gates each security-REDUCING setting behind dual-control).

**Settled — these FOUR require two distinct human passkey sign-offs (dual-control):**
1. **Chain bypass** — a second PMO/admin co-signs the force-approve.
2. **Sensitive-data relaxation** (§4.6) — two admin/PMO sign-offs to open the AI data no-go.
3. **Grant AI-approval authority** (§4.3) — a second human co-signs the responsibility acceptance.
4. **Stage redirect** — a second sign-off (and a redirect can never target the redirector; never shrinks the
   approver count).

Mechanism: **reuse the approval-chain engine itself** — each of these is just a small proposal requiring two
DISTINCT eligible signers (neither the initiator). This needs one engine addition: a
`requireDistinctApprovers` flag so the *same* person can't satisfy two stages (true N-distinct-human control).
Revoke stays single-actor (fail-safe) but audited.

## 1. What we're building

An **admin/PMO/PM-gated workflow creator**: a signed-in user (bounded by their RBAC scope) composes
workflows that can make requests to/from the broker with **iteration** and **conditional branching**, send
data to **outputs / notifications**, and **create reports**. Workflows are stored as JSON in the **project or
org** config.

The **genuinely new** capability that falls out of this — and is useful everywhere, not just here — is
**approval chains**: an optional, N-stage, cryptographically-signed approval gate that can be attached to
**any sensitive action** in the system. Approval chains are the core deliverable; the workflow engine is
largely a *caller* of existing surfaces.

**Human-first, AI optional.** A workflow — and any approval chain in it — may be **fully human / manual**
(manual steps, human approvals, no AI at all), **fully autonomous** (AI, only where a human has signed off per
§4), or **any mix of manual and AI**. AI is never required; it is an *optional participant*. Everything in §4
(the AI responsibility acceptance, the sensitive-data no-go, AI grants) applies **only where AI is actually
used** — a purely-human workflow needs none of it and simply runs on manual steps + human approvals. The
default, zero-config shape of this feature is entirely human.

## 2. What already exists (reuse, do not rebuild)

| Need | Existing code |
| --- | --- |
| Arbitrary broker request | `routes/broker-command.ts` (`POST /broker/command`, manager+) |
| Two-person approval (maker-checker) | `lib/dual-control.ts` — proposal + registered executor + shared queue |
| AI-actor keying | `lib/autonomous-grant.ts` / `broker/autonomous-guard.ts` — default-deny, scoped, capped, time-boxed, audited |
| Notifications / outputs | `lib/notify-bus.ts`, notification-kinds |
| Reports | `@workspace/backend-catalogue` `availableReports` |
| RBAC + scope | `requireRole`, `assertProjectScope`, project/programme scope |
| Org / project JSON config | `lib/settings.ts` (org) + project/programme config |
| Server signing | `lib/signing.ts` |
| Sensitive-data / AI DLP | `lib/ai.ts` `redactForEgress` / `AI_DLP_REDACT` (posture flips opt-in → default-deny) |
| Query engine (for report/filter steps) | `lib/jql.ts` (this branch), OData `applyODataQuery` |
| Approver inbox surface | `pages/MyWork.tsx` + notify-bus |

The chain engine **generalizes `dual-control`** (its single checker → N stages) and reuses its safety property:
proposals carry **params only, never code** — the executor is a pre-registered function keyed by action id.

## 3. Approval chains — the model

- **Definition scope**: a chain is defined by a **PMO** (org-level) and/or a **PM** (internal to a project).
  Stored in org/project JSON.
- **Stages**: sequential (each must approve before the next is asked). A stage names its approver(s) by
  **RBAC role OR named individual(s)** — **human by default**. An **AI approver is an optional stage type**,
  permitted only under the §4 rules (signed responsibility acceptance, etc.); a chain with no AI stage is a
  purely-human approval flow and touches none of §4. (Quorum-per-stage is a later extension.)
- **Delivery**: each pending approval lands in the approver's **inbox** (MyWork + a notification).
- **Rejection**: behaviour is **configurable per chain** (abort+notify, or send back one stage).
- **PMO escape hatch**: a PMO may **redirect** (reassign a stage) or **bypass** (override) a chain. Both are
  themselves powerful, human-only, passkey-signed, and audited — a bypass is never silent.
- **What it gates**: **any sensitive action** — generalizes `DUAL_CONTROL_ACTIONS`. An action id (config
  change, bulk action, a workflow RUN, a specific broker write, a workflow STEP) can be bound to a chain.
  **Optional throughout**: no binding ⇒ no chain ⇒ unchanged behaviour (off by default).

## 4. The crypto guarantee — signed, unforgeable, per-approval

Requirement: *each approval is separately keyed, and only the approver can satisfy the key — no approval can
be forced, not even by the server.*

**Humans → WebAuthn / passkeys.**
- One-time **passkey registration** per approver: the private key is generated in and never leaves their
  authenticator (Touch ID / Face ID / security key). The server stores **only the public key**, against `sub`.
- **Each approval is separately keyed**: the server issues a unique challenge = `hash(proposalId | stage |
  canonical(action+params) | one-time-nonce)`. The device signs *that* challenge. A signature is therefore
  bound to one specific approval — it cannot be replayed, reused, or pre-computed.
- **Only the approver can satisfy it**: only their device holds the private key, so **the gateway cannot
  forge an approval**. Verification is against the stored public key (Node `crypto`; no external SDK needed).
- The signed assertion is recorded in the shared proposal queue + the audit chain (non-repudiation).

**AI → the same shape, with great care (the asymmetry).** *(This whole subsection applies ONLY where a
workflow/chain actually uses AI. A human-only or manual workflow uses none of it.)*
- An AI actor has no authenticator; its key is **software/server-held**, so the server *could* produce an AI
  signature. An AI approval is therefore **cryptographically weaker** and must never be counted as a human one.
- Guardrails:
  1. **Key-class segregation** — AI signs with a distinct, **grant-bound autonomous key** (reusing
     `autonomous-grant`); an AI-signed approval is marked as such in the queue + audit. A stage that requires a
     **human passkey can never be satisfied by an AI signature**.
  2. **AI may be the sole approver — but ONLY under a standing, signed human responsibility acceptance** —
     an AI *can* be the only approver of a stage (or run the whole chain autonomously) at run time, but only
     for a workflow a **named human has reviewed in detail** — its logic, its outputs, and the AI's actions —
     and **passkey-signed to accept personal responsibility for its correctness and safety**. Accountability
     is thus established **up front, at authorization time**, so the AI can then act autonomously at run time
     without a human in each chain. That signed acceptance **is** the per-workflow human grant (#3), bound to
     the workflow's exact version (content hash) **AND** to the signer's active presence. It is **voided** by
     EITHER:
       - (a) **any change** to the workflow or the AI's actions (the content hash no longer matches), OR
       - (b) the **responsible signer's removal / deprovisioning** from the system — accountability must always
         point to a **current** person, so a departed owner's standing acceptance lapses immediately.
     On a void the workflow **HALTS — nothing runs**. To resume, the workflow's **scope owner — a PMO
     (org-scoped workflow) or a PM (project-scoped)** — must **select a new human approver**, who then reviews
     the workflow in detail and passkey-signs a fresh responsibility acceptance; only then does it run again.
     (Selecting the new approver is itself a human-only PMO/PM act, never agentic.) There is no
     advisory-autonomous fallback. Crucially, a void only revokes **forward** authority: approvals the signer already made remain
     **immutable audit records** — history is never rewritten, their past signatures stand as the record of
     what happened; only future autonomous action lapses. Every autonomous AI approval therefore traces to a
     named, still-present human who owns that exact workflow version. No self-approval — an AI (or its
     principal) can never approve a proposal it initiated.
  3. **Grant-bound, per-workflow, human-issued, NEVER agentic** — an AI's ability to approve a stage is
     conferred **only by an explicit human grant, scoped to a single workflow** (never a blanket/global
     grant, never inferred). The grant-issuing action is itself a **hard human-only** action: it can never be
     bound to an approval chain an AI could satisfy, and is **never executable by an autonomous/agentic
     actor** — default-deny, not even under some other grant. So **no agentic path can create, widen, or
     bootstrap AI-approval authority**: only a human, explicitly, per workflow. Each grant is scope + expiry
     bound and fail-closed audited (existing autonomous model).
  4. **Advisory input vs. autonomous approval** — an AI may give *advisory* input in a chain a **human**
     approves (no acceptance needed; the human decides). For an AI to be a *binding/sole* approver requires a
     **valid** human responsibility acceptance (#2/#3). Without one — never signed, voided (workflow changed
     **or the signer left the system**), or expired — the workflow **cannot run autonomously: nothing runs**
     until a present human re-reviews + re-signs. There is no advisory-autonomous fallback.
  5. **Escape hatch stays human** — PMO redirect/bypass is always a human passkey action, never AI.
  6. **Sensitive data is an AI no-go by default** — data classified sensitive — **PII, secrets, financial**
     (the registry financials field group), and any field or dataset an admin additionally marks sensitive —
     is **withheld from AI entirely by default** — not merely redacted-if-
     enabled. Relaxing it (letting AI see specific sensitive data) is a deliberate act an **Admin or PMO** must
     **passkey-sign** to authorize, taking responsibility — the same signed-acceptance discipline (scoped to
     the specific data/workflow, bound to the signer's presence, voided on signer removal or scope change, and
     nothing runs against sensitive data until signed). Enforcement reuses the existing DLP primitive
     (`redactForEgress` / `AI_DLP_REDACT`) but flips its posture from opt-in redaction to **default-deny**.
     Admins **extend the definition with regex rules**: an *add* pattern classes matching content sensitive
     (e.g. anything containing `high secret project`), a *remove/exclude* pattern narrows it. Asymmetric on
     purpose — an *add* is **tightening** (admin-gated + audited), but a *remove* **exposes data to AI**, so it
     is a **relaxation**: it must itself be **passkey-signed** by an Admin/PMO and can **never** un-protect the
     built-in PII / secret / financial classes without that signed act. All admin patterns compile on the
     **linear-time regex engine** (`re2js` / `lib/safe-regex`), so a pathological pattern can't ReDoS the classifier.

## 5. Workflow engine — a caller, mostly

- **Nodes**: `broker-request` (via `broker-command`, scope-limited by the caller's RBAC), `condition`
  (branch), `loop` (bounded iteration), `output`/`notify` (notify-bus), `report` (availableReports),
  `approval` (bind an approval chain to a step). Genuinely new = the branch/loop/step interpreter; everything
  a node *does* is an existing surface.
- **Bounds**: iteration caps, step caps, per-run budget — mirrors the autonomous-guard runaway posture.
- **Scope**: a workflow can never exceed its author's RBAC scope; every broker call re-checks scope.
- **Storage**: workflow definitions as JSON in project/org config (params only, no embedded code).

## 6. Build order (each a self-contained, testable step)

1. **WebAuthn passkey register + public-key store** (per-`sub`). *New.*
2. **Per-approval challenge + verify** (Node `crypto`), recorded in the audit chain. *New.*
3. **Chain engine**: generalize `dual-control` to N stages (role/named, configurable rejection, PMO
   redirect/bypass), signatures required per stage. *New, reuses queue/executor.*
4. **AI-as-approver** guardrails: key-class segregation; no self-approval; and the **human responsibility
   acceptance** — a per-workflow, **hard human-only** action where a named human reviews the workflow + the
   AI's actions and passkey-signs to take responsibility, **bound to the workflow content hash** (any edit
   voids it). It's never chain-gateable by an AI and never executable by an autonomous actor, so AI can't
   bootstrap its own authority; only once it exists may an AI stage be binding/sole. *New, reuses autonomous-grant.*
5. **Inbox** surface (MyWork + notify-bus). *Mostly reused.*
6. **Bind chains to actions** (generalize `DUAL_CONTROL_ACTIONS` → per-action/per-workflow-step). *New glue.*
7. **Workflow engine** (branch/loop interpreter over existing node surfaces) + JSON storage. *New interpreter.*

## 6a. System-wide enforcement of the governing invariant (§0)

The invariant — *no lone insider, admin included, may unilaterally REDUCE the security posture* — must hold
**everywhere**, not just for the four approval actions. Design, fail-CLOSED:

- **One chokepoint.** Every settings mutation funnels through `updateSettings`; every AI/backend action
  funnels through the existing gates (`dual-control` action ids, `isActionApproved`, `autonomous-grant`).
  Enforcement hooks these, not scattered call sites.
- **A `SECURITY_SETTINGS` registry** names the settings keys that bear on the security posture (egress/IP
  allowlists, DLP/sensitive-data config, RBAC/role grants, autonomous grants, audit/retention, approval
  chains themselves, PSK/keys, MFA/step-up, session policy, feature-governance gates, …). The registry IS
  the classification, and a **drift guard** (test) forces any newly-added security-relevant setting to be
  registered — so a new knob can't slip in unclassified.
- **Default-GATED, tightening-EXEMPT.** A change to a registry key is routed to **dual-control** (a second
  distinct admin/PMO must passkey-sign before it applies) **unless** a per-key predicate can *prove* the
  change strictly TIGHTENS (e.g. revoke, enable-a-guard, add-to-a-denylist, narrow-a-scope). Fail-closed:
  no predicate, ambiguous, or structurally-complex change ⇒ treated as a reduction ⇒ gated. A
  misclassification can only ever OVER-gate (safe friction), never under-gate (a hole).
- **Mechanism = reuse.** A gated change becomes a `dual-control`/approval proposal carrying the patch as
  params (no code in the queue); on the second signature the executor applies the exact patch. Tightening
  applies immediately (single admin, audited). No role is exempt — an admin loosening still needs a second.
- **Env/deploy-level** security (BROKER_PSK, KMS, TLS) is outside the app's mutation path — an ops/deploy
  control, noted as out of scope for the in-app gate.

Build order: (i) the pure classifier + registry + drift guard (no critical-path change); (ii) wire the
`updateSettings` interception to route a loosening patch through dual-control. Step (i) is safe to build
now; step (ii) touches the settings hot path and lands behind tests + the confirmed registry.

## 7. Open decisions

- Settled (§4.2): an AI may be the sole/autonomous approver only under a **version-bound, passkey-signed human
  responsibility acceptance** — accountability is established at authorization time, not per run. Open: whether
  a sensitivity threshold forbids AI stages *entirely* for some actions, and who owns that (org PMO vs. per-project PM).
- **Settled** — on a void (workflow edit OR signer removal, §4.2) **nothing runs**: the workflow's scope owner
  (**PMO** org-scoped / **PM** project-scoped) must **select a new human approver**, who reviews + passkey-signs
  a fresh acceptance before it runs again — a human-only act, never agentic. No advisory-autonomous fallback.
  Open is only the notification/UX for prompting the scope owner + the nominated approver.
- **Settled — AI is default-DENY**: every AI action, **reads included**, needs an explicit human grant; nothing
  is permitted by default. The 'governed' posture (default-permitted + allowlist + RBAC scope + audit) remains
  available as an **opt-in option** per deployment, not the default.
- Sensitive classes (§4.6) — **settled**: reuse the DLP **PII / secret / sensitive** detection, **add financial**
  (registry financials group), and let admins extend via **ReDoS-safe (`re2js`) regex add/remove rules** — an
  *add* is admin-gated tightening; a *remove* exposes data to AI, so it's a signed relaxation and can't
  un-protect the built-in classes.
- Exact JSON schema for a chain and a workflow (versioned, drift-guarded).
- Quorum-per-stage (deferred) and parallel stages (deferred).
- **Settled — offboarding is IdP-driven**: removal/deprovisioning happens in the IdP (OIDC); the gateway is
  already aware via the existing deprovisioning signal (`isDeprovisioned`, `lib/rbac`/`lib/oidc`) and revokes
  the user's public key, so their signature **no longer matches** any responsibility acceptance → those
  acceptances void automatically (nothing runs). No separate offboarding job — it falls out of the
  key-no-longer-valid check. Past signed approvals stay valid in the audit chain (history preserved).

## Related, independent

- **JQL → global search** (small, additive): gate behind the existing `jqlSearch` feature; add a scope-guarded
  REST search endpoint over `lib/jql` + `allIssues`; global-search box gains an optional JQL mode when the
  feature is on. Default regex quick-find unchanged. Not part of this feature; shippable on its own.
