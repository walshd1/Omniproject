# Workflow creator + approval chains — design note

Status: **design, not built.** This is the written target for a large, security-critical feature designed
across conversation. It records the model, what is genuinely new vs. reused, the crypto guarantees, and the
build order — so implementation doesn't drift or duplicate existing code.

## 1. What we're building

An **admin/PMO/PM-gated workflow creator**: a signed-in user (bounded by their RBAC scope) composes
workflows that can make requests to/from the broker with **iteration** and **conditional branching**, send
data to **outputs / notifications**, and **create reports**. Workflows are stored as JSON in the **project or
org** config.

The **genuinely new** capability that falls out of this — and is useful everywhere, not just here — is
**approval chains**: an optional, N-stage, cryptographically-signed approval gate that can be attached to
**any sensitive action** in the system. Approval chains are the core deliverable; the workflow engine is
largely a *caller* of existing surfaces.

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
| Query engine (for report/filter steps) | `lib/jql.ts` (this branch), OData `applyODataQuery` |
| Approver inbox surface | `pages/MyWork.tsx` + notify-bus |

The chain engine **generalizes `dual-control`** (its single checker → N stages) and reuses its safety property:
proposals carry **params only, never code** — the executor is a pre-registered function keyed by action id.

## 3. Approval chains — the model

- **Definition scope**: a chain is defined by a **PMO** (org-level) and/or a **PM** (internal to a project).
  Stored in org/project JSON.
- **Stages**: sequential (each must approve before the next is asked). A stage names its approver(s) by
  **RBAC role OR named individual(s)**. (Quorum-per-stage is a later extension.)
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

**AI → the same shape, with great care (the asymmetry).**
- An AI actor has no authenticator; its key is **software/server-held**, so the server *could* produce an AI
  signature. An AI approval is therefore **cryptographically weaker** and must never be counted as a human one.
- Guardrails:
  1. **Key-class segregation** — AI signs with a distinct, **grant-bound autonomous key** (reusing
     `autonomous-grant`); an AI-signed approval is marked as such in the queue + audit. A stage that requires a
     **human passkey can never be satisfied by an AI signature**.
  2. **Intermediary only — never sole; a human sign-off is ALWAYS required** — an AI may occupy an
     *intermediary* stage but can **never be the only approver in a chain**. Every chain that includes an AI
     stage **must** contain at least one explicit **human** passkey sign-off — no sensitivity threshold, no
     exception. An AI signature alone can never complete a chain; a chain with no human approver can never
     include an AI stage; and an AI (or its principal) can never approve a proposal it initiated (no
     self-approval). The authoritative completion of any chain is always a human act.
  3. **Grant-bound, per-workflow, human-issued, NEVER agentic** — an AI's ability to approve a stage is
     conferred **only by an explicit human grant, scoped to a single workflow** (never a blanket/global
     grant, never inferred). The grant-issuing action is itself a **hard human-only** action: it can never be
     bound to an approval chain an AI could satisfy, and is **never executable by an autonomous/agentic
     actor** — default-deny, not even under some other grant. So **no agentic path can create, widen, or
     bootstrap AI-approval authority**: only a human, explicitly, per workflow. Each grant is scope + expiry
     bound and fail-closed audited (existing autonomous model).
  4. **Advisory by default** — an AI stage is advisory unless a human makes it binding within its per-workflow grant.
  5. **Escape hatch stays human** — PMO redirect/bypass is always a human passkey action, never AI.

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
4. **AI-as-approver** guardrails (key-class segregation, separation of duties, advisory default). Includes a
   **per-workflow, human-only "grant AI-approval" action** on the hard human-only list — never chain-gateable
   by an AI, never executable by an autonomous actor, so AI can't bootstrap its own authority. *New, reuses
   autonomous-grant.*
5. **Inbox** surface (MyWork + notify-bus). *Mostly reused.*
6. **Bind chains to actions** (generalize `DUAL_CONTROL_ACTIONS` → per-action/per-workflow-step). *New glue.*
7. **Workflow engine** (branch/loop interpreter over existing node surfaces) + JSON storage. *New interpreter.*

## 7. Open decisions

- A human passkey sign-off is ALWAYS mandatory in any chain containing an AI stage (settled, §4.2). Open:
  whether a sensitivity threshold governs anything *further* — e.g. actions that forbid AI stages entirely —
  and who sets it (org PMO vs. per-project PM).
- Reads posture for AI: keep today's default-permitted-but-governed (allowlist + RBAC scope + audit), or add a
  **default-deny-reads for autonomous actors** option so *every* AI action — reads included — needs an explicit
  human grant (matches the writes/approvals posture).
- Exact JSON schema for a chain and a workflow (versioned, drift-guarded).
- Quorum-per-stage (deferred) and parallel stages (deferred).
- Passkey recovery / approver offboarding (a leaver's public key must be revocable without breaking history).

## Related, independent

- **JQL → global search** (small, additive): gate behind the existing `jqlSearch` feature; add a scope-guarded
  REST search endpoint over `lib/jql` + `allIssues`; global-search box gains an optional JQL mode when the
  feature is on. Default regex quick-find unchanged. Not part of this feature; shippable on its own.
